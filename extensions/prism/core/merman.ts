import { spawn } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'
import { background } from './background.ts'
import type { Wake } from './background.ts'
import { pngSize } from './latex.ts'

export type Picture = { state: 'declined' } | { state: 'pending' } | { state: 'drawn'; png: string; width: number; height: number }

type Settled = Exclude<Picture, { state: 'pending' }>

const TIMEOUT_MS = 5000
const MAX_SOURCE = 100000
const MAX_PICTURE_BYTES = 3 * 1024 * 1024
// A 1x PNG blurs when a Retina terminal stretches it, so merman draws at 2x and the reported size is half the pixels.
const ZOOM = 2
const DECLINED: Settled = { state: 'declined' }

export const mermanJobs = background<Settled>({ limit: 100, concurrency: 1, crashed: DECLINED })

export const MERMAN_KINDS = [
  'timeline',
  'mindmap',
  'gitGraph',
  'journey',
  'quadrantChart',
  'sankey-beta',
  'C4Context',
  'architecture-beta',
  'block-beta',
  'kanban',
  'packet-beta',
  'radar-beta',
  'treemap-beta',
  'requirementDiagram',
] as const

export const MERMAN_HINT = `Other \`\`\`mermaid kinds (${MERMAN_KINDS.join(', ')}) are drawn by prism as an image on a white background, at most about 20 terminal rows tall, so keep them small.`

const found = new Map<string, string | null>()

const onPath = (name: string): string | null => {
  const path = process.env.PATH
  const key = `${name}\0${path}`
  if (found.has(key)) return found.get(key)!
  let bin: string | null = null
  for (const dir of (path ?? '').split(delimiter)) {
    if (dir === '') continue
    const file = resolve(dir, name)
    try {
      accessSync(file, constants.X_OK)
      if (!statSync(file).isFile()) continue
      bin = file
      break
    } catch {}
  }
  found.set(key, bin)
  return bin
}

export const mermanPath = (): string | null => onPath('merman-cli')

const FRONT_MATTER = /^\s*---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/

export const headerWord = (source: string): string => source.replace(FRONT_MATTER, '').replace(/^(\s*%%[^\n]*\n)+/, '').trim().split(/\s/)[0] ?? ''

export const mermanPicture = (untagged: string, wake: Wake): Picture => {
  if (headerWord(untagged) === '') return DECLINED
  const bin = mermanPath()
  if (bin === null) return DECLINED
  if (untagged.length > MAX_SOURCE) return DECLINED
  return mermanJobs.get(untagged, () => render(bin, untagged), wake) ?? { state: 'pending' }
}

const render = (bin: string, source: string): Promise<Settled> =>
  new Promise(done => {
    const child = spawn(bin, ['render', '-', '-f', 'png', '-s', String(ZOOM), '-b', 'white', '-q', '-o', '-'], { stdio: ['pipe', 'pipe', 'ignore'] })
    const chunks: Buffer[] = []
    let bytes = 0
    let settled = false
    const finish = (result: Settled, kill = false) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (kill) child.kill('SIGKILL')
      done(result)
    }
    const timer = setTimeout(() => finish(DECLINED, true), TIMEOUT_MS)
    child.on('error', () => finish(DECLINED))
    child.stdin.on('error', () => {})
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > MAX_PICTURE_BYTES) return finish(DECLINED, true)
      chunks.push(chunk)
    })
    child.on('close', code => {
      if (code !== 0) return finish(DECLINED)
      const png = Buffer.concat(chunks).toString('base64')
      const size = pngSize(png)
      finish(size && size.width > 0 && size.height > 0 ? { state: 'drawn', png, width: size.width / ZOOM, height: size.height / ZOOM } : DECLINED)
    })
    child.stdin.end(source)
  })
