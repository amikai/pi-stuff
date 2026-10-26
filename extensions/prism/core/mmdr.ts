import { spawn } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { background } from './background.ts'
import type { Wake } from './background.ts'
import { MAX_IMAGE_BYTES, pngSize } from './latex.ts'

export type Picture =
  | { state: 'declined' }
  | { state: 'pending' }
  | { state: 'drawn'; png: string; width: number; height: number }
  | { state: 'failed'; reason: FailureReason }

export type FailureReason =
  | 'timed out after 5 s'
  | 'misread it'
  | 'found nothing to draw'
  | 'skipped a source over 20000 chars'
  | `image is ${number}×${number} px, over the 2 MiB limit`
  | 'failed'

type Settled = Exclude<Picture, { state: 'pending' }>

const TIMEOUT_MS = 5000
const MAX_SOURCE = 20000
const DECLINED: Settled = { state: 'declined' }
const failed = (reason: FailureReason): Settled => ({ state: 'failed', reason })

// mmdr holds the whole raster in memory: a 300-edge chart peaks near 1 GB for 4 s, so jobs run one at a time.
export const mmdrJobs = background<Settled>({ limit: 100, concurrency: 1, crashed: failed('failed') })

const found = new Map<string | undefined, string | null>()

export const mmdrPath = (): string | null => {
  const path = process.env.PATH
  if (found.has(path)) return found.get(path)!
  let bin: string | null = null
  for (const dir of (path ?? '').split(delimiter)) {
    if (dir === '') continue
    const file = resolve(dir, 'mmdr')
    try {
      accessSync(file, constants.X_OK)
      if (!statSync(file).isFile()) continue
      bin = file
      break
    } catch {}
  }
  found.set(path, bin)
  return bin
}

const FRONT_MATTER = /^\s*---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/

export const headerWord = (source: string): string => source.replace(FRONT_MATTER, '').replace(/^(\s*%%[^\n]*\n)+/, '').trim().split(/\s/)[0] ?? ''

export const mmdrPicture = (untagged: string, wake: Wake): Picture => {
  const word = headerWord(untagged)
  if (word === '') return DECLINED
  const bin = mmdrPath()
  if (bin === null) return DECLINED
  if (untagged.length > MAX_SOURCE) return failed('skipped a source over 20000 chars')
  return mmdrJobs.get(untagged, () => render(bin, untagged, word), wake) ?? { state: 'pending' }
}

export type Layout = { kind: string; width: number; height: number; nodes: string[]; edges: number }

export const parseLayout = (text: string): Layout | null => {
  let json: Record<string, unknown> | null
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  if (json === null || typeof json !== 'object') return null
  const { kind, width, height, nodes, edges } = json
  if (typeof kind !== 'string' || !Number.isFinite(width) || !Number.isFinite(height)) return null
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return null
  if (!nodes.every(node => node !== null && typeof node === 'object' && typeof node.id === 'string')) return null
  return { kind, width, height, nodes: nodes.map(node => node.id), edges: edges.length }
}

// mmdr reads any header word it does not know as a flowchart, so a flowchart it reports for another word was that fallback.
const FLOWCHART_WORDS = /^(flowchart|graph|flowchart-elk)$/
// mmdr's layout for "nothing parsed" is 8x8 (flowchart, state), 21x21 (mindmap) or 1x1 (sequence). Charts with no nodes, such as pie and gantt, are far larger.
const EMPTY_PX = 40
// Ids made only of ASCII punctuation, except `_` and `.`: `A -->` makes a node `>`, `class {` makes one with no id.
const SWALLOWED = /^[\s!-\-/:-@[-^`{-~]*$/
// Ids that hold syntax: a bracket, quote, pipe, `<` or `@` that opened something mmdr did not close.
const SYNTAX_IN_ID = /[[\](){}"|<@]/
const ARROW_IN_ID = /--|==|\|\||->/
const ARROWS = /-->|-\.->|==>|---|--[ox]|<-->|~~~/g

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A flowchart node id is a whole token of the source. `api-gateway --> auth-service` yields the ids api, gateway, auth and service.
const inSource = (source: string): ((id: string) => boolean) => {
  const bare = source.replace(ARROWS, ' ')
  return id => new RegExp(`(?<![\\w-])${escapeRegExp(id)}(?![\\w-]*\\w)`, 'u').test(bare)
}

export type Judgment = 'ok' | 'refused' | 'found nothing to draw' | 'misread it'

/** mmdr exits 0 and draws something for almost any input, so its own account of what it drew is the only check. */
export const judge = (word: string, layout: Layout, source: string): Judgment => {
  if (layout.kind.toLowerCase() === 'flowchart' && !FLOWCHART_WORDS.test(word)) return 'refused'
  if (layout.nodes.length === 0 && layout.edges === 0 && layout.width < EMPTY_PX && layout.height < EMPTY_PX) return 'found nothing to draw'
  if (layout.nodes.some(id => SWALLOWED.test(id) || SYNTAX_IN_ID.test(id) || ARROW_IN_ID.test(id))) return 'misread it'
  if (layout.kind.toLowerCase() === 'flowchart' && !layout.nodes.every(inSource(source))) return 'misread it'
  return 'ok'
}

type Run = 'ok' | 'timeout' | 'failed'

const run = (bin: string, source: string, dir: string): Promise<Run> =>
  new Promise(done => {
    const child = spawn(bin, ['-i', '-', '-e', 'png', '-o', join(dir, 'd.png'), '--dumpLayout', join(dir, 'l.json')], { cwd: dir, stdio: ['pipe', 'ignore', 'ignore'] })
    let settled = false
    const finish = (result: Run, kill = false) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (kill) child.kill('SIGKILL')
      done(result)
    }
    const timer = setTimeout(() => finish('timeout', true), TIMEOUT_MS)
    child.on('error', () => finish('failed'))
    child.stdin.on('error', () => {})
    child.on('close', code => finish(code === 0 ? 'ok' : 'failed'))
    child.stdin.end(source)
  })

const headerSize = async (file: string) => {
  const handle = await open(file, 'r')
  try {
    const head = Buffer.alloc(24)
    await handle.read(head, 0, 24, 0)
    return pngSize(head.toString('base64'))
  } finally {
    await handle.close()
  }
}

const render = async (bin: string, source: string, word: string): Promise<Settled> => {
  const dir = await mkdtemp(join(tmpdir(), 'prism-mmdr-'))
  try {
    const result = await run(bin, source, dir)
    if (result === 'timeout') return failed('timed out after 5 s')
    if (result === 'failed') return failed('failed')
    const layout = parseLayout(await readFile(join(dir, 'l.json'), 'utf8').catch(() => ''))
    if (layout === null) return failed('failed')
    const judgment = judge(word, layout, source)
    if (judgment === 'refused') return DECLINED
    if (judgment !== 'ok') return failed(judgment)
    const file = join(dir, 'd.png')
    if ((await stat(file)).size > MAX_IMAGE_BYTES) {
      const size = await headerSize(file)
      return failed(size ? `image is ${size.width}×${size.height} px, over the 2 MiB limit` : 'failed')
    }
    const png = (await readFile(file)).toString('base64')
    const size = pngSize(png)
    return size && size.width > 0 && size.height > 0 ? { state: 'drawn', png, ...size } : failed('failed')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
