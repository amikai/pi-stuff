import { readFileSync } from 'node:fs'
import { parentPort } from 'node:worker_threads'
import * as viz from '@viz-js/viz'
import { initWasm, Resvg } from '@resvg/resvg-wasm'
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'
import './themes.js'
import c4Bundle from './c4.txt'

// The engine logs through console, which a worker forwards to the parent's stdout and would draw over pi's screen.
for (const name of ['log', 'info', 'debug', 'warn', 'error']) console[name] = () => {}

// The engine reads no file and no URL itself: it asks these two loaders, which serve only the bundled C4 library.
const C4_THEME = /^C4-PlantUML\/themes\/puml-theme-([\w-]+)\.puml$/
let c4 = null
const loadC4 = () => {
  if (!c4) {
    new Function('window', c4Bundle)(globalThis)
    c4 = globalThis.PLANTUML_STDLIB.c4
  }
  return c4
}
globalThis.PLANTUML_STDLIB_LOADER = (url, ok, fail) => {
  if (url !== 'c4.min.js') return fail(`${url} is not bundled`)
  loadC4()
  ok()
}
// The TeaVM engine cannot read a theme from the standard library, only from a host folder, so C4's themes are served as one.
globalThis.PLANTUML_FILE_LOADER = (path, _from, ok) => {
  const name = C4_THEME.exec(path)?.[1]
  const lines = name && loadC4()[`themes/puml-theme-${name.toLowerCase()}`]
  if (!lines) return false
  ok(path, lines.join('\n'))
}

let vizInstance
globalThis.Viz = { instance: () => (vizInstance ??= viz.instance()) }
const { renderSvg } = await import('./engine.js')

// The engine sizes text with a Helvetica/Arial width table, so a metric-compatible font keeps labels inside their boxes.
const FONTS = [
  { family: 'Helvetica', path: '/System/Library/Fonts/Helvetica.ttc' },
  { family: 'Hiragino Sans GB', path: '/System/Library/Fonts/Hiragino Sans GB.ttc' },
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
// PlantUML paints the background as CSS on the <svg> element, which resvg ignores.
const BACKGROUND = /<svg\b[^>]*\bstyle="[^"]*\bbackground:\s*([^;"]+)/

const render = source =>
  new Promise(resolve => {
    renderSvg(source, json => {
      const result = JSON.parse(json)
      if (!result.valid) return resolve({ error: result.errorMessage ?? 'diagram failed to render', line: result.errorLineNumber })
      if (!family) return resolve({ error: 'no system font found to draw text' })
      const png = new Resvg(result.svg, {
        background: BACKGROUND.exec(result.svg)?.[1].trim() ?? '#FFFFFF',
        fitTo: { mode: 'zoom', value: ZOOM },
        font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: family, sansSerifFamily: family },
      })
        .render()
        .asPng()
      resolve({ png })
    })
  })

parentPort.on('message', async ({ id, source }) => {
  try {
    const result = await render(source)
    parentPort.postMessage({ id, ...result }, result.png ? [result.png.buffer] : [])
  } catch (error) {
    parentPort.postMessage({ id, error: `diagram failed to render: ${error?.message ?? error}` })
  }
})
