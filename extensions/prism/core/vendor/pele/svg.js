// resvg reads no CSS custom properties, and pele colors everything through var(), so a raw pele SVG draws as black
// boxes. flatten() writes each var() in a tag's styling attributes as its value: the theme's, then the root's
// declaration, then the fallback written in the var() itself. Text between tags and metadata attributes such as
// data-id are left alone, so a label such as "uses var(--x)" stays as written. It returns null when a var() has no
// value at all, so the caller can decline instead of drawing black boxes.

const TAG = /<(?:[^>"']|"[^"]*"|'[^']*')*>/g
const ATTRIBUTE = /(\s)([\w:-]+)="([^"]*)"/g
const CUSTOM = /^\s*(--[\w-]+)\s*:\s*(.*?)\s*$/
const CORNER = /^\s*(rx|ry)\s*:\s*([\d.]+)(px)?\s*$/
// Attributes that hold names, links or label text rather than styling. pele copies labels into data-id.
const METADATA = /^(data-|aria-|xmlns)|^(id|class|role|href|xlink:href|target|rel|xml:space)$/

const declarations = style => style.split(';').map(part => part.trim()).filter(Boolean)

// The index of the parenthesis that closes the one at `open`, or -1.
const closing = (text, open) => {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return i
  }
  return -1
}

// The index of the first comma outside any parentheses, or -1.
const topComma = text => {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') depth--
    else if (text[i] === ',' && depth === 0) return i
  }
  return -1
}

export const flatten = (svg, theme = {}) => {
  const root = /^\s*<svg\b(?:[^>"']|"[^"]*"|'[^']*')*>/.exec(svg)?.[0] ?? ''
  const own = {}
  for (const part of declarations(/\sstyle="([^"]*)"/.exec(root)?.[1] ?? '')) {
    const custom = CUSTOM.exec(part)
    if (custom) own[custom[1]] = custom[2]
  }
  let missing = false

  // Every var() is matched to its own closing parenthesis, and its value and fallback are resolved in turn, so a
  // fallback that is itself a var() or a color function comes out whole.
  const resolve = (text, depth) => {
    let out = ''
    let from = 0
    for (let start = text.indexOf('var(', from); start !== -1; start = text.indexOf('var(', from)) {
      const end = closing(text, start + 3)
      if (end === -1 || depth > 8) {
        missing = true
        return out + text.slice(from)
      }
      const inside = text.slice(start + 4, end)
      const comma = topComma(inside)
      const name = (comma === -1 ? inside : inside.slice(0, comma)).trim()
      const value = theme[name] ?? own[name] ?? (comma === -1 ? undefined : inside.slice(comma + 1))
      if (value === undefined) missing = true
      out += text.slice(from, start) + (value === undefined ? '' : resolve(value.trim(), depth + 1))
      from = end + 1
    }
    return out + text.slice(from)
  }

  // resvg reads rx and ry as attributes only, so a corner written as CSS moves out of the style. As in CSS, the last
  // declaration wins, and it wins over an rx or ry attribute already on the tag.
  const restyle = style => {
    const kept = []
    const corners = {}
    for (const part of declarations(style)) {
      if (CUSTOM.test(part)) continue
      const corner = CORNER.exec(part)
      if (corner) corners[corner[1]] = corner[2]
      else kept.push(part)
    }
    return { style: kept.join(';'), corners }
  }

  const out = svg.replace(TAG, tag => {
    if (!tag.includes('var(') && !tag.includes('style="')) return tag
    let corners = {}
    let written = tag.replace(ATTRIBUTE, (whole, space, name, value) => {
      if (METADATA.test(name)) return whole
      const flat = resolve(value, 0)
      if (name !== 'style') return `${space}${name}="${flat}"`
      const restyled = restyle(flat)
      corners = restyled.corners
      return restyled.style === '' ? '' : `${space}style="${restyled.style}"`
    })
    if (Object.keys(corners).length === 0) return written
    const placed = new Set()
    written = written.replace(ATTRIBUTE, (whole, space, name) => {
      if (!(name in corners)) return whole
      placed.add(name)
      return `${space}${name}="${corners[name]}"`
    })
    const added = Object.entries(corners)
      .filter(([name]) => !placed.has(name))
      .map(([name, value]) => ` ${name}="${value}"`)
      .join('')
    return added === '' ? written : written.replace(/\s*(\/?)>$/, `${added}$1>`)
  })
  return missing ? null : out
}
