import { tableHtml, tableText } from "./html.ts";
import type { ElementTable, RenderElement, RenderNode, TextHoverProps } from "./jsx.ts";
import { h } from "./jsx.ts";
import { mathOf } from "./latex.ts";
import type { AlertLevel, Block, Inline, ListItem } from "./markdown.ts";
import { displayText, inlineText, isWebLink, nestedBlocks, texText } from "./markdown.ts";
import type { Flow } from "./rtl.ts";
import {
  codeVisual,
  commentTail,
  commentVisual,
  containsRtl,
  flow,
  hasRtl,
  heldCell,
  LTR_BLANK,
  listMarker,
  opensLatin,
  ROW_MARK,
  ROW_MARK_TEXT,
  terminalLine,
  WALL,
} from "./rtl.ts";
import type { Style, Theme } from "./theme.ts";

export type TerminalEnv = Partial<
  Record<
    | "FORCE_HYPERLINK"
    | "TERM_PROGRAM"
    | "TERM_PROGRAM_VERSION"
    | "TERM"
    | "WT_SESSION"
    | "LC_TERMINAL"
    | "VTE_VERSION"
    | "TERMINAL_EMULATOR",
    string
  >
>;
export type CopyButton = (
  text: string | (() => string),
  key: string,
  label?: string,
  rich?: (() => string) | "png",
) => RenderElement | null;
/** `art` and `png` exclude each other: a drawing is text art or a picture of a known PNG (base64). */
export type DrawnBlock =
  | { note: string; element?: never; art?: never; png?: never }
  | { element: RenderElement; art?: string; png?: never; note?: never }
  | { element: RenderElement; png: string; art?: never; note?: never };
export type Drawn = Map<number, DrawnBlock>;
/** Buttons that act on a drawn picture, in display order. Empty when they are off or cannot reach the user's machine. */
export type PictureButtons = (png: string, b: number) => RenderElement[];
export type Fold = (id: string, hidden: number, key: string) => { folded: boolean; element: RenderElement } | null;
export type Tip = (note: number) => (() => void) | undefined;
export type BlockOf<K extends Block["kind"]> = Extract<Block, { kind: K }>;
export type InlineOf<K extends Inline["kind"]> = Extract<Inline, { kind: K }>;
export type Span = [number, number];
export type Reach = Pick<Style, "httpLinks" | "editorLinks" | "fileLinks" | "pathLinks" | "found" | "home" | "cwd">;
export type Probe = { key: string; href: string };
export type Segment = { text: string; color?: string; italic?: boolean };
export type Mark = { start: number; end: number; text: string; note: number };
export type PrismToken = {
  type: string;
  content: string | PrismToken | (string | PrismToken)[];
  alias?: string | string[];
};
export type Grammar = Record<string, unknown>;
export type Look = {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  dimColor?: boolean;
  strikethrough?: boolean;
};

const _extends = Object.assign;

import { languages, tokenize } from "./vendor/prism.js";

const WIDE =
  // biome-ignore lint/suspicious/noMisleadingCharacterClass: U+20E3 is listed on purpose, as one wide code point
  /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}\u20E3]|\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/u;
const segmenter = new Intl.Segmenter();

const graphemes = (s: string): string[] => [...segmenter.segment(s)].map((g) => g.segment);

const cells = (s: string): string[] =>
  /^[ -~]*$/.test(s) ? [...s] : graphemes(s).flatMap((g) => (WIDE.test(g) ? [g, ""] : [g]));

const ZERO = /^[\p{M}\p{Default_Ignorable_Code_Point}]+$/u;

const width = (s: string): number =>
  /^[ -~]*$/.test(s)
    ? s.length
    : s.length === 1
      ? ZERO.test(s)
        ? 0
        : WIDE.test(s)
          ? 2
          : 1
      : graphemes(s).reduce((w, g) => (ZERO.test(g) ? w : w + (WIDE.test(g) ? 2 : 1)), 0);

const widestLine = (text: string): number => Math.max(...text.split("\n").map(width));

const wrapRanges = (text: string, w: number): Span[] => {
  const br = text.indexOf("\n");
  if (br >= 0)
    return [
      ...wrapRanges(text.slice(0, br), w),
      ...wrapRanges(text.slice(br + 1), w).map(([a, b]): Span => [a + br + 1, b + br + 1]),
    ];
  if (width(text) <= w) return [[0, text.length]];
  const out: Span[] = [];
  let line: Span | undefined;
  let used = 0;
  for (const word of text.matchAll(/\S+/g)) {
    let start = word.index;
    const end = start + word[0].length;
    let size = width(word[0]);
    if (size > w) {
      if (line) out.push(line);
      line = undefined;
      let cut = start;
      let taken = 0;
      for (const g of graphemes(text.slice(start, end))) {
        const step = width(g);
        if (cut > start && taken + step > w) {
          out.push([start, cut]);
          start = cut;
          size -= taken;
          taken = 0;
          if (size <= w) break;
        }
        cut += g.length;
        taken += step;
      }
    }
    if (start === end) continue;
    const joined = line ? used + width(text.slice(line[1], start)) + size : Infinity;
    if (line && joined <= w) {
      line = [line[0], end];
      used = joined;
    } else {
      if (line) out.push(line);
      line = [start, end];
      used = size;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [[0, 0]];
};

const sliceInline = (nodes: Inline[], from: number, to: number): Inline[] => {
  const out: Inline[] = [];
  let at = 0;
  for (const n of nodes) {
    const length = inlineText([n]).length;
    const a = Math.max(from - at, 0);
    const b = Math.min(to - at, length);
    at += length;
    if (a >= b) continue;
    if ("children" in n) out.push({ ...n, children: sliceInline(n.children, a, b) });
    else out.push({ ...n, text: n.text.slice(a, b) });
  }
  return out;
};

const hasLink = (nodes: Inline[]): boolean =>
  nodes.some((n) => n.kind === "link" || ("children" in n && hasLink(n.children)));

const headerRuns = (nodes: Inline[]): Inline[] =>
  nodes
    .flatMap((n): Inline[] =>
      n.kind === "footnote" ? [n] : "children" in n ? headerRuns(n.children) : [{ kind: "text", text: n.text }],
    )
    .reduce<Inline[]>((out, n) => {
      const last = out[out.length - 1];
      return n.kind === "text" && last?.kind === "text"
        ? [...out.slice(0, -1), { kind: "text", text: last.text + n.text }]
        : [...out, n];
    }, []);

const fileRoot = (distro?: string): string =>
  distro ? `file://wsl.localhost/${encodeURIComponent(distro)}` : "file://";

const HYPERLINK_TERMINALS = ["ghostty", "Hyper", "kitty", "alacritty", "iTerm.app", "iTerm2", "WarpTerminal", "Orca"];

const versionOf = (value = ""): number[] => {
  const short = /^(\d{1,2})(\d{2})$/.exec(value);
  return short ? [0, Number(short[1])] : value.split(".").map((n) => Number.parseInt(n, 10));
};

const atLeast = (value: string | undefined, major: number, minor: number): boolean => {
  const [a = Number.NaN, b = Number.NaN] = versionOf(value);
  return a > major || (a === major && b >= minor);
};

const programLinks = (program: string, version: string | undefined): boolean =>
  HYPERLINK_TERMINALS.includes(program) ||
  (program === "WezTerm" && atLeast(version, 20200620, 0)) ||
  (program === "vscode" && atLeast(version, 1, 72)) ||
  (program === "tmux" && atLeast(version, 3, 4));

const drawsHyperlinks = (env: TerminalEnv): boolean => {
  if (env.FORCE_HYPERLINK) return Number.parseInt(env.FORCE_HYPERLINK, 10) !== 0;
  const term = env.TERM ?? "";
  const vte = env.VTE_VERSION;
  return (
    env.WT_SESSION !== undefined ||
    programLinks(env.TERM_PROGRAM ?? "", env.TERM_PROGRAM_VERSION) ||
    HYPERLINK_TERMINALS.includes(env.LC_TERMINAL ?? "") ||
    (vte !== undefined && vte !== "0.50.0" && atLeast(vte, 0, 50)) ||
    term === "alacritty" ||
    term.includes("kitty") ||
    env.TERMINAL_EMULATOR === "JetBrains-JediTerm"
  );
};

const LAUNCHERS = new Set([
  "app",
  "command",
  "tool",
  "terminal",
  "pkg",
  "mpkg",
  "mobileconfig",
  "prefpane",
  "workflow",
  "action",
  "fileloc",
  "inetloc",
  "webloc",
  "exe",
  "com",
  "scr",
  "pif",
  "cpl",
  "msi",
  "msp",
  "msu",
  "msix",
  "msixbundle",
  "appx",
  "appxbundle",
  "appinstaller",
  "application",
  "appref-ms",
  "vsix",
  "bat",
  "cmd",
  "ps1",
  "psc1",
  "vbs",
  "vbe",
  "js",
  "jse",
  "wsf",
  "wsh",
  "wsc",
  "hta",
  "chm",
  "msc",
  "reg",
  "xll",
  "wsb",
  "diagcab",
  "ahk",
  "au3",
  "lnk",
  "url",
  "scf",
  "settingcontent-ms",
  "desktop",
  "sh",
  "bash",
  "zsh",
  "csh",
  "ksh",
  "run",
  "appimage",
  "deb",
  "rpm",
  "snap",
  "flatpak",
  "flatpakref",
  "jar",
  "jnlp",
  "py",
  "pyw",
  "pyz",
  "pyzw",
  "pyc",
  "pl",
  "rb",
  "rbw",
]);

const unescaped = (text: string): string =>
  text.replace(/%([0-9a-f]{2})/gi, (_: string, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));

const extensionOf = (name: string): string => /\.([^.]*)$/.exec(name.replace(/[. ]+$/, ""))?.[1] ?? "";

const launches = (href: string): boolean => {
  const path = unescaped(href.replace(/[?#].*$/, ""))
    .toLowerCase()
    .replace(/[/\\]+$/, "");
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  return /\.app[/\\]/.test(path) || name.split(/[:\u0000-\u001f]/).some((part) => LAUNCHERS.has(extensionOf(part)));
};

const isHyperlink = (href: string, reach: Reach): boolean =>
  (reach.httpLinks ? /^https?:/i : /^(https:|http:\/\/localhost(:\d+)?([/?#]|$))/i).test(href) ||
  (reach.editorLinks && /^(vscode(-insiders)?|cursor|windsurf|zed):\/\/file\//i.test(href)) ||
  (reach.fileLinks !== null && /^file:/i.test(href) && !launches(href));

const plainLink = (text: string, href: string): string => {
  const target = href.replace(/^mailto:/i, "");
  return text === target || `http://${text}` === target ? target : `${text} (${target})`;
};

const LINK_MAX = 2048;

const utf8Bytes = (cp: number): number => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

const encodedLength = (href: string): number =>
  [...href].reduce((length, ch) => {
    const cp = ch.codePointAt(0) as number;
    return length + (cp > 0x20 && cp < 0x7f ? 1 : 3 * utf8Bytes(cp));
  }, 0);

const fileHref = (root: string, href: string): string => {
  const local = /^file:(?:\/\/(?:localhost)?)?(\/(?![a-z]:|\/)[^?#]*)(.*)$/i.exec(href);
  return local && root !== "file://" ? `${root}${local[1]}${local[2]}` : href;
};

const slashes = (path: string): string => path.replace(/\\/g, "/").replace(/\/+$/, "");

const absolutePath = (reach: Reach, path: string): string | undefined => {
  const base = path.startsWith("~") ? reach.home : path.startsWith(".") ? reach.cwd : "/";
  if (!base) return undefined;
  const parts: string[] = [];
  for (const part of `${slashes(base)}/${path.replace(/^~/, "").replace(/(?<=[^/.])\.+$/, "")}`.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return `/${parts.join("/")}${path.endsWith("/") ? "/" : ""}`;
};

const pathHref = (reach: Reach, path: string): string | undefined => {
  const target = absolutePath(reach, path);
  if (target === undefined || reach.fileLinks === null) return undefined;
  const href = `${reach.fileLinks}${encodeURI(target).replace(/[?#]/g, encodeURIComponent)}`;
  return href.length <= LINK_MAX && !launches(href) ? href : undefined;
};

const toolHref = (reach: Reach, path: string): string | undefined => {
  if (!reach.pathLinks || reach.fileLinks === null) return undefined;
  const forward = path.replace(/\\/g, "/");
  if (/^[a-z]:\//i.test(forward)) return pathHref({ ...reach, fileLinks: "file://" }, forward);
  if (!forward.startsWith("//")) return pathHref(reach, /^[/~.]/.test(forward) ? forward : `./${forward}`);
  const href = `file:${encodeURI(forward).replace(/[?#]/g, encodeURIComponent)}`;
  return href.length <= LINK_MAX && !launches(href) ? href : undefined;
};

const pieceText = (pieces: Segment[]): string => pieces.map((p) => p.text).join("");

const decoded = (text: string): string | undefined => {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
};

const linkPath = (root: string, href: string): string | undefined => {
  const local =
    root !== "file://" && href.startsWith(`${root}/`)
      ? href.slice(root.length)
      : href.replace(/^file:(\/\/(localhost)?(?=\/))?/i, "");
  return decoded(local.replace(/[?#].*$/, ""));
};

const labelPath = (reach: Reach, root: string, label: string): string | undefined => {
  if (/^file:/i.test(label)) return linkPath(root, fileHref(root, label));
  if (/^([a-z]:[\\/]|\\\\)/i.test(label)) return label.replace(/\\/g, "/").replace(/^(?=[a-z]:)/i, "/");
  if (label.startsWith("/")) return label;
  return /^(~|\.{1,2})\//.test(label) ? absolutePath(reach, label) : undefined;
};

const withoutSlash = (path: string | undefined): string | undefined => path?.replace(/(?<=.)\/+$/, "");

const hidesFile = (reach: Reach, n: InlineOf<"link">, href: string): boolean => {
  const label = n.text.trim().replace(/[.,;:!?]+$/, "");
  if (!/^file:/i.test(n.href) || label === n.href) return false;
  const root = reach.fileLinks ?? "file://";
  const shown = withoutSlash(labelPath(reach, root, label));
  return shown === undefined || shown !== withoutSlash(linkPath(root, href));
};

const drawnLink = (n: InlineOf<"link">, reach: Reach): Inline => {
  const href = reach.fileLinks !== null && /^file:/i.test(n.href) ? fileHref(reach.fileLinks, n.href) : n.href;
  if (!isHyperlink(n.href, reach) || encodedLength(href) > LINK_MAX || hidesFile(reach, n, href))
    return { kind: "text", text: plainLink(n.text, n.href) };
  return href === n.href ? n : { ...n, href };
};

const linksAsPath = (path: string): boolean =>
  !path.startsWith("/") || /^\/[^/]+\/+[^/]/.test(path.replace(/\.+$/, ""));

const drawnPath = (n: InlineOf<"path">, reach: Reach): Inline => {
  const href = reach.pathLinks && linksAsPath(n.text) ? pathHref(reach, n.text) : undefined;
  return href === undefined ? n : { ...n, href };
};

const PART = String.raw`[\p{L}\p{N}_@+-]+`;
const NAME = String.raw`\.?${PART}(?:\.${PART})*`;
const LOOSE_PATH = new RegExp(
  String.raw`(?<![\p{L}\p{N}_/\\.:~@+-])(?:[A-Za-z]:[\\/](?:${NAME}[\\/])*(?:${NAME})?|${NAME}(?:\/${NAME})*\/(?:${NAME})?|${PART}(?:\.${PART})+)(?![\p{L}\p{N}_/\\@+-]|\.[\p{L}\p{N}])`,
  "gu",
);

const looseProbe = (reach: Reach, spelling: string): Probe | undefined => {
  const drive = /^[a-z]:[\\/]/i.test(spelling);
  if (!drive && !reach.cwd) return undefined;
  const href = toolHref(reach, spelling);
  const key = drive ? spelling.replace(/\\/g, "/") : `${slashes(reach.cwd)}/${spelling}`;
  return href === undefined ? undefined : { key: key.replace(/(?<=[^/:])\/+$/, ""), href };
};

const looseSpellings = (text: string): RegExpExecArray[] => [...text.matchAll(LOOSE_PATH)];

const foundProbe = (reach: Reach, spelling: string): Probe | undefined => {
  const probe = looseProbe(reach, spelling);
  return probe && reach.found?.has(probe.key) ? probe : undefined;
};

const loosePaths = (n: InlineOf<"text">, reach: Reach): Inline[] => {
  const out: Inline[] = [];
  let at = 0;
  for (const m of looseSpellings(n.text)) {
    const probe = foundProbe(reach, m[0]);
    if (!probe) continue;
    if (m.index > at) out.push({ kind: "text", text: n.text.slice(at, m.index) });
    out.push({ kind: "path", text: m[0], href: probe.href });
    at = m.index + m[0].length;
  }
  if (at === 0) return [n];
  if (at < n.text.length) out.push({ kind: "text", text: n.text.slice(at) });
  return out;
};

const looseCode = (n: InlineOf<"code">, reach: Reach): Inline => {
  const probe = isWholePath(n.text) ? foundProbe(reach, n.text) : undefined;
  return probe ? { ...n, href: probe.href } : n;
};

const isWholePath = (text: string): boolean => looseSpellings(text).some((m) => m[0] === text);

const looseNode = (n: Inline, reach: Reach): Inline | Inline[] => {
  if (n.kind === "text") return loosePaths(n, reach);
  return n.kind === "code" ? looseCode(n, reach) : n;
};

const linked = (node: Inline, reach: Reach): Inline => {
  const n: Inline =
    node.kind === "image" && isWebLink(node.src) ? { kind: "link", text: node.text, href: node.src } : node;
  if (n.kind === "link") return drawnLink(n, reach);
  if (n.kind === "path") return drawnPath(n, reach);
  return "children" in n ? { ...n, children: hyperlinks(n.children, reach) } : n;
};

const hyperlinks = (nodes: Inline[], reach: Reach): Inline[] =>
  reach.found?.size
    ? nodes.flatMap((node) => looseNode(linked(node, reach), reach))
    : nodes.map((node) => linked(node, reach));

const spellingsIn = (nodes: Inline[]): string[] =>
  nodes.flatMap((n) => {
    if ("children" in n) return spellingsIn(n.children);
    if (n.kind === "code") return isWholePath(n.text) ? [n.text] : [];
    return n.kind === "text" ? looseSpellings(n.text).map((m) => m[0]) : [];
  });

const inlinesOf = (block: Block): Inline[][] => {
  switch (block.kind) {
    case "heading":
    case "paragraph":
      return [block.inline];
    case "list":
      return block.items.map((item) => item.inline);
    case "table":
      return [...block.header, ...block.rows.flat()];
    case "notes":
      return block.notes.map((note) => note.inline);
    default:
      return [];
  }
};

const spelled = new WeakMap<Block, string[]>();

const pathsToProbe = (blocks: Block[], reach: Reach): string[] => {
  if (!reach.pathLinks || reach.fileLinks === null) return [];
  return nestedBlocks(blocks).flatMap((block) => {
    const spellings = spelled.get(block) ?? inlinesOf(block).flatMap(spellingsIn);
    spelled.set(block, spellings);
    return spellings.flatMap((spelling) => looseProbe(reach, spelling)?.key ?? []);
  });
};

const hyperlinkBlock = (block: Block, reach: Reach): Block => {
  const drawn = (nodes: Inline[]) => hyperlinks(nodes, reach);
  switch (block.kind) {
    case "heading":
    case "paragraph":
      return { ...block, inline: drawn(block.inline) };
    case "list":
      return { ...block, items: block.items.map((item) => ({ ...item, inline: drawn(item.inline) })) };
    case "table":
      return { ...block, header: block.header.map(drawn), rows: block.rows.map((r) => r.map(drawn)) };
    case "notes":
      return { ...block, notes: block.notes.map((note) => ({ ...note, inline: drawn(note.inline) })) };
    default:
      return block;
  }
};

const hyperlinked = new WeakMap<Block, Record<string, Block>>();

const drawable = (block: Block, reach: Reach): Block => {
  const cached: Record<string, Block> = hyperlinked.get(block) ?? {};
  hyperlinked.set(block, cached);
  const key = `${+reach.httpLinks}${+reach.editorLinks}${reach.fileLinks ?? ""}${reach.pathLinks ? `\0${reach.home}\0${reach.cwd}\0${reach.found?.size ?? 0}` : ""}`;
  cached[key] ??= hyperlinkBlock(block, reach);
  return cached[key];
};

const mostLines = (text: string, w: number): number => (text.match(/\S+/g)?.length ?? 0) + Math.ceil(width(text) / w);

const textRows = (text: string, w: number): number =>
  text.split("\n").reduce((sum, line) => sum + (width(line) <= w ? 1 : mostLines(line, Math.max(1, w))), 0);

const heightOf = (blocks: Block[], w: number): number =>
  blocks.reduce((sum, block, b) => sum + (b ? 1 : 0) + blockHeight(block, w), 0);

const blockHeight = (block: Block, w: number): number => {
  switch (block.kind) {
    case "heading":
      return 2 * textRows(displayText(block.inline), w - 4) + 2;
    case "paragraph":
      return textRows(displayText(block.inline), w);
    case "list":
      return block.items.reduce(
        (sum, item) => {
          const pad = item.depth * 2 + item.marker.length + 4;
          return (
            sum + textRows(displayText(item.inline), w - pad) + (item.blocks ? heightOf(item.blocks, w - pad) + 1 : 0)
          );
        },
        textRows(`${"━".repeat(20)} ${block.items.length}/${block.items.length} done`, w),
      );
    case "code":
      return block.lines.reduce((sum, line) => sum + textRows(line, w - 8), 3);
    case "table": {
      const { natural, words } = tableSize(block);
      const widths = columnWidths(natural, w - 4, 3, words);
      const tallest = (cells: Inline[][]) =>
        Math.max(1, ...widths.map((cw, c) => textRows(displayText(cells[c] ?? []), cw)));
      return block.rows.reduce((sum, row) => sum + 1 + tallest(row), 4 + tallest(block.header));
    }
    case "quote":
      return Math.max(1, heightOf(block.blocks, w - 2));
    case "alert":
      return 3 + heightOf(block.blocks, w - 4);
    case "rule":
      return 1;
    case "notes":
      return block.notes.reduce((sum, note) => sum + textRows(`${note.mark} ${displayText(note.inline)}`, w), 1);
  }
};

const wrapInline = (nodes: Inline[], w: number): Inline[][] => {
  const text = inlineText(nodes);
  return width(text) <= w && !text.includes("\n")
    ? [nodes]
    : wrapRanges(text, w).map(([a, b]) => sliceInline(nodes, a, b));
};

const mirrored = (style: Style): boolean => style.shape === "mirror";

const heldLtr = (style: Style): { dir?: "ltr" } => (style.shape === "engine" ? { dir: "ltr" } : {});

const heldLabel = (style: Style, label: string, text: string): string =>
  mirrored(style) && hasRtl(text) ? label.replace(/ $/, LTR_BLANK) : label;

const flows = new Map<string, Flow | null>();
const flowOf = (
  style: Style,
  nodes: Inline[],
  columns: number,
  mark = !(style.inside && mirrored(style)),
): Flow | null =>
  style.reorder && containsRtl(nodes)
    ? remember(
        flows,
        `${style.shape}\0${mark}\0${columns}\0${JSON.stringify(nodes)}`,
        () => flow(nodes, columns, width, style.shape, mark),
        2000,
      )
    : null;

const cellFlow = (style: Style, nodes: Inline[], held: boolean, mark: boolean): Flow | null =>
  held && style.reorder && containsRtl(nodes)
    ? remember(flows, `held\0${JSON.stringify(nodes)}`, () => heldCell(nodes), 2000)
    : flowOf(style, nodes, Infinity, mark);

const noteHover = (style: Style, note: number | undefined): { hover?: TextHoverProps } =>
  note === undefined || style.noteKey === undefined
    ? {}
    : { hover: { scope: `fn:${style.noteKey}:${note}`, inverse: true } };

const renderInline = (el: ElementTable, style: Style, nodes: Inline[], keyBase: string): RenderNode[] => {
  const { Text } = el;
  const t = style.theme;
  return nodes.map((n, i) => {
    const key = `${keyBase}.${i}`;
    switch (n.kind) {
      case "text":
        return h(Text, { key: key }, n.text);
      case "strong":
        return h(Text, { key: key, bold: true, color: t.strong }, renderInline(el, style, n.children, key));
      case "emphasis":
        return h(Text, { key: key, italic: true, color: t.emphasis }, renderInline(el, style, n.children, key));
      case "strike":
        return h(Text, { key: key, strikethrough: true, dimColor: true }, renderInline(el, style, n.children, key));
      case "code":
        return h(
          Text,
          { key: key, color: t.inlineCode },
          n.href === undefined ? n.text : h(el.Link, { href: n.href, label: n.text }),
        );
      case "math":
        return h(Text, { key: key, italic: true, color: t.emphasis }, n.text);
      case "link":
        return n.text === n.href
          ? h(Text, { key: key, color: t.link }, h(el.Link, { href: n.href }))
          : h(el.Link, { key: key, href: n.href }, h(Text, { color: t.link }, n.text));
      case "image":
        return h(Text, { key: key, color: t.link }, n.text);
      case "number":
        return h(Text, { key: key, color: t.number }, n.text);
      case "path":
        return h(
          Text,
          { key: key, color: t.path },
          n.href === undefined ? n.text : h(el.Link, { href: n.href, label: n.text }),
        );
      case "dim":
        return n === ROW_MARK
          ? h(Text, { key: key, color: t.rule }, n.text)
          : h(Text, { key: key, dimColor: true }, n.text);
      case "footnote":
        return h(Text, _extends({ key: key, color: t.accent }, noteHover(style, n.note)), n.text);
      default:
        return undefined;
    }
  });
};

const renderFlow = (
  el: ElementTable,
  style: Style,
  lines: Inline[][],
  key: string,
  props: Look = {},
): RenderElement[] => {
  const { Text } = el;
  return lines.map((line, i) =>
    h(Text, _extends({ key: `${key}.${i}` }, props), renderInline(el, style, line, `${key}.${i}`)),
  );
};

const marksIn = (nodes: Inline[], at = 0): Mark[] => {
  const out: Mark[] = [];
  for (const n of nodes) {
    const length = inlineText([n]).length;
    if (n.kind === "footnote" && n.note !== undefined)
      out.push({ start: at, end: at + length, text: n.text, note: n.note });
    else if ("children" in n) out.push(...marksIn(n.children, at));
    at += length;
  }
  return out;
};

const piecesOf = (text: string, a: number, b: number, columns: number, marks: Mark[]): Span[] => {
  if (width(text.slice(a, b)) <= columns) return [[a, b]];
  const out: Span[] = [];
  let start = a;
  let at = a;
  let taken = 0;
  for (const g of graphemes(text.slice(a, b))) {
    const step = width(g);
    if (at > start && taken + step > columns) {
      const cut = marks.find((m) => m.start < at && at < m.end)?.start ?? at;
      if (cut > start) {
        out.push([start, cut]);
        taken = width(text.slice(cut, at));
        start = cut;
      }
    }
    at += g.length;
    taken += step;
  }
  out.push([start, b]);
  return out;
};

const pressInline = (
  el: ElementTable,
  style: Style,
  nodes: Inline[],
  columns: number,
  key: string,
  tip?: Tip,
  look: Look = {},
  box: RenderElement["props"] = {},
): RenderElement | null => {
  const marks: (Mark & { press: () => void })[] = tip
    ? marksIn(nodes).flatMap((m) => {
        const press = tip(m.note);
        return press ? [{ ...m, press }] : [];
      })
    : [];
  if (!marks.length) return null;
  const { Box, Text, Button } = el;
  const run = (a: number, b: number) =>
    h(Text, _extends({ key: `${key}.t${a}` }, look), renderInline(el, style, sliceInline(nodes, a, b), `${key}.t${a}`));
  const text = inlineText(nodes);
  const words = [...text.matchAll(/\s*\S+\s*/g)].flatMap((m) =>
    piecesOf(text, m.index, m.index + m[0].length, Math.max(1, columns), marks),
  );
  return h(
    Box,
    _extends({ key: key, flexDirection: "row", flexWrap: "wrap" }, box),
    words.map(([a, b]) => {
      const inside = marks.filter((m) => m.start >= a && m.end <= b);
      if (!inside.length) return run(a, b);
      const parts: RenderElement[] = [];
      let at = a;
      for (const m of inside) {
        if (m.start > at) parts.push(run(at, m.start));
        parts.push(
          h(
            Button,
            _extends({ key: `${key}.n${m.start}`, plain: true }, noteHover(style, m.note), { onPress: m.press }),
            h(Text, { color: style.theme.accent, bold: look.bold }, m.text),
          ),
        );
        at = m.end;
      }
      if (at < b) parts.push(run(at, b));
      return h(Box, { key: `${key}.w${a}`, flexDirection: "row", flexShrink: 0 }, parts);
    }),
  );
};

const PRISM_COLORS: Record<string, keyof Theme> = {
  comment: "codeComment",
  prolog: "codeComment",
  doctype: "codeComment",
  cdata: "codeComment",
  string: "codeString",
  char: "codeString",
  "template-string": "codeString",
  "attr-value": "codeString",
  url: "codeString",
  number: "number",
  boolean: "number",
  constant: "number",
  symbol: "number",
  inserted: "number",
  keyword: "codeFlag",
  important: "codeFlag",
  atrule: "codeFlag",
  rule: "codeFlag",
  deleted: "codeFlag",
  function: "codeCommand",
  "class-name": "codeCommand",
  builtin: "codeCommand",
  key: "codeCommand",
  selector: "codeCommand",
  property: "link",
  tag: "link",
  "attr-name": "emphasis",
  variable: "emphasis",
  regex: "path",
};

const shownCode = (text: string, style: Style, room?: number, command = false): string =>
  style.reorder ? codeVisual(text, style.shape, room, width, command) : text;

const flatten = (tokens: (string | PrismToken)[], style: Style, color?: string, italic = false): Segment[] =>
  tokens.flatMap((token) => {
    if (typeof token === "string") return [{ text: token, color, italic }];
    const names = [token.type, ...(Array.isArray(token.alias) ? token.alias : token.alias ? [token.alias] : [])];
    const slot = names.map((n) => PRISM_COLORS[n]).find(Boolean);
    const inner = Array.isArray(token.content)
      ? token.content
      : [
          token.type === "comment" && typeof token.content === "string" && style.reorder
            ? commentVisual(token.content, style.shape)
            : token.content,
        ];
    return flatten(inner, style, slot ? style.theme[slot] : color, italic || token.type === "comment");
  });

const remember = <K, V>(cache: Map<K, V>, key: K, make: () => V, limit = 200): V => {
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const value = make();
  cache.set(key, value);
  if (cache.size > limit) cache.delete(cache.keys().next().value as K);
  return value;
};

const highlighted = new WeakMap<Theme, Map<string, Segment[][]>>();

const grammarFor = (lang: string): Grammar | undefined => {
  const name = lang.toLowerCase();
  const grammar = Object.hasOwn(languages, name) ? languages[name] : undefined;
  return grammar !== null && typeof grammar === "object" ? grammar : undefined;
};

const shownSegment = (seg: Segment, piece: string, style: Style, room?: number): Segment => ({
  ...seg,
  text: seg.italic ? piece : shownCode(piece, style, room),
});

const segmentRows = (style: Style, lines: string[], lang: string, room?: number): Segment[][] | null => {
  const grammar = grammarFor(lang);
  if (!grammar) return null;
  const code = lines.join("\n");
  const cache = highlighted.get(style.theme) ?? new Map<string, Segment[][]>();
  highlighted.set(style.theme, cache);
  return remember(cache, `${style.reorder ? style.shape : ""}\0${room ?? ""}\0${lang}\0${code}`, () => {
    const out: Segment[][] = [[]];
    for (const seg of flatten(tokenize(code, grammar), style)) {
      seg.text.split("\n").forEach((piece, i) => {
        if (i > 0) out.push([]);
        if (piece) out[out.length - 1].push(shownSegment(seg, piece, style, room));
      });
    }
    return out;
  });
};

const highlightBlock = (
  { Text }: ElementTable,
  style: Style,
  lines: string[],
  lang: string,
  key: string,
  room?: number,
): RenderElement[] | null => {
  const rows = segmentRows(style, lines, lang, room);
  if (!rows) return null;
  return rows.map((row, r) =>
    h(
      Text,
      { key: `${key}.${r}`, color: style.theme.codeText },
      row.length
        ? row.map((s, i) => h(Text, { key: `${key}.${r}.${i}`, color: s.color, italic: s.italic }, s.text))
        : " ",
    ),
  );
};

const gutterOf = (lines: string[], numbered: boolean): number => (numbered ? String(lines.length).length + 2 : 0);

const merged = (pieces: Segment[]): Segment[] =>
  pieces.reduce<Segment[]>((acc, p) => {
    const last = acc[acc.length - 1];
    if (last && last.color === p.color && last.italic === p.italic)
      acc[acc.length - 1] = { ...last, text: last.text + p.text };
    else acc.push(p);
    return acc;
  }, []);

const TAB = 8;

const tabbed = (pieces: Segment[]): Segment[] => {
  if (!pieces.some((p) => p.text.includes("\t"))) return pieces;
  let col = 0;
  return pieces.map((p) => {
    let text = "";
    for (const g of graphemes(p.text)) {
      const out = g === "\t" ? " ".repeat(TAB - (col % TAB)) : g;
      text += out;
      col += width(out);
    }
    return { ...p, text };
  });
};

const cutAt = (blank: boolean, space: number, from: number, at: number): number =>
  blank || space <= from ? at : space;

const rowStarts = (text: string, room: number): number[] => {
  const starts = [0];
  let [used, at, space, seen] = [0, 0, -1, false];
  for (const g of /^[ -~]*$/.test(text) ? text : graphemes(text)) {
    const step = width(g);
    const from = starts[starts.length - 1];
    const blank = /\s/.test(g);
    if (used + step > room && at > from) {
      const cut = cutAt(blank, space, from, at);
      starts.push(cut);
      used = width(text.slice(cut, at));
      seen = /\S/.test(text.slice(cut, at));
      space = -1;
    }
    at += g.length;
    used += step;
    if (!blank) seen = true;
    else if (seen) space = at;
  }
  return starts;
};

const splitRows = (pieces: Segment[], starts: number[]): Segment[][] => {
  const rows = starts.map((): Segment[] => []);
  let [at, r] = [0, 0];
  for (const p of pieces) {
    for (let from = 0; from < p.text.length; ) {
      while (r + 1 < starts.length && starts[r + 1] <= at + from) r++;
      const end = Math.min(p.text.length, (starts[r + 1] ?? Infinity) - at);
      rows[r].push({ ...p, text: p.text.slice(from, end) });
      from = end;
    }
    at += p.text.length;
  }
  return rows;
};

const DIFF_ROOM = 8;

const visualRows = (pieces: Segment[], room?: number): Segment[][] => {
  const text = pieces.map((p) => p.text).join("");
  return room === undefined || room < DIFF_ROOM || width(text) <= room
    ? [pieces]
    : splitRows(pieces, rowStarts(text, room));
};

const drawCode = ({ Text }: ElementTable, pieces: Segment[], key: string): RenderNode => {
  if (!pieces.length) return " ";
  return pieces.map((p, j) =>
    !p.color && !p.italic ? p.text : h(Text, { key: `${key}.${j}`, color: p.color, italic: p.italic }, p.text),
  );
};

const numberedLine = (
  el: ElementTable,
  style: Style,
  label: string,
  pieces: Segment[],
  key: string,
): RenderElement[] => [
  h(
    el.Text,
    { key: `${key}.g`, color: style.theme.codeComment, dimColor: true },
    heldLabel(style, label, pieceText(pieces)),
  ),
  h(el.Text, { key: `${key}.c`, color: style.theme.codeText }, drawCode(el, pieces, `${key}.c`)),
];

const heldSegments = (style: Style, lines: string[], lang: string): Segment[][] =>
  (isShellLang(lang) ? lines.map((line) => shellLine(style, line)) : segmentRows(style, lines, lang)) ??
  lines.map((text) => (text ? [{ text, italic: false }] : []));

const heldCode = (
  el: ElementTable,
  style: Style,
  lines: string[],
  shown: number,
  lang: string,
  gutter: number,
  room: number,
  key: string,
): RenderElement[] =>
  heldSegments(style, lines, lang)
    .slice(0, shown)
    .flatMap((segs, i) =>
      visualRows(tabbed(merged(segs)), room).map((part, k) =>
        h(
          el.Box,
          { key: `${key}.h${i}.${k}`, flexDirection: "row" },
          numberedLine(
            el,
            style,
            `  ${gutter ? (k ? " ".repeat(gutter + 2) : `${String(i + 1).padStart(gutter)}  `) : ""}`,
            part,
            `${key}.h${i}.${k}`,
          ),
        ),
      ),
    );

const codeRows = (
  el: ElementTable,
  style: Style,
  lines: string[],
  shown: number,
  lang: string,
  _numbered: boolean,
  room: number,
  key: string,
): RenderElement[] => {
  const rows =
    (isShellLang(lang) ? null : highlightBlock(el, style, lines, lang, key, room))?.slice(0, shown) ??
    lines.slice(0, shown).map((line, i) => codeLine(el, style, line, lang, `${key}.${i}`, room));
  return style.shape === "engine"
    ? rows.map((row, i) => h(el.Text, _extends({ key: `${key}.ltr${i}` }, heldLtr(style)), row))
    : rows;
};

const codeBody = (
  el: ElementTable,
  style: Style,
  rows: RenderElement[],
  gutter: number,
  held: boolean,
  more: RenderElement | null,
): RenderElement => {
  const { Box, Text } = el;
  return h(
    Box,
    { flexDirection: "column", paddingLeft: held ? 0 : 2 },
    held || !gutter
      ? rows
      : rows.map((row, i) =>
          row.type === "Text"
            ? h(
                Box,
                { key: `n${i}`, flexDirection: "row" },
                h(Text, { color: style.theme.codeComment, dimColor: true }, `${String(i + 1).padStart(gutter)}  `),
                row,
              )
            : row,
        ),
    held && more ? h(Box, { paddingLeft: 2 }, more) : more,
  );
};

const isShellLang = (lang: string): boolean =>
  lang === "" || /^(sh|bash|zsh|shell|console|fish|powershell|ps1)$/i.test(lang);

const BOX_DRAWING = /[\u2500-\u257F]/;

const SHELL_COMMENT = /^\s*#/;

const codeLine = (
  el: ElementTable,
  style: Style,
  line: string,
  lang: string,
  key: string,
  room?: number,
): RenderElement => {
  const { Text } = el;
  const t = style.theme;
  const isShell = isShellLang(lang);
  if (BOX_DRAWING.test(line)) return h(Text, { key: key, color: t.codeText }, line);
  const comment = style.reorder ? commentTail(line, style.shape) : null;
  if (comment) {
    return h(
      Text,
      { key: key, color: t.codeText },
      comment.head ? codeLine(el, style, comment.head, lang, `${key}.h`) : null,
      h(Text, { color: t.codeComment }, comment.marker + comment.tail),
    );
  }
  if (!isShell) return h(Text, { key: key, color: t.codeText }, shownCode(line, style, room) || " ");
  if (SHELL_COMMENT.test(line)) return h(Text, { key: key, color: t.codeComment }, line);
  return h(
    Text,
    { key: key, color: t.codeText },
    shellSegments(style, line, room).map((s, i) => h(Text, { key: `${key}.${i}`, color: s.color }, s.text)),
  );
};

const shellLine = (style: Style, line: string): Segment[] => {
  if (!line) return [];
  if (BOX_DRAWING.test(line)) return [{ text: line, color: style.theme.codeText, italic: false }];
  if (SHELL_COMMENT.test(line)) return [{ text: line, color: style.theme.codeComment, italic: false }];
  return shellSegments(style, line);
};

const shellSegments = (style: Style, line: string, room?: number): Segment[] => {
  const t = style.theme;
  let seenCommand = false;
  const colorOf = (p: string): string | undefined => {
    if (/^\s+$/.test(p)) return undefined;
    if (/^["']/.test(p)) return t.codeString;
    if (/^--?[\w-]/.test(p)) return t.codeFlag;
    if (!seenCommand && !/^[$>|&;]+$/.test(p)) {
      seenCommand = true;
      return t.codeCommand;
    }
    if (/^(\||&&|;|\|\|)$/.test(p)) seenCommand = false;
    return undefined;
  };
  return shownCode(line, style, room, true)
    .split(/("[^"]*"|'[^']*'|\s+)/)
    .filter((p) => p !== "")
    .map((text) => ({ text, color: colorOf(text), italic: false }));
};

const longestWord = (text: string): number => Math.max(0, ...text.split(/\s+/).map(width));

const columnWidths = (natural: number[], available: number, gap: number, words: number[] = []): number[] => {
  const room = Math.max(natural.length, available - gap * (natural.length - 1));
  const total = natural.reduce((a, b) => a + b, 0);
  if (total <= room) return natural;
  const minimum = natural.map((w, c) => Math.min(w, Math.max(1, words[c] ?? 1)));
  const widths = natural.map(() => 0);
  let open = natural.map((_, c) => c);
  let left = room;
  for (let fixed = [-1]; fixed.length; ) {
    const share = Math.floor(left / open.length);
    const claim = (c: number) => (natural[c] <= share ? natural[c] : minimum[c]);
    const minimumsFit = open.reduce((a, c) => a + minimum[c], 0) <= left;
    const needed = open.reduce((a, c) => a + claim(c), 0);
    fixed = open.filter((c) => natural[c] <= share);
    if (minimumsFit && (!fixed.length || needed > left)) fixed = open.filter((c) => minimum[c] > share);
    fixed.forEach((c) => {
      widths[c] = claim(c);
      left -= widths[c];
    });
    open = open.filter((c) => !fixed.includes(c));
  }
  open.forEach((c, i) => {
    widths[c] = Math.max(1, Math.floor(left / open.length) + (i < left % open.length ? 1 : 0));
  });
  while (widths.reduce((a, b) => a + b, 0) > room) {
    const widest = widths.indexOf(Math.max(...widths));
    if (widths[widest] <= 1) break;
    widths[widest]--;
  }
  return widths;
};

const tableCells = (block: BlockOf<"table">): Inline[][] => [...block.header, ...block.rows.flat()];

const mostlyRtl = (style: Style, lines: Inline[][]): boolean =>
  lines.filter((line) => flowOf(style, line, Infinity)?.base === "R").length * 2 > lines.length;

const isRtlTable = (style: Style, block: BlockOf<"table">): boolean =>
  mostlyRtl(
    style,
    tableCells(block).filter((cell) => displayText(cell).trim() !== ""),
  );

const ART_WIDTH = 100;

const tableSize = (block: BlockOf<"table">): { natural: number[]; words: number[] } => {
  const cells = [block.header, ...block.rows].map((r) => block.header.map((_, c) => displayText(r[c] ?? [])));
  const column = (measure: (text: string) => number) =>
    block.header.map((_, c) => Math.max(...cells.map((r) => measure(r[c]))));
  return { natural: column(widestLine), words: column(longestWord) };
};

const tableGrid = (block: BlockOf<"table">): string => {
  const cells = [block.header, ...block.rows].map((r) => block.header.map((_, c) => displayText(r[c] ?? [])));
  const { natural, words } = tableSize(block);
  const widths = columnWidths(natural, ART_WIDTH - 4, 3, words);
  const pad = (text: string, c: number, align: "left" | "right" | "center") => {
    const room = Math.max(0, widths[c] - width(text));
    const left = align === "right" ? room : align === "center" ? Math.floor(room / 2) : 0;
    return " ".repeat(left) + text + " ".repeat(room - left);
  };
  const line = (l: string, m: string, r: string) => l + widths.map((w) => "─".repeat(w + 2)).join(m) + r;
  const row = (r: string[], header: boolean) => {
    const lines = r.map((text, c) => wrapRanges(text, widths[c]).map(([a, b]) => text.slice(a, b)));
    return Array.from(
      { length: Math.max(...lines.map((l) => l.length)) },
      (_, i) =>
        `│ ${lines.map((l, c) => pad(l[i] ?? "", c, header ? "center" : (block.align[c] ?? "left"))).join(" │ ")} │`,
    );
  };
  const art = [
    line("┌", "┬", "┐"),
    ...row(cells[0], true),
    ...cells.slice(1).flatMap((r) => [line("├", "┼", "┤"), ...row(r, false)]),
    line("└", "┴", "┘"),
  ];
  return art.join("\n");
};

const tableArt = (block: BlockOf<"table">): string => ["```", tableGrid(block), "```"].join("\n");

const clip = ({ Box }: ElementTable, w: number, drawn: RenderNode, key?: string): RenderElement =>
  h(
    Box,
    { key: key, flexDirection: "column", minWidth: w },
    h(Box, { height: 0, flexGrow: 1, overflow: "hidden" }, drawn),
  );

const tableEdges = (style: Style, block: BlockOf<"table">, rtl: boolean, mirror: boolean) => {
  const held = !rtl && mirrored(style) && tableCells(block).some(containsRtl);
  return {
    opening: mirror ? ROW_MARK_TEXT : held ? LTR_BLANK : "",
    wall: (text: string) => (mirror ? text.replace("│", WALL) : held ? text.replace(/ $/, LTR_BLANK) : text),
    held,
    marked: !mirror && !held,
  };
};

const renderTable = (
  el: ElementTable,
  style: Style,
  block: BlockOf<"table">,
  columns: number,
  key: string,
  rtl: boolean,
  tip?: Tip,
): RenderElement => {
  const { Box, Text } = el;
  const t = style.theme;
  const box = style.tableStyle === "box";
  const gap = box ? 0 : style.tableStyle === "grid" ? 3 : 2;
  const { natural, words } = tableSize(block);
  const widths = box ? columnWidths(natural, columns - 4, 3, words) : columnWidths(natural, columns, gap, words);
  const order = natural.map((_, c) => c);
  const mirror = rtl && mirrored(style);
  const flip = rtl && !mirror;
  const { opening, wall, held, marked } = tableEdges(style, block, rtl, mirror);
  if (flip) order.reverse();
  const lead = (k: string) => (opening ? h(Text, { key: `${k}.m`, color: t.rule }, opening) : null);
  const columnGap = held ? 0 : gap;
  const spacer = (k: string) => (held ? h(Text, { key: k }, LTR_BLANK + " ".repeat(gap - 1)) : null);
  const ruleChar = style.tableStyle === "grid" ? "━" : "─";
  const justify = (c: number) =>
    block.align[c] === "right" ? "flex-end" : block.align[c] === "center" ? "center" : "flex-start";

  const rule = (k: string, heavy: boolean) =>
    h(
      Box,
      { key: k, flexDirection: "row", columnGap: columnGap },
      lead(k),
      order.map((c, i) => [
        i > 0 && spacer(`${k}.${c}g`),
        h(
          Text,
          { key: `${k}.${c}`, color: t.tableRule, dimColor: !heavy && !t.tableRule },
          (heavy ? ruleChar : "─").repeat(widths[c]),
        ),
      ]),
    );

  const bar = (k: string, text: string, lines = 1) =>
    h(
      Text,
      { key: k, color: t.tableRule, dimColor: !t.tableRule },
      Array.from({ length: lines }, () => text).join("\n"),
    );

  const clipped = (lines: number) => (k: string, text: string) => clip(el, width(text), bar(`${k}.b`, text, lines), k);
  const edge = (k: string, [left, fill, mid, right]: string) =>
    bar(k, (mirror ? WALL : left) + order.map((c) => fill.repeat(widths[c] + 2)).join(mid) + (mirror ? WALL : right));

  const terminalRow = (cells: Inline[][], k: string, isHeader: boolean) => {
    const parts: Inline[] = box ? [{ kind: "dim", text: "│ " }] : [];
    order.forEach((c, i) => {
      if (i > 0) parts.push(box ? { kind: "dim", text: " │ " } : { kind: "text", text: " ".repeat(gap) });
      const cell = flowOf({ ...style, shape: "visual" }, cells[c] ?? [], Infinity);
      const content = cell ? cell.lines[0] : (cells[c] ?? []);
      const pad = Math.max(0, widths[c] - width(inlineText(content)));
      const side = cell?.base === "R" && block.align[c] !== "center" ? "flex-end" : justify(c);
      const before = side === "flex-end" ? pad : side === "center" ? Math.floor(pad / 2) : 0;
      parts.push(
        { kind: "text", text: " ".repeat(before) },
        ...(isHeader ? [{ kind: "strong", children: content } satisfies Inline] : content),
        { kind: "text", text: " ".repeat(pad - before) },
      );
    });
    if (box) parts.push({ kind: "dim", text: " │" });
    return h(Text, { key: k }, renderInline(el, style, terminalLine(parts), k));
  };

  const row = (cells: Inline[][], k: string, isHeader: boolean, border = bar): RenderElement =>
    rtl && style.shape === "inverse"
      ? terminalRow(cells, k, isHeader)
      : h(
          Box,
          { key: k, flexDirection: "row", columnGap: columnGap, alignItems: "stretch" },
          !box && lead(k),
          box && border(`${k}.l`, wall("│ ")),
          order.map((c, i) => {
            const w = widths[c];
            const cell = cellFlow(style, cells[c] ?? [], held, marked);
            const content = cell ? cell.lines[0] : (cells[c] ?? []);
            const side = mirror
              ? block.align[c] === "center"
                ? "center"
                : "flex-start"
              : cell?.base === "R" && block.align[c] !== "center"
                ? "flex-end"
                : justify(c);
            const runs = isHeader ? headerRuns(content) : content;
            const cellBox = h(
              Box,
              { key: `${k}.${c}`, width: w, flexShrink: 0, justifyContent: side },
              pressInline(
                el,
                style,
                runs,
                w,
                `${k}.${c}.p`,
                tip,
                isHeader ? { bold: true, color: t.tableHeader } : {},
                { justifyContent: side },
              ) ??
                (isHeader
                  ? h(
                      Text,
                      { bold: true, color: t.tableHeader },
                      runs.some((n) => n.kind === "footnote")
                        ? renderInline(el, style, runs, `${k}.${c}`)
                        : inlineText(runs),
                    )
                  : mirror && inlineText(content).trim() === ""
                    ? h(Text, null, " ".repeat(w))
                    : h(Text, null, renderInline(el, style, content, `${k}.${c}`))),
            );

            return [i > 0 && (box ? border(`${k}.${c}s`, wall(" │ ")) : spacer(`${k}.${c}g`)), cellBox];
          }),
          box && border(`${k}.r`, wall(" │")),
        );

  const wrappedRow = (cells: Inline[][], k: string, isHeader: boolean): RenderElement[] => {
    if (!isHeader && cells.some(hasLink))
      return [
        row(
          cells,
          k,
          isHeader,
          clipped(Math.max(1, ...widths.map((w, c) => mostLines(displayText(cells[c] ?? []), w)))),
        ),
      ];
    const wrapped = widths.map((w, c) => {
      const content = cells[c] ?? [];
      if (natural[c] <= w && !inlineText(content).includes("\n")) return [content];
      return wrapInline(isHeader ? headerRuns(content) : content, w);
    });
    return Array.from({ length: Math.max(...wrapped.map((l) => l.length)) }, (_, i) =>
      row(
        wrapped.map((l) => l[i] ?? []),
        `${k}.${i}`,
        isHeader,
      ),
    );
  };

  if (box) {
    const lines = [edge(`${key}.t`, "┌─┬┐"), ...wrappedRow(block.header, `${key}.h`, true), edge(`${key}.hr`, "╞═╪╡")];
    block.rows.forEach((r, i) => {
      if (i > 0) lines.push(edge(`${key}.r${i}r`, "├─┼┤"));
      lines.push(...wrappedRow(r, `${key}.r${i}`, false));
    });
    lines.push(edge(`${key}.b`, "└─┴┘"));
    return h(Box, _extends({ key: key, flexDirection: "column" }, flip ? { alignSelf: "flex-end" } : {}), lines);
  }

  const body = [row(block.header, `${key}.h`, true), rule(`${key}.hr`, true)];
  block.rows.forEach((r, i) => {
    body.push(row(r, `${key}.r${i}`, false));
    if (style.tableStyle !== "minimal" && i < block.rows.length - 1) body.push(rule(`${key}.r${i}r`, false));
  });
  return h(Box, _extends({ key: key, flexDirection: "column" }, flip ? { alignSelf: "flex-end" } : {}), body);
};

const renderHeading = (el: ElementTable, style: Style, block: BlockOf<"heading">, key: string): RenderElement => {
  const rtl = flowOf(style, block.inline, Infinity);
  if (!rtl) return drawHeading(el, style, block, block.inline, key);
  if (rtl.base === "R" && mirrored(style) && style.headingStyle === "banner" && block.level <= 2)
    return mirroredBanner(el, style, block.level, rtl.lines[0], key);
  const heading = drawHeading(el, style, block, rtl.lines[0], key);
  return rtl.base === "R" && !mirrored(style) ? h(el.Box, { key: key, alignSelf: "flex-end" }, heading) : heading;
};

const mirroredBanner = (
  el: ElementTable,
  style: Style,
  level: number,
  inline: Inline[],
  key: string,
): RenderElement => {
  const { Box, Text } = el;
  const color = style.theme.heading;
  const text = h(
    Text,
    { key: `${key}.h`, bold: true, underline: level === 2, color: color },
    level === 1 ? `${WALL} ` : "",
    renderInline(el, style, inline, key),
    level === 1 ? ` ${WALL}` : "",
  );
  if (level === 2) return text;
  const edge = (k: string) =>
    h(Text, { key: k, color: color }, WALL + "━".repeat(width(inlineText(inline)) + 2) + WALL);
  return h(Box, { key: key, flexDirection: "column" }, edge(`${key}.t`), text, edge(`${key}.b`));
};

const drawHeading = (
  el: ElementTable,
  style: Style,
  block: BlockOf<"heading">,
  inline: Inline[],
  key: string,
): RenderElement => {
  const { Box, Text } = el;
  const t = style.theme;
  const color = block.level <= 2 ? t.heading : (t.accent ?? t.heading);
  const label = inlineText(inline);
  switch (style.headingStyle) {
    case "uppercase":
      return h(Text, { key: key, bold: true, color: color }, block.level === 1 ? label.toUpperCase() : label);
    case "underline":
      return h(Text, { key: key, bold: true, underline: block.level <= 2, color: color }, label);
    case "banner":
      if (block.level === 1)
        return h(
          Box,
          { key: key, alignSelf: "flex-start", borderStyle: "bold", borderColor: color, paddingX: 1 },
          h(Text, { bold: true, color: color }, renderInline(el, style, inline, key)),
        );
      return block.level === 2
        ? h(
            Box,
            { key: key, flexDirection: "column", alignSelf: "flex-start" },
            h(Text, { bold: true, color: color }, renderInline(el, style, inline, key)),
            h(Text, { color: color }, "━".repeat(width(label))),
          )
        : h(
            Text,
            { key: key, bold: true, color: block.level === 3 ? color : t.strong },
            renderInline(el, style, inline, key),
          );
    default:
      return h(Text, { key: key, bold: true, color: color }, renderInline(el, style, inline, key));
  }
};

const ALERT_COLOR: Record<AlertLevel, string> = {
  note: "blue",
  tip: "green",
  important: "magenta",
  warning: "yellow",
  caution: "red",
};

const prose = (style: Style): Look => (style.inside === "quote" ? { italic: true, color: style.theme.quote } : {});

const renderParagraph = (
  el: ElementTable,
  style: Style,
  block: BlockOf<"paragraph">,
  columns: number,
  key: string,
  tip?: Tip,
): RenderElement => {
  const { Box, Text } = el;
  const rtl = flowOf(style, block.inline, columns);
  if (rtl?.base === "R")
    return h(
      Box,
      _extends({ key: key, flexDirection: "column" }, mirrored(style) ? {} : { alignItems: "flex-end" }),
      renderFlow(el, style, rtl.lines, key, prose(style)),
    );
  const inline = rtl ? rtl.lines[0] : block.inline;
  return (
    pressInline(el, style, inline, columns, key, tip, prose(style)) ??
    h(Text, _extends({ key: key }, prose(style)), renderInline(el, style, inline, key))
  );
};

const leadInline = (blocks: Block[]): Inline[] => {
  const first = blocks[0];
  if (first?.kind === "paragraph" || first?.kind === "heading") return first.inline;
  if (first?.kind === "list") return first.items[0]?.inline ?? [];
  return first?.kind === "quote" || first?.kind === "alert" ? leadInline(first.blocks) : [];
};

const renderNested = (
  el: ElementTable,
  style: Style,
  blocks: Block[],
  columns: number,
  key: string,
  copy?: CopyButton,
  fold?: Fold,
  tip?: Tip,
): RenderElement[] =>
  renderBlocks(
    el,
    style,
    blocks,
    columns,
    drawMath(el, style, blocks),
    copy && ((text, id, label, html) => copy(text, `${key}.${id}`, label, html)),
    fold && ((id, hidden, k) => fold(id, hidden, `${key}.${k}`)),
    tip,
  );

const quoteBar = (el: ElementTable, text: string, color: string | undefined, lines: number): RenderElement =>
  lines <= 1
    ? h(el.Text, { color: color }, text)
    : clip(el, width(text), h(el.Text, { color: color }, Array.from({ length: lines }, () => text).join("\n")));

const renderQuote = (
  el: ElementTable,
  style: Style,
  block: BlockOf<"quote">,
  columns: number,
  key: string,
  copy?: CopyButton,
  fold?: Fold,
  tip?: Tip,
): RenderElement => {
  const { Box } = el;
  const t = style.theme;
  const inner = columns - 2;
  const lines = heightOf(block.blocks, inner);
  const body = h(
    Box,
    { flexDirection: "column", rowGap: 1 },
    renderNested(el, { ...style, inside: "quote" }, block.blocks, inner, key, copy, fold, tip),
  );
  if (!mirrored(style) && flowOf(style, leadInline(block.blocks), inner)?.base === "R") {
    return h(
      Box,
      { key: key, flexDirection: "row", justifyContent: "flex-end", alignItems: "stretch" },
      body,
      quoteBar(el, " │", t.accent, lines),
    );
  }
  return h(
    Box,
    { key: key, flexDirection: "row", alignItems: "stretch" },
    quoteBar(el, mirrored(style) ? ROW_MARK_TEXT : "│ ", t.accent, lines),
    body,
  );
};

const renderAlert = (
  el: ElementTable,
  style: Style,
  block: BlockOf<"alert">,
  columns: number,
  key: string,
  copy?: CopyButton,
  fold?: Fold,
  tip?: Tip,
): RenderElement => {
  const { Box, Text } = el;
  const color = ALERT_COLOR[block.level];
  const inner = columns - 4;
  const hebrew = flowOf(style, leadInline(block.blocks), inner)?.base === "R";
  const label = block.level[0].toUpperCase() + block.level.slice(1);
  const body = block.blocks.length
    ? h(
        Box,
        { flexDirection: "column", rowGap: 1 },
        renderNested(el, { ...style, inside: "alert" }, block.blocks, inner, key, copy, fold, tip),
      )
    : null;
  if (hebrew && mirrored(style)) {
    const lines = 1 + (block.blocks.length ? 1 + heightOf(block.blocks, inner) : 0);
    const edge = (k: string) => h(Text, { key: k, color: color }, WALL + "─".repeat(inner + 2) + WALL);
    return h(
      Box,
      { key: key, flexDirection: "column", alignSelf: "flex-start" },
      edge(`${key}.t`),
      h(
        Box,
        { flexDirection: "row", alignItems: "stretch" },
        quoteBar(el, ROW_MARK_TEXT, color, lines),
        h(Box, { flexDirection: "column", width: inner }, h(Text, { bold: true, color: color }, label), body),
        quoteBar(el, ` ${WALL}`, color, lines),
      ),
      edge(`${key}.b`),
    );
  }
  return h(
    Box,
    _extends(
      { key: key, flexDirection: "column", alignSelf: hebrew ? "flex-end" : "flex-start" },
      hebrew ? { alignItems: "flex-end" } : {},
      { borderStyle: "round", borderColor: color, paddingX: 1 },
    ),
    h(Text, { bold: true, color: color }, label),
    body,
  );
};

const listSide = (style, block) => {
  if (!style.reorder || !block.items.some((item) => containsRtl(item.inline))) return undefined;
  return mostlyRtl(
    style,
    block.items.map((item) => item.inline),
  )
    ? "R"
    : "L";
};

const leftItem = (el, style, depth, lead, color, inline, room, k, look, tip) => {
  const { Box, Text } = el;
  return h(
    Box,
    { key: k, flexDirection: "row", paddingLeft: depth * 2 },
    h(Text, { color: color }, lead),
    pressInline(el, style, inline, room, `${k}.i`, tip, look) ?? h(Text, look, renderInline(el, style, inline, k)),
  );
};

const leadSide = (style, block, room) =>
  block.kind === "list" ? listSide(style, block) : flowOf(style, leadInline([block]), room)?.base;

const heldItem = (el, style, item, glyph, color, room, k, look) => {
  const { Box, Text } = el;
  const lines = mirrored(style)
    ? flowOf(style, item.inline, room - 1, false).lines.map((line) => [{ kind: "text", text: LTR_BLANK }, ...line])
    : flowOf(style, item.inline, room).lines;
  return h(
    Box,
    { key: k, flexDirection: "row", paddingLeft: item.depth * 2 },
    h(Text, { color: color }, mirrored(style) ? glyph : `${glyph} `),
    h(Box, { flexDirection: "column" }, renderFlow(el, style, lines, k, look)),
  );
};

const listRow = (el, style, item, glyph, glyphColor, side, room, k, look, tip) => {
  const { Box, Text } = el;
  const rtl = flowOf(style, item.inline, room);
  const right = side ? side === "R" : rtl?.base === "R";
  const lines = rtl?.lines ?? [mirrored(style) ? [ROW_MARK, ...item.inline] : item.inline];
  const drawn = () =>
    (rtl
      ? null
      : pressInline(
          el,
          style,
          lines[0],
          room,
          `${k}.i`,
          tip,
          look,
          mirrored(style) ? {} : { justifyContent: "flex-end" },
        )) ?? renderFlow(el, style, lines, k, look);
  return right && mirrored(style)
    ? h(
        Box,
        { key: k, flexDirection: "row" },
        h(Text, { color: glyphColor }, `${" ".repeat(item.depth * 2)}${glyph} `),
        h(Box, { flexDirection: "column" }, drawn()),
      )
    : right
      ? h(
          Box,
          { key: k, flexDirection: "row", justifyContent: "flex-end", paddingRight: item.depth * 2 },
          h(Box, { flexDirection: "column", alignItems: "flex-end" }, drawn()),
          h(Text, { color: glyphColor }, ` ${listMarker(glyph, style.shape)}`),
        )
      : rtl?.base === "R"
        ? heldItem(el, style, item, glyph, glyphColor, room, k, look)
        : leftItem(
            el,
            style,
            item.depth,
            `${glyph} `,
            glyphColor,
            rtl ? rtl.lines[0] : item.inline,
            room,
            k,
            look,
            tip,
          );
};

const TASK_GLYPHS = { checks: ["[ ]", "[✓]"], ticks: ["○", "✓"], box: ["□", "✓"], progress: ["○", "✓"] };

const renderList = (el, style, block, columns, key, copy, fold, tip) => {
  const { Box, Text } = el;
  const t = style.theme;
  const tasks = block.items.filter((item) => item.task !== undefined);
  const done = tasks.filter((item) => item.task).length;
  const filled = tasks.length ? Math.round((done / tasks.length) * 20) : 0;
  const strike = style.taskStyle === "checks" || style.taskStyle === "box";
  const tick = style.taskStyle === "ticks" || style.taskStyle === "progress";
  const side = listSide(style, block);
  return h(
    Box,
    { key: key, flexDirection: "column" },
    style.taskStyle === "progress" &&
      tasks.length > 0 &&
      h(
        Text,
        null,
        h(Text, { color: t.accent }, "━".repeat(filled)),
        h(Text, { color: t.bullet, dimColor: true }, "─".repeat(20 - filled)),
        h(Text, { color: t.bullet }, ` ${done}/${tasks.length} done`),
      ),
    block.items.map((item, i) => {
      const k = `${key}.${i}`;
      const glyph =
        item.task !== undefined
          ? TASK_GLYPHS[style.taskStyle][item.task ? 1 : 0]
          : /\d/.test(item.marker)
            ? item.marker
            : item.depth
              ? "◦"
              : "•";
      const glyphColor = item.task && tick ? t.accent : t.bullet;
      const pad = item.depth * 2 + glyph.length + 1;
      const look = { ...(item.task === true ? { dimColor: true, strikethrough: strike } : {}), ...prose(style) };
      const row = listRow(el, style, item, glyph, glyphColor, side, columns - pad, k, look, tip);
      if (!item.blocks) return row;
      return h(
        Box,
        { key: k, flexDirection: "column" },
        row,
        h(
          Box,
          { flexDirection: "column", paddingLeft: pad },
          renderNested(el, style, item.blocks, columns - pad, k, copy, fold, tip),
        ),
      );
    }),
  );
};

const instanceKey = (id) => {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

const noteTip = (blocks, toast) => {
  const notes = blocks.find((block) => block.kind === "notes");
  if (notes?.kind !== "notes") return undefined;
  const text = new Map(notes.notes.map((note) => [note.note, `${note.mark} ${inlineText(note.inline)}`]));
  return (note) => {
    const line = text.get(note);
    return line === undefined ? undefined : () => toast(line);
  };
};

const NUMBER_AT = 10;
const FOLD_AT = 30;
const FOLD_SHOW = 20;

const codeId = (lines) => {
  let h = 5381;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) h = (h * 33 + line.charCodeAt(i)) | 0;
    h = (h * 33 + 10) | 0;
  }
  return `${lines.length}:${(h >>> 0).toString(36)}`;
};

const copySource = (style, block) =>
  block.kind === "code"
    ? block.lines.join("\n")
    : block.kind === "table"
      ? block.raw
      : style.inside
        ? undefined
        : block.kind === "list"
          ? block.raw
          : block.kind === "quote" || block.kind === "alert"
            ? block.raw
                .split("\n")
                .map((line) => line.replace(/^\s*>\s?/, ""))
                .join("\n")
            : undefined;

const drawMath = (el, style, blocks, drawn = new Map()) => {
  for (const [i, block] of blocks.entries()) {
    const tex = drawn.has(i) ? null : mathOf(block);
    const text = tex === null ? null : texText(tex);
    if (text && !text.includes("\\"))
      drawn.set(i, {
        element: h(
          el.Box,
          { key: `b${i}`, paddingLeft: 2 },
          h(el.Text, { italic: true, color: style.theme.emphasis }, text),
        ),
      });
  }
  return drawn;
};

const opensWithCopy = (block) =>
  block.kind === "quote" &&
  (block.blocks[0]?.kind === "code" ||
    block.blocks[0]?.kind === "table" ||
    (block.blocks[0] !== undefined && opensWithCopy(block.blocks[0])));

const holdsOnlyEmptyCode = (block) =>
  block.kind === "quote" &&
  block.blocks.length === 1 &&
  ((block.blocks[0].kind === "code" && block.blocks[0].lines.length === 0) || holdsOnlyEmptyCode(block.blocks[0]));

const MARK = 2;

const markerRoom = (style) => (style.copyButtons && style.copyButtonStyle === "hover" ? MARK : 0);

const codeLabel = (block) => `── ${block.lang || "code"}`;

const buttonText = (button) =>
  button?.type === "Button"
    ? `[ ${button.props.label} ]`
    : button?.type === "Text"
      ? (button.children ?? []).filter((c) => typeof c === "string").join("")
      : undefined;

const keyOf = (button) => String(("props" in button ? button.props?.key : undefined) ?? "");

const markedRow = ({ Box }, key, element, float, start) =>
  h(
    Box,
    _extends({ key: key, flexDirection: "column" }, start ? { alignItems: "flex-end" } : { alignSelf: "flex-start" }),
    h(
      Box,
      _extends(
        { flexDirection: "row", columnGap: 1, minWidth: float.needs },
        start ? { justifyContent: "flex-end" } : {},
      ),
      start ? float.marker : null,
      element,
      start ? null : float.marker,
      float.element,
    ),
  );

const renderBlocks = (el, style, blocks, columns, drawn = new Map(), copy, fold, tip, picture) => {
  const { Box, Text } = el;
  const t = style.theme;
  const hover = style.copyButtonStyle === "hover";
  const reserved = (buttons) =>
    buttons.reduce((w, button) => {
      const shown = buttonText(button);
      return shown === undefined ? w : w + (w ? 1 : 0) + width(shown);
    }, 0);
  const fitted = (parts) =>
    parts.reduce(
      (kept, part) => (part && (!kept.length || reserved([...kept, part]) <= columns) ? [...kept, part] : kept),
      [],
    );
  const scopeOf = (button) => `copy:${style.noteKey ?? ""}:${keyOf(button)}`;
  const floating = (kept, low = false, start = false) => {
    const scope = scopeOf(kept[0]);
    return {
      needs: reserved(kept),
      marker: h(
        Box,
        { flexShrink: 0, alignSelf: low ? "flex-end" : "flex-start", hover: { scope } },
        h(Text, { dimColor: true }, "\u29C9"),
      ),
      element: h(
        Box,
        _extends({ position: "absolute" }, low ? { bottom: 0 } : { top: 0 }, start ? { left: 0 } : { right: 0 }, {
          display: "none",
          hover: { scope, display: "flex" },
        }),
        kept.flatMap((button, i) => (i ? [h(Text, { key: `gap${i}` }, " "), button] : [button])),
      ),
    };
  };
  const shown = blocks.map((block) => drawable(block, style));
  const rtlTables = shown.map((block) => style.reorder && block.kind === "table" && isRtlTable(style, block));
  const buttons = blocks.map((block, b) => {
    const text = hover && holdsOnlyEmptyCode(block) ? undefined : copySource(style, block);
    const isPlainCode = block.kind === "code" && !drawn.get(b)?.element;
    const drawnArt = drawn.get(b)?.art;
    const art = drawnArt ?? (block.kind === "table" ? () => tableArt(block) : undefined);
    const grid = drawnArt ?? (block.kind === "table" ? () => tableGrid(block) : undefined);
    const bitmap = drawn.get(b)?.png;
    const first =
      text === undefined || isPlainCode
        ? null
        : copy?.(
            text,
            `copy${b}`,
            block.kind === "table" ? "⧉ md" : art === undefined && bitmap === undefined ? undefined : "⧉ source",
          );
    if (!first) return { first, more: [] };
    const more = [
      art !== undefined ? copy?.(art, `art${b}`, "⧉ art") : null,
      block.kind === "table"
        ? copy?.(
            () => tableText(block),
            `html${b}`,
            "⧉ html",
            () => tableHtml(block),
          )
        : null,
      grid !== undefined ? copy?.(grid, `png${b}`, "▣ png", "png") : null,
      ...(bitmap === undefined ? [] : (picture?.(bitmap, b) ?? [])),
    ].filter(Boolean);
    return { first, more };
  });
  const codeHead = (label, button) => {
    if (!hover || !button) return null;
    const float = floating([button]);
    return { ...float, minWidth: Math.min(columns, width(label) + 1 + float.needs) };
  };
  const room = (b) => (hover && buttons[b].first ? columns - MARK : columns);
  const beside = (b) =>
    !buttons[b].first ? columns : hover ? columns - MARK : columns - reserved([buttons[b].first]) - 2;
  const rendered = shown.map((block, b) => {
    const key = `b${b}`;
    switch (block.kind) {
      case "heading":
        return renderHeading(el, style, block, key);
      case "paragraph":
        return drawn.get(b)?.element ?? renderParagraph(el, style, block, columns, key, tip);
      case "quote":
        return renderQuote(el, style, block, beside(b), key, copy, fold, tip);
      case "alert":
        return renderAlert(el, style, block, beside(b), key, copy, fold, tip);
      case "rule":
        return h(Text, { key: key, color: t.rule, dimColor: !t.rule }, "─".repeat(Math.max(8, Math.min(columns, 80))));
      case "code": {
        const done = drawn.get(b)?.element;
        if (done) return done;
        const note = drawn.get(b)?.note;
        const lines = block.lines;
        const toggle = lines.length > FOLD_AT ? fold?.(codeId(lines), lines.length - FOLD_SHOW, `fold${b}`) : null;
        const shown = toggle?.folded ? FOLD_SHOW : lines.length;
        const numbered = lines.length >= NUMBER_AT;
        const room = columns - 2 - gutterOf(lines, numbered);
        const gutter = numbered ? String(lines.length).length : 0;
        const held = mirrored(style) && lines.some((line) => hasRtl(line) && (!opensLatin(line) || width(line) > room));
        const rows = held
          ? heldCode(el, style, lines, shown, block.lang, gutter, room, key)
          : codeRows(el, style, lines, shown, block.lang, numbered, room, key);
        const button = copy?.(lines.join("\n"), `copy${b}`) ?? null;
        const label = codeLabel(block);
        const head = codeHead(label, button);
        return h(
          Box,
          { key: key, flexDirection: "column", alignSelf: "flex-start", minWidth: head?.minWidth },
          note ? h(Text, { color: t.codeComment }, note) : null,
          h(
            Box,
            { flexDirection: "row", justifyContent: "space-between", columnGap: head ? 1 : 4 },
            h(Text, { color: t.codeComment }, label),
            head ? head.marker : button,
            head?.element,
          ),
          codeBody(el, style, rows, gutter, held, toggle?.element ?? null),
        );
      }
      case "list":
        return renderList(el, style, block, room(b), key, copy, fold, tip);
      case "table":
        return renderTable(el, style, block, room(b), key, rtlTables[b], tip);
      case "notes":
        return h(
          Box,
          { key: key, flexDirection: "column" },
          h(Text, { dimColor: true }, "─".repeat(Math.min(columns, 12))),
          block.notes.map((note, i) =>
            h(
              Text,
              _extends({ key: `${key}.${i}`, dimColor: true }, noteHover(style, note.note)),
              note.mark,
              " ",
              renderInline(el, style, note.inline, `${key}.${i}`),
            ),
          ),
        );
      default:
        return undefined;
    }
  });
  const copied = rendered.map((element, b) => {
    const block = blocks[b];
    const { first, more } = buttons[b];
    if (!first) return element;
    const kept = fitted([first, ...more]);
    const { Box } = el;
    const hebrew = style.reorder && hasRtl(block.raw);
    const rtl = hebrew && !mirrored(style);
    const mirror = hebrew && mirrored(style);
    if (hover) {
      const wide = rtl && (block.kind === "list" || block.kind === "quote" || block.kind === "alert" || rtlTables[b]);
      const start = !!wide && (!!rtlTables[b] || leadSide(style, block, room(b)) === "R");
      return markedRow(el, `c${b}`, element, floating(kept, opensWithCopy(block), start), start);
    }
    const button =
      kept.length > 1 ? h(el.Box, { key: `copies${b}`, flexDirection: "row", columnGap: 1 }, ...kept) : first;
    return (block.kind === "quote" || block.kind === "alert") && !mirrored(style)
      ? h(
          Box,
          _extends({ key: `c${b}`, flexDirection: "row", columnGap: 2 }, rtl ? { justifyContent: "flex-end" } : {}),
          element,
          opensWithCopy(block) ? h(Box, { alignSelf: "flex-end" }, button) : button,
        )
      : h(
          Box,
          _extends(
            { key: `c${b}`, flexDirection: "column" },
            mirror
              ? { width: "100%" }
              : rtl && (block.kind === "list" || rtlTables[b])
                ? {}
                : { alignSelf: "flex-start" },
          ),
          h(Box, { justifyContent: "flex-end" }, button),
          element,
        );
  });
  const isFigure = (b) => blocks[b]?.kind === "table" || drawn.get(b)?.art !== undefined;
  const out = [];
  for (let b = 0; b < rendered.length; b++) {
    if (!isFigure(b) || !isFigure(b + 1)) {
      out.push(copied[b]);
      continue;
    }
    const start = b;
    while (isFigure(b + 1)) b++;
    out.push(
      h(
        Box,
        { key: `row${start}`, flexDirection: "row", flexWrap: "wrap", columnGap: 4, rowGap: 1 },
        copied.slice(start, b + 1).map((figure, i) => h(Box, { key: `f${start + i}`, flexShrink: 0 }, figure)),
      ),
    );
  }
  return out;
};

const formatDuration = (ms) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${Math.max(s, 0)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

const renderTurnDuration = ({ Text }, style, word, durationMs) =>
  h(
    Text,
    { color: style.theme.codeComment },
    `✻ ${word} for `,
    h(Text, { color: style.theme.number }, formatDuration(durationMs)),
  );

const boxedPrompt = (style) => style.promptStyle === "bubble" || style.promptStyle === "wide";

const widePrompt = (style, hebrew) => style.promptStyle === "wide" || (hebrew && mirrored(style));

const renderUserPrompt = (el, style, typed, columns) => {
  const { Box, Text } = el;
  const t = style.theme;
  const color = style.promptStyle === "chevron" ? t.accent : t.heading;
  const rows = typed.split("\n");
  const lines = rows.map((line) => flowOf(style, [{ kind: "text", text: line }], columns - 4));
  const hebrew = lines.some((l) => l?.base === "R");
  const rtl = hebrew && !mirrored(style);
  const body = h(
    Box,
    _extends({ flexDirection: "column" }, rtl ? { alignItems: "flex-end" } : {}),
    rows.map((line, i) => {
      const flow = lines[i];
      return flow
        ? renderFlow(el, style, flow.lines, `p${i}`, { color, bold: style.promptStyle === "chevron" })
        : h(Text, { key: `p${i}`, color: color, bold: style.promptStyle === "chevron" }, line);
    }),
  );

  if (boxedPrompt(style)) {
    return h(
      Box,
      _extends(
        { borderStyle: "round", borderColor: t.accent, paddingX: 1, alignSelf: rtl ? "flex-end" : "flex-start" },
        widePrompt(style, hebrew) ? { width: "100%" } : {},
      ),
      body,
    );
  }
  const mark = h(
    Text,
    { color: t.accent, bold: true },
    style.promptStyle === "bar" ? (rtl ? " ▐" : "▌ ") : rtl ? " ‹" : "› ",
  );
  return h(
    Box,
    _extends({ flexDirection: "row" }, rtl ? { justifyContent: "flex-end" } : {}),
    rtl ? body : mark,
    rtl ? mark : body,
  );
};

export {
  cells,
  drawMath,
  drawsHyperlinks,
  fileRoot,
  graphemes,
  heldLtr,
  instanceKey,
  MARK,
  markerRoom,
  mirrored,
  noteTip,
  pathsToProbe,
  remember,
  renderBlocks,
  renderTurnDuration,
  renderUserPrompt,
  width,
};
