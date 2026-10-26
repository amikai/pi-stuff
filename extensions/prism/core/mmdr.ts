import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { h } from './jsx.ts'
import type { ElementTable } from './jsx.ts'
import { fitImage, fitsImage, MAX_IMAGE_BYTES, pngSize } from './latex.ts'
import type { Block } from './markdown.ts'
import type { Drawn } from './render.ts'

export type MmdrEntry =
  | { kind: 'image'; png: string; width: number; height: number }
  | { kind: 'error'; note?: string } // note undefined: keep the text renderer's note

export type MmdrHooks = { requestRender: () => void; onInvalidate?: () => void }

const CACHE_LIMIT = 100
const TIMEOUT_MS = 5000
const TOO_LARGE = 'diagram image is too large'
const TEMP_ROOT = join(tmpdir(), 'prism-mmdr')

export const mmdrCache = new Map<string, MmdrEntry>()
// Pi rebuilds the component on every streamed token, so each source keeps every caller's invalidate, not only the first.
export const mmdrInFlight = new Map<string, Set<() => void>>()

const lookup = (key: string): MmdrEntry | undefined => {
  const hit = mmdrCache.get(key)
  if (hit) {
    mmdrCache.delete(key)
    mmdrCache.set(key, hit)
  }
  return hit
}

const store = (key: string, entry: MmdrEntry): void => {
  mmdrCache.delete(key)
  mmdrCache.set(key, entry)
  if (mmdrCache.size > CACHE_LIMIT) mmdrCache.delete(mmdrCache.keys().next().value!)
}

const failure: MmdrEntry = { kind: 'error' }

const runCli = (source: string, file: string): Promise<boolean> =>
  new Promise(resolve => {
    const child = spawn('mmdr', ['-i', '-', '-e', 'png', '-o', file], { stdio: ['pipe', 'ignore', 'ignore'] })
    let settled = false
    const finish = (ok: boolean, kill = false) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (kill) child.kill('SIGKILL')
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false, true), TIMEOUT_MS)
    child.on('error', () => finish(false))
    child.stdin.on('error', () => {})
    child.on('close', code => finish(code === 0))
    child.stdin.end(source)
  })

const render = async (source: string): Promise<MmdrEntry> => {
  await mkdir(TEMP_ROOT, { recursive: true, mode: 0o700 })
  const dir = await mkdtemp(join(TEMP_ROOT, 'job-'))
  try {
    const file = join(dir, 'diagram.png')
    if (!(await runCli(source, file))) return failure
    if ((await stat(file)).size > MAX_IMAGE_BYTES) return { kind: 'error', note: TOO_LARGE }
    const png = (await readFile(file)).toString('base64')
    const size = pngSize(png)
    if (!size || size.width <= 0 || size.height <= 0) return failure
    return fitsImage(png) ? { kind: 'image', png, ...size } : { kind: 'error', note: TOO_LARGE }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const start = (key: string, hooks: MmdrHooks): void => {
  const invalidators = new Set<() => void>()
  mmdrInFlight.set(key, invalidators)
  render(key)
    .catch(() => failure)
    .then(entry => store(key, entry))
    .finally(() => {
      mmdrInFlight.delete(key)
      for (const invalidate of invalidators) invalidate()
      hooks.requestRender()
    })
    .catch(() => {})
}

// Overlays only what mmdr adds to blocks the text renderer left undrawn; a pending or failed render adds nothing.
export const drawMmdr = (el: ElementTable, blocks: Block[], columns: number, drawn: Drawn, hooks: MmdrHooks): Drawn => {
  const overlay: Drawn = new Map()
  for (const [i, block] of blocks.entries()) {
    if (block.kind !== 'code' || block.lang.toLowerCase() !== 'mermaid' || block.isOpen) continue
    if (drawn.get(i)?.element) continue
    const source = block.lines.join('\n')
    if (source.trim() === '') continue
    let entry = lookup(source)
    if (!entry && !mmdrInFlight.has(source)) start(source, hooks)
    if (!entry && hooks.onInvalidate) mmdrInFlight.get(source)?.add(hooks.onInvalidate)
    if (!entry) continue
    if (entry.kind === 'image') {
      const fit = fitImage(entry, columns)
      overlay.set(i, {
        element: h(el.Image!, { key: `b${i}`, source: { png: entry.png }, columns: fit.columns, rows: fit.rows, alt: 'mermaid diagram' }),
        png: entry.png,
      })
    } else if (entry.note) {
      overlay.set(i, { note: entry.note })
    }
  }
  return overlay
}
