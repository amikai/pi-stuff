import { spawn } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { background } from './background.ts'
import type { Wake } from './background.ts'
import { pngSize } from './latex.ts'

export type Picture = { state: 'declined' } | { state: 'pending' } | { state: 'drawn'; png: string; width: number; height: number }

type Settled = Exclude<Picture, { state: 'pending' }>

const TIMEOUT_MS = 5000
const MAX_SOURCE = 100000
const MAX_PICTURE_BYTES = 3 * 1024 * 1024
// mmdr's own PNG is 1x, which a Retina terminal stretches until it blurs, so rsvg-convert draws mmdr's SVG at 2x instead.
const ZOOM = 2
// librsvg refuses an image over 32767 px a side.
const RSVG_MAX_PX = 32000
const DECLINED: Settled = { state: 'declined' }

// mmdr holds the whole raster in memory: a 300-edge chart peaks near 1 GB for 4 s, so jobs run one at a time.
export const mmdrJobs = background<Settled>({ limit: 100, concurrency: 1, crashed: DECLINED })

export const MMDR_KINDS = [
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

export const MMDR_HINT = `Other \`\`\`mermaid kinds (${MMDR_KINDS.join(', ')}) are drawn by prism as an image on a white background, at most about 20 terminal rows tall, so keep them small. Flowchart node ids use letters, digits and underscores, not hyphens.`

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

export const mmdrPath = (): string | null => onPath('mmdr')

const FRONT_MATTER = /^\s*---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/

export const headerWord = (source: string): string => source.replace(FRONT_MATTER, '').replace(/^(\s*%%[^\n]*\n)+/, '').trim().split(/\s/)[0] ?? ''

export const mmdrPicture = (untagged: string, wake: Wake): Picture => {
  const word = headerWord(untagged)
  if (word === '') return DECLINED
  const bin = mmdrPath()
  if (bin === null) return DECLINED
  if (untagged.length > MAX_SOURCE) return DECLINED
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

const run = (bin: string, args: string[], dir: string, input = ''): Promise<boolean> =>
  new Promise(done => {
    const child = spawn(bin, args, { cwd: dir, stdio: ['pipe', 'ignore', 'ignore'] })
    let settled = false
    const finish = (ok: boolean, kill = false) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (kill) child.kill('SIGKILL')
      done(ok)
    }
    const timer = setTimeout(() => finish(false, true), TIMEOUT_MS)
    child.on('error', () => finish(false))
    child.stdin.on('error', () => {})
    child.on('close', code => finish(code === 0))
    child.stdin.end(input)
  })

const render = async (bin: string, source: string, word: string): Promise<Settled> => {
  const dir = await mkdtemp(join(tmpdir(), 'prism-mmdr-'))
  try {
    const rsvg = onPath('rsvg-convert')
    const svg = join(dir, 'd.svg')
    const file = join(dir, 'd.png')
    const out = rsvg ? ['-o', svg] : ['-e', 'png', '-o', file]
    if (!(await run(bin, ['-i', '-', ...out, '--dumpLayout', join(dir, 'l.json')], dir, source))) return DECLINED
    const layout = parseLayout(await readFile(join(dir, 'l.json'), 'utf8').catch(() => ''))
    if (layout === null || judge(word, layout, source) !== 'ok') return DECLINED
    const zoom = rsvg ? Math.min(ZOOM, RSVG_MAX_PX / Math.max(layout.width, layout.height)) : 1
    if (rsvg && !(await run(rsvg, ['-z', String(zoom), '-o', file, svg], dir))) return DECLINED
    if ((await stat(file)).size > MAX_PICTURE_BYTES) return DECLINED
    const png = (await readFile(file)).toString('base64')
    const size = pngSize(png)
    return size && size.width > 0 && size.height > 0 ? { state: 'drawn', png, width: size.width / zoom, height: size.height / zoom } : DECLINED
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
