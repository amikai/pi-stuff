import { readFileSync } from 'node:fs'
import { parentPort } from 'node:worker_threads'
import { render } from 'pele'
import { initWasm, Resvg } from '@resvg/resvg-wasm'
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'
import { flatten } from './svg.js'
import { FAMILY, fontsFor } from './fonts.js'

// A worker forwards console to the parent's stdout, which would draw over pi's screen.
for (const name of ['log', 'info', 'debug', 'warn', 'error']) console[name] = () => {}

// build.sh copies the fonts into pele/fonts/, beside this bundle. Each is read once, the first time a picture needs it.
const FONT_DIR = new URL('./pele/fonts/', import.meta.url)
const read = new Map()
const font = file => {
  if (!read.has(file)) read.set(file, readFileSync(new URL(file, FONT_DIR)))
  return read.get(file)
}

// The text a picture draws: what is between its tags, with numeric character references written out.
const drawnText = svg =>
  svg
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))

await initWasm(resvgWasm)

const ZOOM = 2
const LIMIT = 100000

// With a pixel width the picture is drawn that wide, whatever the diagram's own size. Without one it is drawn at ZOOM times that size.
const draw = (source, theme, width) => {
  let drawn
  try {
    drawn = render(source, { limit: LIMIT })
  } catch (error) {
    return { error: String(error?.message ?? error) }
  }
  const svg = flatten(drawn.svg, theme)
  if (svg === null) return { error: 'diagram has a color pele left unset' }
  const resvg = new Resvg(svg, {
    background: theme['--pele-bg'] ?? '#ffffff',
    fitTo: width ? { mode: 'width', value: width } : { mode: 'zoom', value: ZOOM },
    font: { fontBuffers: fontsFor(drawnText(svg)).map(font), loadSystemFonts: false, defaultFontFamily: FAMILY, sansSerifFamily: FAMILY },
  })
  // resvg's objects live in wasm memory, which garbage collection never reaches, so each is freed by hand.
  try {
    const image = resvg.render()
    try {
      return { png: image.asPng(), width: drawn.width, height: drawn.height }
    } finally {
      image.free()
    }
  } finally {
    resvg.free()
  }
}

parentPort.on('message', ({ id, source, theme, width }) => {
  let result
  try {
    result = draw(source, theme ?? {}, Number.isInteger(width) && width > 0 ? width : null)
  } catch (error) {
    result = { error: `diagram failed to render: ${error?.message ?? error}` }
  }
  parentPort.postMessage({ id, ...result }, result.png ? [result.png.buffer] : [])
})
