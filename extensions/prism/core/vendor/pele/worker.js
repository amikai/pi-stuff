import { readFileSync } from 'node:fs'
import { parentPort } from 'node:worker_threads'
import { render } from 'pele'
import { initWasm, Resvg } from '@resvg/resvg-wasm'
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'
import { flatten } from './svg.js'

// A worker forwards console to the parent's stdout, which would draw over pi's screen.
for (const name of ['log', 'info', 'debug', 'warn', 'error']) console[name] = () => {}

// pele sizes text with a Helvetica width table, so a metric-compatible font keeps labels inside their boxes.
const FONTS = [
  { family: 'Helvetica', path: '/System/Library/Fonts/Helvetica.ttc' },
  { family: 'Hiragino Sans GB', path: '/System/Library/Fonts/Hiragino Sans GB.ttc' },
  { family: 'SF Hebrew', path: '/System/Library/Fonts/SFHebrew.ttf' },
  { family: 'Geeza Pro', path: '/System/Library/Fonts/GeezaPro.ttc' },
  { family: 'Liberation Sans', path: '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf' },
  { family: 'Liberation Sans', path: '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf' },
  { family: 'Liberation Sans', path: '/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf' },
  { family: 'Liberation Sans', path: '/usr/share/fonts/liberation-sans/LiberationSans-Bold.ttf' },
  { family: 'DejaVu Sans', path: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf' },
  { family: 'Noto Sans CJK TC', path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc' },
  { family: 'Noto Sans CJK TC', path: '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc' },
]

const readable = path => {
  try {
    return readFileSync(path)
  } catch {
    return null
  }
}

const found = FONTS.map(font => ({ ...font, buffer: readable(font.path) })).filter(font => font.buffer)
const fontBuffers = found.map(font => font.buffer)
const family = found[0]?.family
await initWasm(resvgWasm)

const ZOOM = 2
// The longest side of the PNG: a larger diagram is drawn smaller, keeping its shape.
const MAX_SIDE = 4096
const LIMIT = 100000

const draw = (source, theme) => {
  let drawn
  try {
    drawn = render(source, { limit: LIMIT })
  } catch (error) {
    return { error: String(error?.message ?? error) }
  }
  const svg = flatten(drawn.svg, theme)
  if (svg === null) return { error: 'diagram has a color pele left unset' }
  if (!family) return { error: 'no system font found to draw text' }
  const zoom = Math.min(ZOOM, MAX_SIDE / Math.max(drawn.width, drawn.height, 1))
  const resvg = new Resvg(svg, {
    background: theme['--pele-bg'] ?? '#ffffff',
    fitTo: { mode: 'zoom', value: zoom },
    font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: family, sansSerifFamily: family },
  })
  // resvg's objects live in wasm memory, which garbage collection never reaches, so each is freed by hand.
  try {
    const image = resvg.render()
    try {
      return { png: image.asPng() }
    } finally {
      image.free()
    }
  } finally {
    resvg.free()
  }
}

parentPort.on('message', ({ id, source, theme }) => {
  let result
  try {
    result = draw(source, theme ?? {})
  } catch (error) {
    result = { error: `diagram failed to render: ${error?.message ?? error}` }
  }
  parentPort.postMessage({ id, ...result }, result.png ? [result.png.buffer] : [])
})
