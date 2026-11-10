// resvg reads no CSS custom properties, and pele colors everything through var(), so a raw pele SVG draws as black
// boxes. flatten() writes each var() in a tag's styling attributes as its value: the theme's, then the root's
// declaration, then the fallback written in the var() itself. Text between tags and metadata attributes such as
// data-id are left alone, so a label such as "uses var(--x)" stays as written. It returns null when a var() has no
// value at all, so the caller can decline instead of drawing black boxes.

const TAG = /<(?:[^>"']|"[^"]*"|'[^']*')*>/g
const ATTRIBUTE = /(\s)([\w:-]+)="([^"]*)"/g
const CUSTOM = /^\s*(--[\w-]+)\s*:\s*(.*?)\s*$/
// A corner length, in any unit an SVG attribute takes. px is dropped, since a bare number means the same.
const CORNER = /^\s*(rx|ry)\s*:\s*([\d.]+)(px|%|em|ex|pt|pc|mm|cm|in)?\s*$/
// Attributes that hold names, links or label text rather than styling. pele copies labels into data-id.
const METADATA = /^(data-|aria-|xmlns)|^(id|class|role|href|xlink:href|target|rel|xml:space)$/

// A CSS string opens with ' or ", which an attribute value may hold as an entity.
const QUOTES = ["'", '"', '&quot;', '&#34;', '&#39;', '&apos;']
const ENTITY = /&(?:#\d+|#x[0-9a-f]+|[a-z]+);/iy

// The first index from `from` where `stop` holds, or -1. CSS strings are skipped whole, backslash escapes included, so
// a font named 'var(--x' is a name, not a var(). An entity such as &amp; is skipped whole too, so its ; ends nothing.
const walk = (text, from, stop) => {
  for (let i = from; i < text.length; i++) {
    const quote = QUOTES.find(q => text.startsWith(q, i))
    if (quote) {
      for (i += quote.length; i < text.length && !text.startsWith(quote, i); i++) if (text[i] === '\\') i++
      i += quote.length - 1
      continue
    }
    ENTITY.lastIndex = i
    if (ENTITY.test(text)) {
      i = ENTITY.lastIndex - 1
      continue
    }
    if (stop(i)) return i
  }
  return -1
}

// A style's declarations, split at the semicolons between them, not at one that ends an entity such as &quot;.
const declarations = style => {
  const parts = []
  let from = 0
  for (let end = walk(style, 0, i => style[i] === ';'); end !== -1; end = walk(style, from, i => style[i] === ';')) {
    parts.push(style.slice(from, end))
    from = end + 1
  }
  parts.push(style.slice(from))
  return parts.map(part => part.trim()).filter(Boolean)
}

// The index of the parenthesis that closes the one at `open`, or -1.
const closing = (text, open) => {
  let depth = 0
  return walk(text, open, i => {
    if (text[i] === '(') depth++
    else if (text[i] === ')') return --depth === 0
    return false
  })
}

// The index of the first comma outside any parentheses, or -1.
const topComma = text => {
  let depth = 0
  return walk(text, 0, i => {
    if (text[i] === '(') depth++
    else if (text[i] === ')') depth--
    else return text[i] === ',' && depth === 0
    return false
  })
}

const nextVar = (text, from) => walk(text, from, i => text.startsWith('var(', i))

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
    for (let start = nextVar(text, from); start !== -1; start = nextVar(text, from)) {
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
      if (corner) corners[corner[1]] = corner[2] + (corner[3] === undefined || corner[3] === 'px' ? '' : corner[3])
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
