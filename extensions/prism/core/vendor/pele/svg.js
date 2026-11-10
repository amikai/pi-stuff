// resvg reads no CSS custom properties, and pele colors everything through var(), so a raw pele SVG draws as black
// boxes. flatten() writes each var() in a tag's attributes as its value: the theme's, then the root's declaration,
// then the fallback written in the var() itself. Text between tags is left alone, so a label such as
// "uses var(--x)" stays as written. It returns null when a var() has no value at all, so the caller can decline
// instead of drawing black boxes.

const TAG = /<(?:[^>"']|"[^"]*"|'[^']*')*>/g
const ATTRIBUTE = /(\s)([\w:-]+)="([^"]*)"/g
const VAR = /var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g
const CUSTOM = /^\s*(--[\w-]+)\s*:\s*(.*?)\s*$/
const CORNER = /^\s*(rx|ry)\s*:\s*([\d.]+)(px)?\s*$/

const declarations = style => style.split(';').map(part => part.trim()).filter(Boolean)

export const flatten = (svg, theme = {}) => {
  const root = /^\s*<svg\b(?:[^>"']|"[^"]*"|'[^']*')*>/.exec(svg)?.[0] ?? ''
  const own = {}
  for (const part of declarations(/\sstyle="([^"]*)"/.exec(root)?.[1] ?? '')) {
    const custom = CUSTOM.exec(part)
    if (custom) own[custom[1]] = custom[2]
  }
  let missing = false
  const resolve = (text, depth) =>
    text.replace(VAR, (_, name, fallback) => {
      const value = theme[name] ?? own[name] ?? fallback
      if (value === undefined || depth > 8) {
        missing = true
        return ''
      }
      return resolve(value.trim(), depth + 1)
    })

  // resvg reads rx and ry as attributes only, so a corner written as CSS moves out of the style.
  const restyle = (style, tag) => {
    const kept = []
    const corners = []
    for (const part of declarations(style)) {
      if (CUSTOM.test(part)) continue
      const corner = CORNER.exec(part)
      if (corner && !new RegExp(`\\s${corner[1]}=`).test(tag)) corners.push(` ${corner[1]}="${corner[2]}"`)
      else kept.push(part)
    }
    return { style: kept.join(';'), corners: corners.join('') }
  }

  const out = svg.replace(TAG, tag => {
    if (!tag.includes('var(') && !tag.includes('style="')) return tag
    let corners = ''
    const written = tag.replace(ATTRIBUTE, (_, space, name, value) => {
      const flat = resolve(value, 0)
      if (name !== 'style') return `${space}${name}="${flat}"`
      const restyled = restyle(flat, tag)
      corners += restyled.corners
      return restyled.style === '' ? '' : `${space}style="${restyled.style}"`
    })
    return corners === '' ? written : written.replace(/\s*(\/?)>$/, `${corners}$1>`)
  })
  return missing ? null : out
}
