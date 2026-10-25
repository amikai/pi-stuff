import { spawn } from 'node:child_process'
import { deflateRawSync } from 'node:zlib'
import { h } from './jsx.ts'
import type { ElementTable } from './jsx.ts'
import { fitImage, fitsImage, pngSize } from './latex.ts'
import { PLANTUML_KINDS } from './markdown.ts'
import type { Block } from './markdown.ts'
import { boxArt } from './mermaid.ts'
import { width } from './render.ts'
import type { Drawn } from './render.ts'
import type { Style } from './theme.ts'

export type PlantUmlMode = 'png' | 'utxt'

export type PlantUmlEntry =
  | { kind: 'image'; png: string; width: number; height: number; source: string }
  | { kind: 'art'; text: string; source: string }
  | { kind: 'error'; note: string }

export type PlantUmlHooks = {
  mode: PlantUmlMode
  requestRender: () => void
  onInvalidate?: () => void
}

export const PLANTUML_HINT =
  'A ```plantuml block (@startuml … @enduml) is rendered by prism: as an image on terminals that show images, otherwise as text art for sequence diagrams only. Do not use !include or !includeurl, which are blocked.'

const CACHE_LIMIT = 100
const CLI_TIMEOUT_MS = 5000
const SERVER_TIMEOUT_MS = 8000
const MAX_OUTPUT = 2 * 1024 * 1024
const JAVA_OPTION_VARS = ['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS']
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'
const TAGGED = new Set(['plantuml', 'puml', 'uml'])
const UNTAGGED_START = new RegExp(`^@start(${PLANTUML_KINDS})\\b`, 'i')
const SYNTAX_ERROR = /^ERROR(?=\r?\n|$)(?:\r?\n(\d+))?(?:\r?\n([^\r\n]*))?/
const MESSAGE_LIMIT = 160

export const plantumlCache = new Map<string, PlantUmlEntry>()
export const inFlight = new Set<string>()

const lookup = (key: string): PlantUmlEntry | undefined => {
  const hit = plantumlCache.get(key)
  if (hit) {
    plantumlCache.delete(key)
    plantumlCache.set(key, hit)
  }
  return hit
}

const store = (key: string, entry: PlantUmlEntry): void => {
  plantumlCache.delete(key)
  plantumlCache.set(key, entry)
  if (plantumlCache.size > CACHE_LIMIT) plantumlCache.delete(plantumlCache.keys().next().value!)
}

const failure = (note: string): PlantUmlEntry => ({ kind: 'error', note })

// PlantUML's pipe mode matches markers with an untrimmed startsWith, so an indented marker reads as diagram content.
const normalize = (lines: string[]): string =>
  `${lines.map(line => (/^\s*@(start|end)/i.test(line) ? line.trimStart() : line)).join('\n')}\n`

export const plantumlOf = (block: Block): string | null => {
  if (block.kind !== 'code' || block.isOpen) return null
  const lang = block.lang.toLowerCase()
  const isPlantUml = TAGGED.has(lang) || (lang === '' && UNTAGGED_START.test(block.lines.find(line => line.trim() !== '') ?? ''))
  const source = isPlantUml ? normalize(block.lines) : ''
  return source.trim() === '' ? null : source
}

const SEQUENCE = /\b(participant|actor|boundary|control|collections|queue|autonumber)\b|<?-{1,2}>+|<-{1,2}/i
const NOT_SEQUENCE =
  /\b(class|interface|enum|abstract|state|component|package|node|cloud|frame|folder|artifact|storage|usecase|object|map|start|stop|partition|fork|split|repeat|while)\b|\[\*\]|\b(entity|database)\b[^{;\n]*\{|^\s*:[^:\n]+;\s*$/im

export const isSequenceDiagram = (source: string): boolean => {
  const code = source.replace(/\/'[\s\S]*?'\//g, '').replace(/^\s*'.*$/gm, '').replace(/"[^"\n]*"/g, '""')
  return SEQUENCE.test(code) && !NOT_SEQUENCE.test(code)
}

const imageEntry = (bytes: Buffer, source: string): PlantUmlEntry | null => {
  const png = bytes.toString('base64')
  const size = pngSize(png)
  if (!size || size.width <= 0 || size.height <= 0) return null
  return fitsImage(png) ? { kind: 'image', png, ...size, source } : failure('diagram image is too large')
}

const artEntry = (text: string, source: string): PlantUmlEntry | null => {
  const art = text.replace(/[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '')
  return art === '' ? null : { kind: 'art', text: art, source }
}

type CliResult = { code: number | null; out: Buffer } | 'missing' | 'failed'

const cliEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env }
  for (const name of JAVA_OPTION_VARS) delete env[name]
  env.PLANTUML_SECURITY_PROFILE = 'SANDBOX'
  return env
}

const runCli = (source: string, mode: PlantUmlMode, isDark: boolean): Promise<CliResult> =>
  new Promise(resolve => {
    const args = ['-pipe', '-pipeNoStderr', mode === 'png' ? '-tpng' : '-tutxt', ...(mode === 'png' && isDark ? ['-darkmode'] : [])]
    const child = spawn('plantuml', args, { env: cliEnv(), stdio: ['pipe', 'pipe', 'ignore'] })
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const finish = (result: CliResult, kill = false) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (kill) {
        child.kill('SIGKILL')
        child.stdout.destroy()
      }
      resolve(result)
    }
    const timer = setTimeout(() => finish('failed', true), CLI_TIMEOUT_MS)
    child.on('error', (error: NodeJS.ErrnoException) => finish(error.code === 'ENOENT' ? 'missing' : 'failed'))
    child.stdin.on('error', () => {})
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_OUTPUT) finish('failed', true)
      else chunks.push(chunk)
    })
    child.on('close', code => finish({ code, out: Buffer.concat(chunks) }))
    child.stdin.end(source)
  })

const viaCli = async (source: string, mode: PlantUmlMode, isDark: boolean): Promise<PlantUmlEntry | 'missing' | 'failed'> => {
  const result = await runCli(source, mode, isDark)
  if (typeof result === 'string') return result
  const syntax = SYNTAX_ERROR.exec(result.out.subarray(0, 1024).toString('utf8'))
  if (syntax) {
    const synthesized = /^@start/im.test(source) ? 0 : 1
    const place = syntax[1] === undefined ? '' : ` (line ${Math.max(1, Number(syntax[1]) + 1 - synthesized)})`
    const message = (syntax[2] ?? '').trim().slice(0, MESSAGE_LIMIT)
    return failure(`plantuml error${place}${message === '' ? '' : `: ${message}`}`)
  }
  if (result.code !== 0) return 'failed'
  return (mode === 'png' ? imageEntry(result.out, source) : artEntry(result.out.toString('utf8'), source)) ?? 'failed'
}

const encode = (source: string): string => {
  const data = deflateRawSync(Buffer.from(source, 'utf8'), { level: 9 })
  let out = ''
  for (let i = 0; i < data.length; i += 3) {
    const [b1, b2, b3] = [data[i]!, data[i + 1] ?? 0, data[i + 2] ?? 0]
    out += ALPHABET[b1 >> 2]! + ALPHABET[((b1 & 3) << 4) | (b2 >> 4)]! + ALPHABET[((b2 & 15) << 2) | (b3 >> 6)]! + ALPHABET[b3 & 63]!
  }
  return out
}

const viaServer = async (base: string, source: string, mode: PlantUmlMode, isDark: boolean): Promise<PlantUmlEntry> => {
  const endpoint = mode === 'utxt' ? 'txt' : isDark ? 'dpng' : 'png'
  try {
    const res = await fetch(`${base}/${endpoint}/${encode(source)}`, { signal: AbortSignal.timeout(SERVER_TIMEOUT_MS), redirect: 'error' })
    if (res.status === 400 || res.headers.has('x-plantuml-diagram-error')) return failure('diagram failed to render')
    if (res.status !== 200 || Number(res.headers.get('content-length')) > MAX_OUTPUT) return failure('plantumlServer request failed')
    const body = Buffer.from(await res.arrayBuffer())
    if (body.length > MAX_OUTPUT) return failure('plantumlServer request failed')
    return (mode === 'png' ? imageEntry(body, source) : artEntry(body.toString('utf8'), source)) ?? failure('plantumlServer request failed')
  } catch {
    return failure('plantumlServer request failed')
  }
}

const render = async (source: string, mode: PlantUmlMode, style: Style): Promise<PlantUmlEntry> => {
  const cli = await viaCli(source, mode, style.isDark)
  if (typeof cli === 'object') return cli
  if (style.plantumlServer) return viaServer(style.plantumlServer, source, mode, style.isDark)
  return failure(cli === 'missing' ? 'plantuml CLI is not installed' : 'plantuml CLI failed')
}

const start = (key: string, source: string, style: Style, hooks: PlantUmlHooks): void => {
  inFlight.add(key)
  render(source, hooks.mode, style)
    .catch(() => failure('plantuml CLI failed'))
    .then(entry => store(key, entry))
    .finally(() => {
      inFlight.delete(key)
      hooks.onInvalidate?.()
      hooks.requestRender()
    })
    .catch(() => {})
}

const NON_SEQUENCE = 'plantuml non-sequence diagrams require an image-capable terminal'

export const drawPlantUml = (el: ElementTable, style: Style, blocks: Block[], columns: number, hooks: PlantUmlHooks): Drawn => {
  const drawn: Drawn = new Map()
  for (const [i, block] of blocks.entries()) {
    const source = plantumlOf(block)
    if (source === null) continue
    const key = `${hooks.mode}:${style.isDark}:${style.plantumlServer ?? ''}:${source}`
    let entry = lookup(key)
    if (!entry && !inFlight.has(key)) {
      if (hooks.mode === 'utxt' && !isSequenceDiagram(source)) {
        entry = failure(NON_SEQUENCE)
        store(key, entry)
      } else {
        start(key, source, style, hooks)
      }
    }
    if (!entry) continue
    if (entry.kind === 'error') {
      drawn.set(i, { note: entry.note })
    } else if (entry.kind === 'image') {
      const fit = fitImage(entry, columns)
      drawn.set(i, { element: h(el.Image!, { key: `b${i}`, source: { png: entry.png }, columns: fit.columns, rows: fit.rows, alt: 'plantuml diagram' }) })
    } else {
      const wide = Math.max(...entry.text.split('\n').map(width))
      drawn.set(i, wide > columns - 2 ? { note: `diagram is ${wide} cols, terminal is ${columns}` } : { element: boxArt(el, style, entry.text, `b${i}`), art: entry.text })
    }
  }
  return drawn
}
