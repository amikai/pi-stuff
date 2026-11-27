import type { Wake } from "./background.ts";
import type { ChartArt, Pie, Rgb } from "./charts.ts";
import { ganttText, pieRgba, pieText, rgbaPng } from "./charts.ts";
import { drawFigure, isFigureLang } from "./figure.ts";
import { gitGraphText } from "./gitgraph.ts";
import { journeyText } from "./journey.ts";
import { type ElementComponent, type ElementTable, h, type RenderElement } from "./jsx.ts";
import { kanbanText } from "./kanban.ts";
import { fillColumns, fitImage, ratexColor } from "./latex.ts";
import { cells, graphemes, width } from "./layout.ts";
import type { Block } from "./markdown.ts";
import { decodeEntities } from "./markdown.ts";
import { mindmapText } from "./mindmap.ts";
import type { Picture } from "./pele.ts";
import { pelePicture } from "./pele.ts";
import { quadrantText } from "./quadrant.ts";
import type { Drawn, DrawnBlock } from "./render.ts";
import { heldLtr, mirrored, remember } from "./render.ts";
import { asIs, hasRtl, holdEngine, holdRow, holdVisual, led } from "./rtl.ts";
import { ARROW_HUE, BAD_HUE, GOOD_HUE, LINE_HUE, oneLine } from "./textart.ts";
import type { Ink, Style, Theme } from "./theme.ts";
import { renderMermaidAscii, setChartSize } from "./vendor/mermaid-text.js";

const _extends = Object.assign;

const MAX_LINES = 80;
const MAX_CHARS = 8000;
const PAD = "\uFDD0";
const textCache = new Map<string, string | null>();

const chartSize = (columns: number, source = "") => {
  const labels = (/^\s*x-axis\b[^[\n]*\[([^\]\n]*)\]/m.exec(source)?.[1] ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""));
  const fit = labels.length * (Math.max(...labels.map((l) => l.length)) + 2);
  const width = Math.max(24, Math.min(60, Math.max(Math.floor(columns / 6), fit), columns - 12));
  return { width, height: Math.max(8, Math.min(20, Math.round(width * 0.3))) };
};

const padWide = (source: string) =>
  /^[\x00-\x7F]*$/.test(source)
    ? source
    : graphemes(source)
        .map((g) => (g.length === 1 && width(g) === 2 ? g + PAD : g))
        .join("");

const unquoteCategories = (source: string) =>
  source.replace(
    /^(\s*x-axis\b[^[\n]*\[)([^\]\n]*)\]/m,
    (_: string, head: string, items: string) =>
      `${head}${items.replace(/"([^"]*)"/g, (_q: string, s: string) => s.replaceAll(",", " "))}]`,
  );

const BLOCK = /[█▀▄]/;

const labelBars = (art: string, source: string): string => {
  const series = source.match(/^\s*(bar|line)\b.*$/gm) ?? [];
  const values = /^\s*bar\b[^[\n]*\[([^\]\n]*)\]/m
    .exec(source)?.[1]
    ?.split(",")
    .map((v) => v.trim());
  if (series.length !== 1 || !values || /^\s*xychart(-beta)?\s+horizontal/m.test(source)) return art;
  const grid = ["", ...art.split("\n")].map((l) => [...l]);
  const gutter = (r: number) => /^\s*(-?[\d.]+)[┤┼]/.exec(grid[r]?.join("") ?? "")?.[1];
  const axis = grid.findLastIndex((_, r) => gutter(r) !== undefined);
  const ticks = [...(grid[axis]?.join("") ?? "").matchAll(/┬|▀+/g)].map((m) => m.index + Math.floor(m[0].length / 2));
  if (ticks.length !== values.length) return art;
  const zero = grid.findIndex((_, r) => gutter(r) === "0");
  const top = grid.findIndex((_, r) => gutter(r) !== undefined);
  const base = zero !== -1 ? zero : gutter(top)?.startsWith("-") ? top : axis;
  ticks.forEach((x, k) => {
    const filled = grid.flatMap((row, r) => (BLOCK.test(row[x] ?? "") ? [r] : []));
    const y = Number(values[k]) < 0 ? (filled.at(-1) ?? base) + 1 : (filled[0] ?? base) - 1;
    const text = [...values[k]!];
    const bar = grid[filled[0] ?? -1] ?? [];
    let [left, right] = [x, x];
    while (BLOCK.test(bar[left - 1] ?? "")) left--;
    while (BLOCK.test(bar[right + 1] ?? "")) right++;
    const from = left + Math.ceil((right - left + 1 - text.length) / 2);
    const row = y < axis ? grid[y] : undefined;
    if (!row) return;
    while (row.length < from + text.length) row.push(" ");
    if (!text.every((_, i) => /[ ·]/.test(row[from + i] ?? " "))) return;
    text.forEach((ch, i) => {
      row[from + i] = ch;
    });
  });
  return grid
    .map((row) => row.join("").trimEnd())
    .join("\n")
    .replace(/^\n/, "");
};

const SIDEWAYS = /^(\s*(?:flowchart|graph)[ \t]+)(LR|RL)\b/;
const LABELED_EDGE = /\|[^|\n]+\||(?<![-.=])(?:--|==|-\.)[ \t]*[^-.=>\s]/;
const rowsBetween = (source: string) =>
  /^\s*(?:flowchart|graph)\b/.test(source) && !SIDEWAYS.test(source) && LABELED_EDGE.test(source) ? 3 : 1;

const SUPPORTED =
  /^(flowchart|graph|statediagram(-v2)?|xychart(-beta)?|sequencediagram|classdiagram|erdiagram|pie|gantt|quadrantchart|mindmap|journey|kanban|gitgraph)$/i;

const kindOf = (source: string): string =>
  source
    .replace(/^(\s*%%[^\n]*\n)+/, "")
    .trim()
    .split(/[\s:]/)[0] ?? "";

const unsupportedKind = (source: string): string | undefined => {
  const kind = kindOf(source);
  return kind && !SUPPORTED.test(kind) ? kind : undefined;
};

type Own = (source: string, ascii: boolean, columns: number, pieColors: number, aspect: number) => ChartArt | null;

const OWN: Partial<Record<string, Own>> = {
  pie: pieText,
  gantt: (source, ascii, columns) => {
    const text = ganttText(source, ascii, columns);
    return text === null ? null : { text };
  },
  quadrantchart: quadrantText,
  mindmap: mindmapText,
  journey: journeyText,
  kanban: kanbanText,
  gitgraph: gitGraphText,
};

const INLINE_TAG = /<\/?(?:b|i|u|s|em|strong|del|code|small|sub|sup|span|mark)\b[^<>\n]*>/gi;

export type MarkName = "italic" | "bold" | "underline" | "strikethrough";
export type Mark = Partial<Record<MarkName, true>>;
export type Marked = [phrase: string[], mark: Mark];

const TAG_MARK: Record<string, MarkName> = {
  i: "italic",
  em: "italic",
  b: "bold",
  strong: "bold",
  u: "underline",
  s: "strikethrough",
  del: "strikethrough",
};

const inlineMarks = (source: string): Marked[] =>
  [...source.matchAll(/<(i|em|b|strong|u|s|del)\b[^<>\n]*>([^<\n]+)<\/\1\s*>/gi)].map((m) => [
    cells(m[2]!.trim()),
    { [TAG_MARK[m[1]!.toLowerCase()]!]: true },
  ]);

const fitted = new Map<string, ChartArt | null>();
const artWidths = new Map<string, number>();
const artWidth = (art: string): number => remember(artWidths, art, () => Math.max(...art.split("\n").map(width)));

const mermaidText = (source: string, ascii: boolean, columns: number, pieColors = 0): string | null =>
  mermaidArt(source, ascii, columns, pieColors)?.text ?? null;

const mermaidArt = (source: string, ascii: boolean, columns: number, pieColors: number, aspect = 2): ChartArt | null =>
  remember(fitted, `${ascii}:${columns}:${pieColors}:${aspect}:${source}`, () => {
    source = source.replace(INLINE_TAG, "");
    if (source.length > MAX_CHARS || source.split("\n").length > MAX_LINES) return null;
    const own = OWN[kindOf(source).toLowerCase()];
    if (own) return own(labelEntities(source, false), ascii, columns, pieColors, aspect);
    const fits = (art: string | null) => art === null || artWidth(art) <= columns - 2;
    const wide = draw(source, ascii, columns);
    const art = fits(wide) ? wide : (draw(source, ascii, columns, 1) ?? wide);
    const text =
      fits(art) || !SIDEWAYS.test(source) ? art : (draw(source.replace(SIDEWAYS, "$1TD"), ascii, columns) ?? art);
    return text === null ? null : { text, series: chartSeries(source, ascii, columns) };
  });

const MERMAID_ENTITY = /#(\d{1,7}|[A-Za-z][A-Za-z\d]{1,31});/g;
const SHIELD = '[]{}()|<>"';
const SHIELDED = /[\uf100-\uf109]/g;
const STYLE_LINE = /^\s*(?:style|classDef|linkStyle)\b/;
const shielded = (ch: string) =>
  [...ch].map((c) => (SHIELD.includes(c) ? String.fromCharCode(0xf100 + SHIELD.indexOf(c)) : c)).join("");
const entityChar = (m: string, e: string, shield: boolean): string => {
  const ch = decodeEntities(/^\d/.test(e) ? `&#${e};` : `&${e};`);
  if (ch === `&${e};` || ch.includes("\n")) return m;
  return shield ? shielded(ch) : ch;
};
const labelEntities = (source: string, shield: boolean): string =>
  !source.includes("#")
    ? source
    : source
        .split("\n")
        .map((line) =>
          STYLE_LINE.test(line) ? line : line.replace(MERMAID_ENTITY, (m, e: string) => entityChar(m, e, shield)),
        )
        .join("\n");
const unshield = (text: string) => text.replace(SHIELDED, (c) => SHIELD[c.charCodeAt(0) - 0xf100]!);

const prepared = (padded: string): string =>
  labelEntities(
    unquoteCategories(padded.replace(/^(\s*%%[^\n]*\n)+/, "")).replace(/(-->|-\.->|==>|---|-\.-|===)[ \t]+\|/g, "$1|"),
    true,
  );

const NEUTRAL = "#808080";
const PROBE = {
  fg: NEUTRAL,
  border: NEUTRAL,
  line: NEUTRAL,
  arrow: NEUTRAL,
  corner: NEUTRAL,
  junction: NEUTRAL,
  accent: "#ff0000",
  bg: "#000000",
};
const SGR = /\x1b\[([\d;]*)m/g;

const seriesOf = (colored: string): number[][] => {
  const hues = colored.split("\n").map((line) => {
    const row: (string | undefined)[] = [];
    let hue: string | undefined;
    let at = 0;
    const take = (text: string) =>
      graphemes(text).forEach(() => {
        row.push(hue);
      });
    for (const m of line.matchAll(SGR)) {
      take(line.slice(at, m.index));
      hue = m[1]!.startsWith("38;2;") && m[1] !== "38;2;128;128;128" ? m[1] : undefined;
      at = m.index + m[0].length;
    }
    take(line.slice(at));
    return row;
  });
  const legend = hues.find((row) => row.some(Boolean)) ?? [];
  const order = [...new Set(legend.filter((h): h is string => h !== undefined))];
  return hues.map((row) => row.map((h) => (h === undefined ? -1 : order.indexOf(h))));
};

const seriesCache = new Map<string, number[][] | null>();

const chartSeries = (source: string, ascii: boolean, columns: number): number[][] | undefined => {
  if (!/^\s*xychart/.test(source) || (source.match(/^\s*(bar|line)\b/gm) ?? []).length < 2) return undefined;
  const padded = padWide(source);
  const size = chartSize(columns, padded);
  return (
    remember(seriesCache, `${ascii}:${size.width}:${source}`, () => {
      try {
        setChartSize(size.width, size.height);
        return seriesOf(
          renderMermaidAscii(prepared(padded), {
            useAscii: ascii,
            colorMode: "truecolor",
            theme: PROBE,
            paddingX: 3,
            paddingY: 1,
          }),
        );
      } catch {
        return null;
      }
    }) ?? undefined
  );
};

const draw = (source: string, ascii: boolean, columns: number, gap = 3): string | null => {
  const isChart = /^\s*xychart/.test(source);
  const padded = padWide(source);
  const size = chartSize(columns, isChart ? padded : "");
  const key = `${ascii}:${isChart ? size.width : 0}:${gap}:${source}`;
  return remember(textCache, key, () => {
    try {
      if (isChart) setChartSize(size.width, size.height);
      const art: string = renderMermaidAscii(prepared(padded), {
        useAscii: ascii,
        colorMode: "none",
        paddingX: gap,
        paddingY: rowsBetween(padded),
      })
        .replace(/[ \t]+$/gm, "")
        .trimEnd()
        .replace(/▶/g, "►")
        .replace(/◀/g, "◄");
      return unshield(
        (isChart
          ? labelBars(art, padded)
          : art
              .split("\n")
              .filter((l) => !/^[\s│|]*$/.test(l))
              .join("\n")
        ).replaceAll(PAD, ""),
      );
    } catch {
      return null;
    }
  });
};

const LINE = /[─-╿◇▏]/;
const ARROW = /[►◄▲▼]/;
const PART = /[▐▏▎▍▌▋▊▉]/;

const barStart = (row: string[], c: number): number => {
  const ch = row[c] ?? "";
  const solid = BLOCK.test(ch)
    ? ch
    : PART.test(ch) && row[c + 1] === "█"
      ? "█"
      : PART.test(ch) && row[c - 1] === "█"
        ? "█"
        : "";
  if (!solid) return -1;
  let start = BLOCK.test(ch) ? c : row[c + 1] === "█" ? c + 1 : c - 1;
  while (row[start - 1] === solid) start--;
  return start;
};

const diagramPalette = (t: Theme): string[] =>
  [...new Set([t.link, t.number, t.heading, t.emphasis, t.path, t.codeFlag, t.accent])].filter(
    (c): c is string => c !== undefined,
  );

export type Painted = { grid: string[][]; colors: (string | undefined)[][] };

type Rect = { r: number; c: number; r2: number; c2: number };

const paint = (art: string, t: Theme, series?: number[][]): Painted => {
  const grid = art.split("\n").map(cells);
  const cell = (r: number, c: number) => grid[r]?.[c] ?? "";
  const color: (string | undefined)[][] = grid.map((row) => row.map(() => undefined));
  const palette = diagramPalette(t);
  const next = (i: number) => palette[i % palette.length];
  const labels = new Map<string, string | undefined>();

  const rects: Rect[] = [];
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
  const inside = (a: Rect, b: Rect) => a !== b && b.r > a.r && b.r2 < a.r2 && b.c > a.c && b.c2 < a.c2;
  for (const box of rects.filter((a) => !rects.some((b) => inside(a, b)))) {
    const { r, c, r2, c2 } = box;
    const label = grid
      .slice(r + 1, r2)
      .map((row) => row.slice(c + 1, c2).join(""))
      .join(" ")
      .trim();
    if (!labels.has(label)) labels.set(label, next(labels.size));
    const hue = labels.get(label);
    for (let y = r; y <= r2; y++) for (let x = c; x <= c2; x++) if (cell(y, x).trim()) color[y]![x] = hue;
  }

  const bars = [
    ...new Set(grid.flatMap((row) => row.flatMap((ch, c) => (BLOCK.test(ch) && row[c - 1] !== ch ? [c] : [])))),
  ].sort((a, b) => a - b);
  const ends = bars.map((x) => {
    const row = grid.find((row) => BLOCK.test(row[x] ?? ""))!;
    let end = x;
    while (row[end + 1] === row[x]) end++;
    return end;
  });
  const tops = bars.map((x) => {
    const r = grid.findIndex((row) => BLOCK.test(row[x] ?? ""));
    return r * 2 + (grid[r]![x] === "▄" ? 1 : 0);
  });
  const single = bars.length > 1 && bars.every((x, i) => i === 0 || x - ends[i - 1]! > 2);
  const barColor = (i: number) =>
    single ? (tops[i] === Math.min(...tops) ? (t.emphasis ?? t.accent) : t.quote) : next(i);
  series?.forEach((row, r) => {
    row.forEach((owner, c) => {
      if (owner >= 0 && grid[r]?.[c]?.trim()) color[r]![c] = next(owner);
    });
  });
  grid.forEach((row, r) => {
    row.forEach((ch, c) => {
      if (color[r]![c] !== undefined) return;
      const start = barStart(row, c);
      if (start >= 0) color[r]![c] = barColor(bars.indexOf(start));
      else if (ch === "·") color[r]![c] = t.rule;
      else if (ARROW.test(ch)) color[r]![c] = t.accent;
      else if (LINE.test(ch)) color[r]![c] = t.diagram;
      else if (/^\d+[┤┼]/.test(row.slice(c).join(""))) color[r]![c] = t.number;
      else color[r]![c] = t.diagramText;
    });
  });
  return { grid, colors: color };
};

const paintPie = (art: string, slices: number[][], t: Theme): Painted => {
  const palette = diagramPalette(t);
  const grid = art.split("\n").map(cells);
  const named: Record<number, string | undefined> = {
    [LINE_HUE]: t.diagram,
    [ARROW_HUE]: t.accent,
    [GOOD_HUE]: t.diffAdded,
    [BAD_HUE]: t.diffRemoved,
  };
  const hue = (slice: number) =>
    slice in named ? named[slice] : slice < 0 ? t.diagramText : palette[slice % palette.length];
  return { grid, colors: grid.map((row, r) => row.map((_, c) => hue(slices[r]?.[c] ?? -1))) };
};

const painted = new WeakMap<Theme, Map<string, Painted>>();

const piePainted = new WeakMap<Theme, WeakMap<number[][], Painted>>();

const painting = (theme: Theme, art: string, slices?: number[][], series?: number[][]): Painted => {
  if (!slices) {
    const cache = painted.get(theme) ?? new Map<string, Painted>();
    painted.set(theme, cache);
    return remember(cache, art, () => paint(art, theme, series));
  }
  const cache = piePainted.get(theme) ?? new WeakMap<number[][], Painted>();
  piePainted.set(theme, cache);
  const done = cache.get(slices) ?? paintPie(art, slices, theme);
  cache.set(slices, done);
  return done;
};

const chartHues = ({ grid, colors }: Painted): Ink[][] =>
  colors.map((row, r) =>
    row.map((color, c): Ink => (color !== undefined ? { color } : grid[r]?.[c] === "·" ? { dim: true } : {})),
  );

const boxArt = (
  { Box, Text }: ElementTable,
  style: Style,
  art: string,
  key: string,
  marks: Marked[] = [],
  slices?: number[][],
  series?: number[][],
): RenderElement => {
  const { grid, colors } = painting(style.theme, art, slices, series);
  const visual = style.reorder && style.shape === "visual" && hasRtl(art);
  return h(
    Box,
    { key: key, flexDirection: "column", paddingLeft: mirrored(style) ? 0 : 2 },
    grid.map((row, i) => {
      const { cells: chars, from } = mirrored(style)
        ? led(row, holdRow(row))
        : style.shape === "engine"
          ? holdEngine(row)
          : visual
            ? holdVisual(row)
            : asIs(row);
      const marked: (Mark | undefined)[] = row.map(() => undefined);
      for (const [phrase, mark] of marks)
        for (let c = 0; c + phrase.length <= row.length; c++)
          if (phrase.every((ch, k) => row[c + k] === ch)) for (let k = 0; k < phrase.length; k++) marked[c + k] = mark;
      const hueAt = (p: number) => colors[i]?.[from[p]!];
      const markAt = (p: number) => marked[from[p]!];
      const parts: RenderElement[] = [];
      let at = 0;
      while (at < chars.length) {
        const hue = hueAt(at);
        const mark = markAt(at);
        let end = at + 1;
        while (end < chars.length && hueAt(end) === hue && markAt(end) === mark) end++;
        parts.push(h(Text, _extends({ key: `t${parts.length}`, color: hue }, mark), chars.slice(at, end).join("")));
        at = end;
      }
      return h(Text, _extends({ key: `${key}.${i}` }, heldLtr(style)), parts.length ? parts : " ");
    }),
  );
};

const EDGE_LABEL = /(-[-.=]+\s*)"([^"\n]+)"(\s*[-.=]+>)|\|([^|\n]+)\|/g;

const cap = (label: string, max: number): string => {
  const flat = oneLine(label);
  const chars = graphemes(flat);
  return chars.length > max
    ? `${chars
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`
    : flat;
};

const shortenEdgeLabels = (source: string, max: number): string =>
  source.replace(
    EDGE_LABEL,
    (
      _: string,
      open: string | undefined,
      quoted: string | undefined,
      close: string | undefined,
      piped: string | undefined,
    ) => (quoted !== undefined ? `${open}"${cap(quoted, max)}"${close}` : `|${cap(piped as string, max)}|`),
  );

const pieColorsOf = (style: Style): number => (style.pieStyle === "round" ? diagramPalette(style.theme).length : 0);

const PIE_ROW_PX = 40;

const exact = (color: string) =>
  /^(#|rgb\()/i.test(color.trim()) || Number(/^ansi256\((\d+)\)$/i.exec(color.trim())?.[1]) >= 16;

const rgbOf = (color: string): Rgb | null => {
  const hex = exact(color) ? /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(ratexColor(color))?.[1] : undefined;
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  return [0, 2, 4].map((k) => Number.parseInt(full.slice(k, k + 2), 16)) as unknown as Rgb;
};

const pictures = new Map<string, string>();

const piePicture = ({ Box, Text, Image }: ElementTable, style: Style, pie: Pie, key: string): RenderElement | null => {
  const palette = diagramPalette(style.theme);
  const colors = palette.map(rgbOf);
  if (colors.some((c) => c === null)) return null;
  const side = 2 * pie.radius * PIE_ROW_PX;
  const png = remember(
    pictures,
    `${side}:${pie.bounds}:${colors}`,
    () => rgbaPng(pieRgba(pie.bounds, colors as Rgb[], side), side).toString("base64"),
    8,
  );
  const lead = Math.floor((2 * pie.radius - pie.legend.length) / 2);
  return h(
    Box,
    { key: key, flexDirection: "column", paddingLeft: 2 },
    pie.title ? h(Text, { color: style.theme.diagramText }, pie.title) : null,
    h(
      Box,
      { flexDirection: "row" },
      h(Image as ElementComponent, {
        source: { png },
        columns: 4 * pie.radius,
        rows: 2 * pie.radius,
        alt: "pie chart",
      }),
      h(
        Box,
        { flexDirection: "column", paddingLeft: 3 },
        Array.from({ length: lead }, (_, i) => h(Text, { key: `s${i}` }, " ")),
        pie.legend.map((line, i) =>
          h(
            Text,
            { key: `l${i}`, color: style.theme.diagramText },
            h(Text, { color: palette[i % palette.length] }, "██"),
            ` ${line}`,
          ),
        ),
      ),
    ),
  );
};

const chartElement = (
  el: ElementTable,
  style: Style,
  art: ChartArt,
  block: Extract<Block, { kind: "code" }>,
  source: string,
  key: string,
): RenderElement =>
  (art.pie && style.images && !block.isOpen && !mirrored(style) && !hasRtl(art.text)
    ? piePicture(el, style, art.pie, key)
    : null) ?? boxArt(el, style, art.text, key, inlineMarks(source), art.slices, art.series);

type TextVerdict =
  | { fits: true; art: ChartArt }
  | { fits: false; why: "unsupported"; word: string }
  | { fits: false; why: "too-wide"; narrowest: number; columns: number }
  | { fits: false; why: "no-art"; lines?: number; chars?: number };

type GaveUp = Extract<TextVerdict, { fits: false }>;

const textVerdict = (source: string, style: Style, columns: number, pieColors: number): TextVerdict => {
  let narrowest = Infinity;
  for (const max of [Infinity, 24, 12]) {
    const art = mermaidArt(
      max === Infinity ? source : shortenEdgeLabels(source, max),
      style.mermaidAscii,
      columns,
      pieColors,
    );
    const wide = art === null ? Infinity : artWidth(art.text);
    narrowest = Math.min(narrowest, wide);
    if (art !== null && wide <= columns - 2) return { fits: true, art };
  }
  const word = unsupportedKind(source);
  if (word) return { fits: false, why: "unsupported", word };
  if (narrowest !== Infinity) return { fits: false, why: "too-wide", narrowest, columns };
  const lines = source.split("\n").length;
  if (lines > MAX_LINES) return { fits: false, why: "no-art", lines };
  const chars = source.replace(INLINE_TAG, "").length;
  if (chars > MAX_CHARS) return { fits: false, why: "no-art", chars };
  return { fits: false, why: "no-art" };
};

const textNote = (verdict: GaveUp): string => {
  switch (verdict.why) {
    case "unsupported":
      return `${verdict.word} diagrams draw as source for now`;
    case "too-wide":
      return `diagram too wide to render (${verdict.narrowest} cols, ${verdict.columns - 2} fit)`;
    case "no-art":
      return verdict.lines !== undefined && verdict.lines > MAX_LINES
        ? `diagram too long to render (${verdict.lines} lines, max ${MAX_LINES})`
        : verdict.chars !== undefined && verdict.chars > MAX_CHARS
          ? `diagram too long to render (${verdict.chars} characters, max ${MAX_CHARS})`
          : "diagram failed to render";
  }
};

const PENDING_NOTE = "drawing with pele…";

const fallback = (
  verdict: GaveUp,
  picture: Picture,
): { note: string } | { png: string; width: number; height: number } => {
  switch (picture.state) {
    case "drawn":
      return picture;
    case "pending":
      return { note: PENDING_NOTE };
    case "declined":
      return { note: textNote(verdict) };
  }
};

const mermaidBlock = (
  el: ElementTable,
  style: Style,
  block: Extract<Block, { kind: "code" }>,
  i: number,
  columns: number,
  pieColors: number,
  images: Wake | null,
): DrawnBlock | undefined => {
  const source = block.lines.join("\n");
  const verdict = textVerdict(source, style, columns, pieColors);
  if (verdict.fits) {
    const { art } = verdict;
    return {
      element: chartElement(el, style, art, block, source, `b${i}`),
      art: art.text,
      hues: () => chartHues(painting(style.theme, art.text, art.slices, art.series)),
    };
  }
  if (block.isOpen) return undefined;
  const pixels = style.pictureFill ? fillColumns(columns) * style.cellWidthPx : null;
  const picture: Picture = images ? pelePicture(source.replace(INLINE_TAG, ""), images, pixels) : { state: "declined" };
  const out = fallback(verdict, picture);
  if ("note" in out) return out;
  const fit = fitImage(out, columns, style.pictureRows, style.pictureFill ? "fill" : "natural");
  return {
    element: h(el.Image as ElementComponent, {
      key: `b${i}`,
      source: { png: out.png },
      columns: fit.columns,
      rows: fit.rows,
      alt: "mermaid diagram",
    }),
    png: out.png,
  };
};

const drawDiagrams = (el: ElementTable, style: Style, blocks: Block[], columns: number, images: Wake | null): Drawn => {
  const drawn: Drawn = new Map();
  const pieColors = pieColorsOf(style);
  if (style.mermaid) {
    for (const [i, block] of blocks.entries()) {
      if (block.kind !== "code" || block.lang.toLowerCase() !== "mermaid") continue;
      const entry = mermaidBlock(el, style, block, i, columns, pieColors, images);
      if (entry) drawn.set(i, entry);
    }
  }
  for (const [i, block] of blocks.entries()) {
    if (block.kind !== "code" || !isFigureLang(block.lang)) continue;
    const figure = drawFigure(el, style, block, columns, `b${i}`);
    if (figure) drawn.set(i, figure);
  }
  return drawn;
};

export {
  boxArt,
  chartSize,
  diagramPalette,
  drawDiagrams,
  fallback,
  inlineMarks,
  mermaidText,
  shortenEdgeLabels,
  textNote,
  textVerdict,
};
