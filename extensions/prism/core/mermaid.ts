import { Fragment, h } from "./jsx.ts";
import type { ElementTable, RenderElement } from "./jsx.ts"
import type { ChartArt, Pie, Rgb } from "./charts.ts"
import { ganttText, pieRgba, pieText, rgbaPng } from "./charts.ts"
import { drawFigure, isFigureLang } from "./figure.ts"
import { fitImage, ratexColor } from "./latex.ts"
import { mermanPicture } from "./merman.ts"
import type { Picture } from "./merman.ts"
import type { Wake } from "./background.ts"
import type { Block } from "./markdown.ts"
import type { Drawn, DrawnBlock } from "./render.ts"
import { cells, graphemes, heldLtr, mirrored, remember, width } from "./render.ts"
import { asIs, hasRtl, holdEngine, holdRow, holdVisual, led } from "./rtl.ts"
import type { Style, Theme } from "./theme.ts"
import { renderMermaidAscii, setChartSize } from "./vendor/mermaid-text.js"
function _extends() {return _extends = Object.assign ? Object.assign.bind() : function (n) {for (var e = 1; e < arguments.length; e++) {var t = arguments[e];for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]);}return n;}, _extends.apply(null, arguments);}











const MAX_LINES = 80;
const PAD = '\uFDD0';
const textCache = new Map();

const chartSize = (columns, source = '') => {
  const labels = (/^\s*x-axis\b[^[\n]*\[([^\]\n]*)\]/m.exec(source)?.[1] ?? '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
  const fit = labels.length * (Math.max(...labels.map((l) => l.length)) + 2);
  const width = Math.max(24, Math.min(60, Math.max(Math.floor(columns / 6), fit), columns - 12));
  return { width, height: Math.max(8, Math.min(20, Math.round(width * 0.3))) };
};

const padWide = (source) => /^[\x00-\x7F]*$/.test(source) ? source : graphemes(source).map((g) => g.length === 1 && width(g) === 2 ? g + PAD : g).join('');

const unquoteCategories = (source) =>
source.replace(/^(\s*x-axis\b[^[\n]*\[)([^\]\n]*)\]/m, (_, head, items) => `${head}${items.replace(/"([^"]*)"/g, (_q, s) => s.replaceAll(',', ' '))}]`);

const BLOCK = /[█▀▄]/;

const labelBars = (art, source) => {
  const series = source.match(/^\s*(bar|line)\b.*$/gm) ?? [];
  const values = /^\s*bar\b[^[\n]*\[([^\]\n]*)\]/m.exec(source)?.[1]?.split(',').map((v) => v.trim());
  if (series.length !== 1 || !values || /^\s*xychart(-beta)?\s+horizontal/m.test(source)) return art;
  const grid = ['', ...art.split('\n')].map((l) => [...l]);
  const gutter = (r) => /^\s*(-?[\d.]+)[┤┼]/.exec(grid[r]?.join('') ?? '')?.[1];
  const axis = grid.findLastIndex((_, r) => gutter(r) !== undefined);
  const ticks = [...(grid[axis]?.join('') ?? '').matchAll(/┬|▀+/g)].map((m) => m.index + Math.floor(m[0].length / 2));
  if (ticks.length !== values.length) return art;
  const zero = grid.findIndex((_, r) => gutter(r) === '0');
  const top = grid.findIndex((_, r) => gutter(r) !== undefined);
  const base = zero !== -1 ? zero : gutter(top)?.startsWith('-') ? top : axis;
  ticks.forEach((x, k) => {
    const filled = grid.flatMap((row, r) => BLOCK.test(row[x] ?? '') ? [r] : []);
    const y = Number(values[k]) < 0 ? (filled.at(-1) ?? base) + 1 : (filled[0] ?? base) - 1;
    const text = [...values[k]];
    const bar = grid[filled[0] ?? -1] ?? [];
    let [left, right] = [x, x];
    while (BLOCK.test(bar[left - 1] ?? '')) left--;
    while (BLOCK.test(bar[right + 1] ?? '')) right++;
    const from = left + Math.ceil((right - left + 1 - text.length) / 2);
    const row = y < axis ? grid[y] : undefined;
    if (!row) return;
    while (row.length < from + text.length) row.push(' ');
    if (!text.every((_, i) => /[ ·]/.test(row[from + i] ?? ' '))) return;
    text.forEach((ch, i) => row[from + i] = ch);
  });
  return grid.map((row) => row.join('').trimEnd()).join('\n').replace(/^\n/, '');
};

const SIDEWAYS = /^(\s*(?:flowchart|graph)[ \t]+)(LR|RL)\b/;

const SUPPORTED = /^(flowchart|graph|statediagram(-v2)?|xychart(-beta)?|sequencediagram|classdiagram|erdiagram|pie|gantt)$/i;

const kindOf = (source) => source.replace(/^(\s*%%[^\n]*\n)+/, '').trim().split(/\s/)[0] ?? '';

const unsupportedKind = (source) => {
  const kind = kindOf(source);
  return kind && !SUPPORTED.test(kind) ? kind : undefined;
};

const OWN = {
  pie: pieText,
  gantt: (source, ascii, columns) => {
    const text = ganttText(source, ascii, columns);
    return text === null ? null : { text };
  }
};

const INLINE_TAG = /<\/?(?:b|i|u|s|em|strong|del|code|small|sub|sup|span|mark)\b[^<>\n]*>/gi;


const TAG_MARK = { i: 'italic', em: 'italic', b: 'bold', strong: 'bold', u: 'underline', s: 'strikethrough', del: 'strikethrough' };

const inlineMarks = (source) =>
[...source.matchAll(/<(i|em|b|strong|u|s|del)\b[^<>\n]*>([^<\n]+)<\/\1\s*>/gi)].
map((m) => [cells(m[2].trim()), { [TAG_MARK[m[1].toLowerCase()]]: true }]);

const fitted = new Map();
const artWidths = new Map();
const artWidth = (art) => remember(artWidths, art, () => Math.max(...art.split('\n').map(width)));

const mermaidText = (source, ascii, columns, pieColors = 0) => mermaidArt(source, ascii, columns, pieColors)?.text ?? null;

const mermaidArt = (source, ascii, columns, pieColors) =>
remember(fitted, `${ascii}:${columns}:${pieColors}:${source}`, () => {
  source = source.replace(INLINE_TAG, '');
  if (source.length > 8000 || source.split('\n').length > MAX_LINES) return null;
  const own = OWN[kindOf(source).toLowerCase()];
  if (own) return own(source, ascii, columns, pieColors);
  const art = draw(source, ascii, columns);
  const text = art === null || artWidth(art) <= columns - 2 || !SIDEWAYS.test(source) ? art : draw(source.replace(SIDEWAYS, '$1TD'), ascii, columns) ?? art;
  return text === null ? null : { text, series: chartSeries(source, ascii, columns) };
});

const prepared = (padded) => unquoteCategories(padded.replace(/^(\s*%%[^\n]*\n)+/, '')).replace(/(-->|-\.->|==>|---|-\.-|===)[ \t]+\|/g, '$1|');

const NEUTRAL = '#808080';
const PROBE = { fg: NEUTRAL, border: NEUTRAL, line: NEUTRAL, arrow: NEUTRAL, corner: NEUTRAL, junction: NEUTRAL, accent: '#ff0000', bg: '#000000' };
const SGR = /\x1b\[([\d;]*)m/g;

const seriesOf = (colored) => {
  const hues = colored.split('\n').map((line) => {
    const row = [];
    let hue;
    let at = 0;
    const take = (text) => graphemes(text).forEach(() => row.push(hue));
    for (const m of line.matchAll(SGR)) {
      take(line.slice(at, m.index));
      hue = m[1].startsWith('38;2;') && m[1] !== '38;2;128;128;128' ? m[1] : undefined;
      at = m.index + m[0].length;
    }
    take(line.slice(at));
    return row;
  });
  const legend = hues.find((row) => row.some(Boolean)) ?? [];
  const order = [...new Set(legend.filter((h) => h !== undefined))];
  return hues.map((row) => row.map((h) => h === undefined ? -1 : order.indexOf(h)));
};

const seriesCache = new Map();

const chartSeries = (source, ascii, columns) => {
  if (!/^\s*xychart/.test(source) || (source.match(/^\s*(bar|line)\b/gm) ?? []).length < 2) return undefined;
  const padded = padWide(source);
  const size = chartSize(columns, padded);
  return remember(seriesCache, `${ascii}:${size.width}:${source}`, () => {
    try {
      setChartSize(size.width, size.height);
      return seriesOf(renderMermaidAscii(prepared(padded), { useAscii: ascii, colorMode: 'truecolor', theme: PROBE, paddingX: 3, paddingY: 1 }));
    } catch {
      return null;
    }
  }) ?? undefined;
};

const draw = (source, ascii, columns) => {
  const isChart = /^\s*xychart/.test(source);
  const padded = padWide(source);
  const size = chartSize(columns, isChart ? padded : '');
  const key = `${ascii}:${isChart ? size.width : 0}:${source}`;
  return remember(textCache, key, () => {
    try {
      if (isChart) setChartSize(size.width, size.height);
      const art = renderMermaidAscii(prepared(padded), { useAscii: ascii, colorMode: 'none', paddingX: 3, paddingY: 1 }).replace(/[ \t]+$/gm, '').trimEnd().replace(/▶/g, '►').replace(/◀/g, '◄');
      return (isChart ? labelBars(art, padded) : art.split('\n').filter((l) => !/^[\s│|]*$/.test(l)).join('\n')).replaceAll(PAD, '');
    } catch {
      return null;
    }
  });
};

const LINE = /[─-╿◇▏]/;
const ARROW = /[►◄▲▼]/;
const PART = /[▐▏▎▍▌▋▊▉]/;

const barStart = (row, c) => {
  const ch = row[c] ?? '';
  const solid = BLOCK.test(ch) ? ch : PART.test(ch) && row[c + 1] === '█' ? '█' : PART.test(ch) && row[c - 1] === '█' ? '█' : '';
  if (!solid) return -1;
  let start = BLOCK.test(ch) ? c : row[c + 1] === '█' ? c + 1 : c - 1;
  while (row[start - 1] === solid) start--;
  return start;
};



const diagramPalette = (t) => [...new Set([t.link, t.number, t.heading, t.emphasis, t.path, t.codeFlag, t.accent])].filter((c) => c !== undefined);

const paint = (art, style, series) => {
  const t = style.theme;
  const grid = art.split('\n').map(cells);
  const cell = (r, c) => grid[r]?.[c] ?? '';
  const color = grid.map((row) => row.map(() => undefined));
  const palette = diagramPalette(t);
  const next = (i) => palette[i % palette.length];
  const labels = new Map();

  const rects = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
      if (!/[┌╭(]/.test(cell(r, c))) continue;
      let c2 = c + 1;
      while (/[─┬┴┼▲▼]/.test(cell(r, c2))) c2++;
      if (!/[┐╮)]/.test(cell(r, c2)) || c2 === c + 1) continue;
      let r2 = r + 1;
      while (/[│├┤┼►◄]/.test(cell(r2, c))) r2++;
      if (!/[└╰(]/.test(cell(r2, c)) || !/[┘╯)]/.test(cell(r2, c2))) continue;
      rects.push({ r, c, r2, c2 });
    }
  }
  const inside = (a, b) => a !== b && b.r > a.r && b.r2 < a.r2 && b.c > a.c && b.c2 < a.c2;
  for (const box of rects.filter((a) => !rects.some((b) => inside(a, b)))) {
    const { r, c, r2, c2 } = box;
    const label = grid.slice(r + 1, r2).map((row) => row.slice(c + 1, c2).join('')).join(' ').trim();
    if (!labels.has(label)) labels.set(label, next(labels.size));
    const hue = labels.get(label);
    for (let y = r; y <= r2; y++) for (let x = c; x <= c2; x++) if (cell(y, x).trim()) color[y][x] = hue;
  }

  const bars = [...new Set(grid.flatMap((row) => row.flatMap((ch, c) => BLOCK.test(ch) && row[c - 1] !== ch ? [c] : [])))].sort((a, b) => a - b);
  const ends = bars.map((x) => {
    const row = grid.find((row) => BLOCK.test(row[x] ?? ''));
    let end = x;
    while (row[end + 1] === row[x]) end++;
    return end;
  });
  const tops = bars.map((x) => {
    const r = grid.findIndex((row) => BLOCK.test(row[x] ?? ''));
    return r * 2 + (grid[r][x] === '▄' ? 1 : 0);
  });
  const single = bars.length > 1 && bars.every((x, i) => i === 0 || x - ends[i - 1] > 2);
  const barColor = (i) => single ? tops[i] === Math.min(...tops) ? t.emphasis ?? t.accent : t.quote : next(i);
  series?.forEach((row, r) => row.forEach((owner, c) => owner >= 0 && grid[r]?.[c]?.trim() && (color[r][c] = next(owner))));
  grid.forEach((row, r) =>
  row.forEach((ch, c) => {
    if (color[r][c] !== undefined) return;
    const start = barStart(row, c);
    if (start >= 0) color[r][c] = barColor(bars.indexOf(start));else
    if (ch === '·') color[r][c] = t.rule;else
    if (ARROW.test(ch)) color[r][c] = t.accent;else
    if (LINE.test(ch)) color[r][c] = t.diagram;else
    if (/^\d+[┤┼]/.test(row.slice(c).join(''))) color[r][c] = t.number;else
    color[r][c] = t.diagramText;
  })
  );
  return { grid, colors: color };
};

const paintPie = (art, slices, style) => {
  const t = style.theme;
  const palette = diagramPalette(t);
  const grid = art.split('\n').map(cells);
  const hue = (slice) => slice < 0 ? t.diagramText : palette[slice % palette.length];
  return { grid, colors: grid.map((row, r) => row.map((_, c) => hue(slices[r]?.[c] ?? -1))) };
};

const painted = new WeakMap();

const piePainted = new WeakMap();

const painting = (style, art, slices, series) => {
  if (!slices) {
    const cache = painted.get(style.theme) ?? new Map();
    painted.set(style.theme, cache);
    return remember(cache, art, () => paint(art, style, series));
  }
  const cache = piePainted.get(style.theme) ?? new WeakMap();
  piePainted.set(style.theme, cache);
  const done = cache.get(slices) ?? paintPie(art, slices, style);
  cache.set(slices, done);
  return done;
};

const boxArt = ({ Box, Text }, style, art, key, marks = [], slices, series) => {
  const { grid, colors } = painting(style, art, slices, series);
  const visual = style.reorder && style.shape === 'visual' && hasRtl(art);
  return (
    h(Box, { key: key, flexDirection: "column", paddingLeft: mirrored(style) ? 0 : 2 },
    grid.map((row, i) => {
      const { cells: chars, from } = mirrored(style) ? led(row, holdRow(row)) : style.shape === 'engine' ? holdEngine(row) : visual ? holdVisual(row) : asIs(row);
      const marked = row.map(() => undefined);
      for (const [phrase, mark] of marks)
      for (let c = 0; c + phrase.length <= row.length; c++)
      if (phrase.every((ch, k) => row[c + k] === ch)) for (let k = 0; k < phrase.length; k++) marked[c + k] = mark;
      const hueAt = (p) => colors[i]?.[from[p]];
      const markAt = (p) => marked[from[p]];
      const parts = [];
      let at = 0;
      while (at < chars.length) {
        const hue = hueAt(at);
        const mark = markAt(at);
        let end = at + 1;
        while (end < chars.length && hueAt(end) === hue && markAt(end) === mark) end++;
        parts.push(h(Text, _extends({ key: `t${parts.length}`, color: hue }, mark), chars.slice(at, end).join('')));
        at = end;
      }
      return h(Text, _extends({ key: `${key}.${i}` }, heldLtr(style)), parts.length ? parts : ' ');
    })
    ));

};

const EDGE_LABEL = /(-[-.=]+\s*)"([^"\n]+)"(\s*[-.=]+>)|\|([^|\n]+)\|/g;

const cap = (label, max) => {
  const flat = label.replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
  const chars = graphemes(flat);
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : flat;
};

const shortenEdgeLabels = (source, max) =>
source.replace(EDGE_LABEL, (_, open, quoted, close, piped) =>
quoted !== undefined ? `${open}"${cap(quoted, max)}"${close}` : `|${cap(piped, max)}|`);

const pieColorsOf = (style) => style.pieStyle === 'round' ? diagramPalette(style.theme).length : 0;

const PIE_ROW_PX = 40;

const exact = (color: string) => /^(#|rgb\()/i.test(color.trim()) || Number(/^ansi256\((\d+)\)$/i.exec(color.trim())?.[1]) >= 16;

const rgbOf = (color: string): Rgb | null => {
  const hex = exact(color) ? /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(ratexColor(color))?.[1] : undefined;
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return [0, 2, 4].map((k) => Number.parseInt(full.slice(k, k + 2), 16)) as unknown as Rgb;
};

const pictures = new Map<string, string>();

const piePicture = ({ Box, Text, Image }, style: Style, pie: Pie, key: string) => {
  const palette = diagramPalette(style.theme);
  const colors = palette.map(rgbOf);
  if (colors.some((c) => c === null)) return null;
  const side = 2 * pie.radius * PIE_ROW_PX;
  const png = remember(pictures, `${side}:${pie.bounds}:${colors}`, () => rgbaPng(pieRgba(pie.bounds, colors as Rgb[], side), side).toString('base64'), 8);
  const lead = Math.floor((2 * pie.radius - pie.legend.length) / 2);
  return (
    h(Box, { key: key, flexDirection: "column", paddingLeft: 2 },
    pie.title ? h(Text, { color: style.theme.diagramText }, pie.title) : null,
    h(Box, { flexDirection: "row" },
    h(Image, { source: { png }, columns: 4 * pie.radius, rows: 2 * pie.radius, alt: "pie chart" }),
    h(Box, { flexDirection: "column", paddingLeft: 3 },
    Array.from({ length: lead }, (_, i) => h(Text, { key: `s${i}` }, ' ')),
    pie.legend.map((line, i) =>
    h(Text, { key: `l${i}`, color: style.theme.diagramText },
    h(Text, { color: palette[i % palette.length] }, '██'),
    ` ${line}`))))));

};

const chartElement = (el, style: Style, art: ChartArt, block: Extract<Block, { kind: 'code' }>, source: string, key: string) =>
(art.pie && style.images && !block.isOpen && !mirrored(style) && !hasRtl(art.text) ? piePicture(el, style, art.pie, key) : null) ??
boxArt(el, style, art.text, key, inlineMarks(source), art.slices, art.series);

type TextVerdict =
{ fits: true; art: ChartArt } |
{ fits: false; why: 'unsupported'; word: string } |
{ fits: false; why: 'too-wide'; narrowest: number; columns: number } |
{ fits: false; why: 'no-art' };

type GaveUp = Extract<TextVerdict, { fits: false }>;

const textVerdict = (source: string, style: Style, columns: number, pieColors: number): TextVerdict => {
  let narrowest = Infinity;
  for (const max of [Infinity, 24, 12]) {
    const art = mermaidArt(max === Infinity ? source : shortenEdgeLabels(source, max), style.mermaidAscii, columns, pieColors);
    const wide = art === null ? Infinity : artWidth(art.text);
    narrowest = Math.min(narrowest, wide);
    if (art !== null && wide <= columns - 2) return { fits: true, art };
  }
  const word = unsupportedKind(source);
  if (word) return { fits: false, why: 'unsupported', word };
  return narrowest === Infinity ? { fits: false, why: 'no-art' } : { fits: false, why: 'too-wide', narrowest, columns };
};

const textNote = (verdict: GaveUp): string =>
verdict.why === 'unsupported' ? `${verdict.word} diagrams draw as source for now` :
verdict.why === 'no-art' ? 'diagram failed to render' :
`diagram is ${verdict.narrowest} cols, terminal is ${verdict.columns}`;

const PENDING_NOTE = 'drawing with merman…';

const fallback = (verdict: GaveUp, picture: Picture): { note: string } | { png: string; width: number; height: number } => {
  switch (picture.state) {
    case 'drawn':
      return picture;
    case 'pending':
      return { note: PENDING_NOTE };
    case 'declined':
      return { note: textNote(verdict) };
  }
};

const mermaidBlock = (el, style: Style, block: Extract<Block, { kind: 'code' }>, i: number, columns: number, pieColors: number, images: Wake | null): DrawnBlock | undefined => {
  const source = block.lines.join('\n');
  const verdict = textVerdict(source, style, columns, pieColors);
  if (verdict.fits) {
    const { art } = verdict;
    return { element: chartElement(el, style, art, block, source, `b${i}`), art: art.text };
  }
  if (block.isOpen) return undefined;
  const picture: Picture = images ? mermanPicture(source.replace(INLINE_TAG, ''), images) : { state: 'declined' };
  const out = fallback(verdict, picture);
  if ('note' in out) return out;
  const fit = fitImage(out, columns);
  return { element: h(el.Image, { key: `b${i}`, source: { png: out.png }, columns: fit.columns, rows: fit.rows, alt: 'mermaid diagram' }), png: out.png };
};

const drawDiagrams = (el, style: Style, blocks: Block[], columns: number, images: Wake | null): Drawn => {
  const drawn: Drawn = new Map();
  const pieColors = pieColorsOf(style);
  if (style.mermaid) {
    for (const [i, block] of blocks.entries()) {
      if (block.kind !== 'code' || block.lang.toLowerCase() !== 'mermaid') continue;
      const entry = mermaidBlock(el, style, block, i, columns, pieColors, images);
      if (entry) drawn.set(i, entry);
    }
  }
  for (const [i, block] of blocks.entries()) {
    if (block.kind !== 'code' || !isFigureLang(block.lang)) continue;
    const figure = drawFigure(el, style, block, columns, `b${i}`);
    if (figure) drawn.set(i, figure);
  }
  return drawn;
};
export { chartSize, inlineMarks, mermaidText, diagramPalette, boxArt, shortenEdgeLabels, drawDiagrams, fallback, textNote, textVerdict };
