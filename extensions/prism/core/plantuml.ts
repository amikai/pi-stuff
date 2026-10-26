import { Worker } from 'node:worker_threads'
import { background } from './background.ts'
import { h } from './jsx.ts'
import type { ElementTable } from './jsx.ts'
import { fitImage, fitsImage, pngSize } from './latex.ts'
import { PLANTUML_KINDS } from './markdown.ts'
import type { Block } from './markdown.ts'
import type { Drawn } from './render.ts'

export type PlantUmlEntry =
  | { kind: 'image'; png: string; width: number; height: number; source: string }
  | { kind: 'error'; note: string }

export type PlantUmlHooks = {
  images: boolean
  requestRender: () => void
  onInvalidate?: () => void
}

export const PLANTUML_HINT =
  'A ```plantuml block (@startuml … @enduml) is rendered by prism as an image on terminals that show images, and stays a note elsewhere. Do not use !include or !includeurl, which are blocked, built-in libraries such as <C4/...> included. Do not use $sprite.'

export const plantumlTimeout = { ms: 5000 }

const MAX_OUTPUT = 2 * 1024 * 1024
const TAGGED = new Set(['plantuml', 'puml', 'uml'])
const UNTAGGED_START = new RegExp(`^@start(${PLANTUML_KINDS})\\b`, 'i')
const MESSAGE_LIMIT = 160
const NO_IMAGES = 'plantuml diagrams require an image-capable terminal'

const failure = (note: string): PlantUmlEntry => ({ kind: 'error', note })

export const plantumlJobs = background<PlantUmlEntry>({ limit: 100, concurrency: 1, crashed: failure('plantuml worker failed') })

// PlantUML matches markers with an untrimmed startsWith, so an indented marker reads as diagram content.
const normalize = (lines: string[]): string =>
  `${lines.map(line => (/^\s*@(start|end)/i.test(line) ? line.trimStart() : line)).join('\n')}\n`

export const plantumlOf = (block: Block): string | null => {
  if (block.kind !== 'code' || block.isOpen) return null
  const lang = block.lang.toLowerCase()
  const isPlantUml = TAGGED.has(lang) || (lang === '' && UNTAGGED_START.test(block.lines.find(line => line.trim() !== '') ?? ''))
  const source = isPlantUml ? normalize(block.lines) : ''
  return source.trim() === '' ? null : source
}

type Reply = { png: Uint8Array } | { error: string; line?: number } | { failed: string }

type Waiting = { settle: (reply: Reply) => void; timer: NodeJS.Timeout }

let worker: Worker | null = null
let lastId = 0
const waiting = new Map<number, Waiting>()

// A worker that times out or dies is dropped, so the next render starts a fresh one.
const stopWorker = (failed: string): void => {
  const stale = worker
  worker = null
  stale?.terminate().catch(() => {})
  const pending = [...waiting.values()]
  waiting.clear()
  for (const { settle, timer } of pending) {
    clearTimeout(timer)
    settle({ failed })
  }
}

const startWorker = (): Worker => {
  const started = new Worker(new URL('./vendor/plantuml.js', import.meta.url))
  started.on('message', (message: { id: number; png?: Uint8Array; error?: string; line?: number }) => {
    const entry = waiting.get(message.id)
    if (!entry) return
    waiting.delete(message.id)
    clearTimeout(entry.timer)
    entry.settle(message.png ? { png: message.png } : { error: message.error ?? 'diagram failed to render', line: message.line })
  })
  const died = () => {
    if (worker === started) stopWorker('plantuml worker failed')
  }
  started.on('error', died)
  started.on('exit', died)
  // Listening for 'message' references the worker again, so unref comes after the listeners.
  started.unref()
  return started
}

const ask = (source: string): Promise<Reply> =>
  new Promise(resolve => {
    const id = ++lastId
    let current: Worker
    try {
      current = worker ??= startWorker()
    } catch {
      return resolve({ failed: 'plantuml worker failed' })
    }
    const timer = setTimeout(() => stopWorker('plantuml render timed out'), plantumlTimeout.ms)
    waiting.set(id, { settle: resolve, timer })
    current.postMessage({ id, source })
  })

const imageEntry = (bytes: Uint8Array, source: string): PlantUmlEntry => {
  if (bytes.length > MAX_OUTPUT) return failure('diagram image is too large')
  const png = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
  const size = pngSize(png)
  if (!size || size.width <= 0 || size.height <= 0) return failure('plantuml worker failed')
  return fitsImage(png) ? { kind: 'image', png, ...size, source } : failure('diagram image is too large')
}

type Prepared = { sent: string; lineOf: (sentLine: number) => number }

// The engine reads a diagram only when the source opens with @start, and reports lines of what it was sent.
const prepare = (source: string): Prepared => {
  const trimmed = source.replace(/^(?:[ \t]*\r?\n)+/, '')
  if (!/^@start/i.test(trimmed)) return { sent: `@startuml\n${source}@enduml\n`, lineOf: line => Math.max(1, line - 1) }
  const skipped = source.split('\n').length - trimmed.split('\n').length
  return { sent: trimmed, lineOf: line => line + skipped }
}

const render = async (source: string): Promise<PlantUmlEntry> => {
  const { sent, lineOf } = prepare(source)
  const reply = await ask(sent)
  if ('failed' in reply) return failure(reply.failed)
  if ('png' in reply) return imageEntry(reply.png, source)
  const place = reply.line === undefined ? '' : ` (line ${lineOf(reply.line)})`
  const message = reply.error.trim().slice(0, MESSAGE_LIMIT)
  return failure(`plantuml error${place}${message === '' ? '' : `: ${message}`}`)
}

export const drawPlantUml = (el: ElementTable, blocks: Block[], columns: number, hooks: PlantUmlHooks): Drawn => {
  const drawn: Drawn = new Map()
  for (const [i, block] of blocks.entries()) {
    const source = plantumlOf(block)
    if (source === null) continue
    const key = `${hooks.images}:${source}`
    if (!hooks.images && !plantumlJobs.cache.has(key)) plantumlJobs.put(key, failure(NO_IMAGES))
    const entry = plantumlJobs.get(key, () => render(source), hooks)
    if (!entry) continue
    if (entry.kind === 'error') {
      drawn.set(i, { note: entry.note })
    } else {
      const fit = fitImage(entry, columns)
      drawn.set(i, {
        element: h(el.Image!, { key: `b${i}`, source: { png: entry.png }, columns: fit.columns, rows: fit.rows, alt: 'plantuml diagram' }),
        png: entry.png,
      })
    }
  }
  return drawn
}
