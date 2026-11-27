import { apiLook, apiOf } from "./api-table.ts";
import { benchLook, benchOf, benchSpark } from "./bench-table.ts";
import { compareLook, compareOf } from "./compare-table.ts";
import { figureText, isFigureLang } from "./figure.ts";
import { type Group, type GroupTable, groupEdge, groupHeavy, groupLook, groupOf, groupRows } from "./group-table.ts";
import { type Heat, heatLook, heatOf, heatRows } from "./heat-table.ts";
import { tableHtml, tableText } from "./html.ts";
import type { ElementTable, RenderElement, RenderNode, TextHoverProps } from "./jsx.ts";
import { h } from "./jsx.ts";
import { kvLook, kvOf } from "./kv-table.ts";
import { mathOf } from "./latex.ts";
import {
  cells,
  columnWidths,
  graphemes,
  longestWord,
  mostLines,
  type Span,
  textRows,
  widestLine,
  width,
  wrapRanges,
} from "./layout.ts";
import type { AlertLevel, Block, CodeLink, Inline, ListItem, TableAlign, TableBlock, TableCell } from "./markdown.ts";
import {
  DRIVE_PATH,
  displayText,
  inlineText,
  isPathSpelling,
  isWebLink,
  NAME,
  nestedBlocks,
  PART,
  parseInline,
  pathSpellings,
  texParses,
  texText,
} from "./markdown.ts";
import { pivotOf } from "./pivot-table.ts";
import type { Flow } from "./rtl.ts";
import {
  codeVisual,
  commentTail,
  commentVisual,
  containsRtl,
  engineProse,
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
import { schemaLook, schemaOf } from "./schema-table.ts";
import { type Bucket, statusEdge, statusFooter, statusHeavy, statusLook, statusOf, statusRows } from "./status.ts";
import { testReport } from "./test-report.ts";
import type { Ink, Style, Theme } from "./theme.ts";
import { type Tree, treeLook, treeOf, treeRows } from "./tree-table.ts";
import { languages, tokenize } from "./vendor/prism.js";

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
export type Hues = Ink[][];
export type CopyButton = (
  text: string | (() => string),
  key: string,
  label?: string,
  rich?: (() => string) | "png",
  hues?: () => Hues,
) => RenderElement | null;
/** `art` and `png` exclude each other: a drawing is text art or a picture of a known PNG (base64). */
export type DrawnBlock =
  | { note: string; element?: never; art?: never; hues?: never; png?: never }
  | { element: RenderElement; art?: string; hues?: () => Hues; png?: never; note?: never }
  | { element: RenderElement; png: string; art?: never; hues?: never; note?: never };
export type Drawn = Map<number, DrawnBlock>;
/** Buttons that act on a drawn picture, in display order. Empty when they are off or cannot reach the user's machine. */
export type PictureButtons = (png: string, b: number) => RenderElement[];
export type Fold = (id: string, hidden: number, key: string) => { folded: boolean; element: RenderElement } | null;
export type Tip = (note: number) => (() => void) | undefined;
export type BlockOf<K extends Block["kind"]> = Extract<Block, { kind: K }>;
export type InlineOf<K extends Inline["kind"]> = Extract<Inline, { kind: K }>;
export type Reach = Pick<
  Style,
  "httpLinks" | "editorLinks" | "obsidianLinks" | "fileLinks" | "pathLinks" | "hyperlinks" | "cwd" | "home" | "found"
>;
export type Probe = { key: string; href: string };
export type Segment = { text: string; color?: string; italic?: boolean };
export type Mark = { start: number; end: number; text: string; note: number };
export type PrismToken = {
  type: string;
  content: string | PrismToken | (string | PrismToken)[];
  alias?: string | string[];
};
export type Grammar = Record<string, unknown>;
export type Floating = { needs: number; marker: RenderElement; element: RenderElement };
export type CopyRow = { first: RenderElement | null | undefined; more: (RenderElement | null | undefined)[] };
export type Look = {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  dimColor?: boolean;
  strikethrough?: boolean;
};

const _extends = Object.assign;

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

const headerRuns = (nodes: Inline[]): Inline[] => {
  const flat = nodes.flatMap((n): Inline[] =>
    n.kind === "footnote" ? [n] : "children" in n ? headerRuns(n.children) : [{ kind: "text", text: n.text }],
  );
  const out: Inline[] = [];
  for (const n of flat) {
    const last = out[out.length - 1];
    if (n.kind === "text" && last?.kind === "text") out[out.length - 1] = { kind: "text", text: last.text + n.text };
    else out.push(n);
  }
  return out;
};

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

const obsidianTargets = (href: string): string[] => [
  href,
  ...(/\?([^#]*)/.exec(href)?.[1] ?? "")
    .split("&")
    .filter((pair) => /^(file|path)=/i.test(unescaped(pair)))
    .map((pair) => pair.slice(pair.indexOf("=") + 1).replaceAll("?", "%3F")),
];

const opensObsidianNote = (href: string): boolean =>
  /^obsidian:\/\/(open([?#]|$)|\/)/i.test(href) &&
  !/[?&](append|prepend)([=&]|$)/i.test(unescaped(href)) &&
  !obsidianTargets(href).some(launches);

const isHyperlink = (href: string, reach: Reach): boolean =>
  (reach.httpLinks ? /^https?:/i : /^(https:|http:\/\/localhost(:\d+)?([/?#]|$))/i).test(href) ||
  (reach.editorLinks && /^(vscode(-insiders)?|cursor|windsurf|zed):\/\/file\//i.test(href)) ||
  (reach.obsidianLinks && opensObsidianNote(href)) ||
  (reach.fileLinks !== null && /^file:/i.test(href) && !launches(href) && opens(reach, href));

const bare = (path: string): boolean => /^\d*$/.test(extensionOf(path.replace(/[/\\]+$/, "").replace(/^.*[/\\]/, "")));

const hrefPath = (reach: Reach, href: string): string =>
  (linkPath(reach.fileLinks ?? "file://", href) ?? href).replace(/^\/(?=[a-z]:)/i, "").replace(/(?<=.)\/+$/, "");

const opens = (reach: Reach, href: string): boolean => {
  const path = hrefPath(reach, href);
  return !bare(path) || reach.found?.has(`${path}/`) === true;
};

const bareKey = (reach: Reach, href: string | undefined): string[] =>
  href === undefined || !bare(hrefPath(reach, href)) ? [] : [hrefPath(reach, href)];

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

const ZERO_WIDTH = /\p{Cf}|\u034f|\u180e/gu;

const WEB_TLDS = new Set([
  "com",
  "org",
  "net",
  "io",
  "dev",
  "app",
  "ai",
  "co",
  "gov",
  "edu",
  "info",
  "biz",
  "me",
  "xyz",
  "example",
  "test",
  "uk",
  "de",
  "fr",
  "eu",
  "ie",
  "il",
  "ca",
  "au",
  "jp",
  "cn",
  "ru",
  "br",
  "in",
]);

const hostOf = (href: string): string | undefined =>
  /^[a-z][\w+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i
    .exec(href)?.[1]
    ?.toLowerCase()
    .replace(/^www\./, "");

const shownHost = (label: string): string =>
  label
    .replace(/[*_~`]/g, "")
    .replace(/[\u3002\uff0e\uff61]/gu, ".")
    .trim()
    .replace(/\.$/, "")
    .replace(/^\/\//, "")
    .replace(/^([a-z][\w+.-]*:\/\/)?[^@/?#\s]*@/i, "$1");

const labelHost = (label: string): string | undefined => {
  const m = /^([a-z][\w+.-]*:\/\/)?((?:www\.)?[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)(?::\d+)?(?:[/?#]\S*)?$/iu.exec(
    shownHost(label),
  );
  const rawHost = m?.[2]?.toLowerCase();
  const host = rawHost?.replace(/^www\./, "");
  if (!m || !host || !rawHost) return undefined;
  return m[1] || host !== rawHost || WEB_TLDS.has(host.slice(host.lastIndexOf(".") + 1)) ? host : undefined;
};

const labelHosts = (label: string): string[] =>
  [label, ...label.split(/\s+/).map((word) => word.replace(/^[([<"']+|[)\]>"'.,;:!?]+$/g, ""))].flatMap(
    (part) => labelHost(part) ?? [],
  );

const spoofs = (label: string, href: string): boolean => {
  const clean = label.replace(ZERO_WIDTH, "");
  const shown = labelHosts(clean);
  if (shown.length === 0) return false;
  const real = hostOf(href) ?? "";
  return clean !== label || shown.some((host) => real !== host && !real.endsWith(`.${host}`));
};

const drawnLink = (n: InlineOf<"link">, reach: Reach): Inline => {
  const href = reach.fileLinks !== null && /^file:/i.test(n.href) ? fileHref(reach.fileLinks, n.href) : n.href;
  if (
    !isHyperlink(n.href, reach) ||
    encodedLength(href) > LINK_MAX ||
    hidesFile(reach, n, href) ||
    spoofs(n.text, n.href)
  )
    return { kind: "text", text: plainLink(n.text.replace(ZERO_WIDTH, ""), n.href) };
  if (!reach.hyperlinks && /^file:/i.test(n.href)) return { kind: "path", text: n.text };
  return href === n.href ? n : { ...n, href };
};

const linksAsPath = (path: string): boolean =>
  !path.startsWith("/") || /^\/[^/]+\/+[^/]/.test(path.replace(/\.+$/, ""));

const drawnPath = (n: InlineOf<"path">, reach: Reach): Inline => {
  const href = reach.pathLinks && linksAsPath(n.text) ? pathHref(reach, n.text) : undefined;
  return href === undefined || !opens(reach, href) ? n : { ...n, href };
};

const drawnCode = (n: InlineOf<"code">, reach: Reach): Inline => {
  const drawn = isPathSpelling(n.text) ? drawnPath({ kind: "path", text: n.text }, reach) : undefined;
  return drawn?.kind === "path" && drawn.href !== undefined ? { ...n, href: drawn.href } : n;
};

const LOOSE_PATH = new RegExp(
  String.raw`(?<![\p{L}\p{N}_/\\.:~@+-])(?:${DRIVE_PATH.source}|${NAME}(?:\/${NAME})*\/(?:${NAME})?|${PART}(?:\.${PART})+)(?![\p{L}\p{N}_/\\@+-]|\.[\p{L}\p{N}])`,
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
  return probe && reach.found?.has(probe.key) && opens(reach, probe.href) ? probe : undefined;
};

type Loose = InlineOf<"text" | "number">;

const runsOf = (nodes: Inline[]): (Inline | Loose[])[] => {
  const out: (Inline | Loose[])[] = [];
  for (const n of nodes) {
    const last = out.at(-1);
    if (n.kind !== "text" && n.kind !== "number") out.push(n);
    else if (Array.isArray(last)) last.push(n);
    else out.push([n]);
  }
  return out;
};

const spans = (run: Loose[]): { n: Loose; start: number; end: number }[] => {
  let at = 0;
  return run.map((n) => {
    const start = at;
    at += n.text.length;
    return { n, start, end: at };
  });
};

const runSpellings = (run: Loose[]): RegExpExecArray[] => {
  const numbers = spans(run).filter((s) => s.n.kind === "number");
  return looseSpellings(run.map((n) => n.text).join("")).filter(
    (m) => !numbers.some((s) => s.start <= m.index && m.index + m[0].length <= s.end),
  );
};

const cut = (run: Loose[], from: number, to: number): Inline[] =>
  spans(run).flatMap(({ n, start }) => {
    const text = n.text.slice(Math.max(from - start, 0), Math.max(to - start, 0));
    return text ? [{ ...n, text }] : [];
  });

const loosePaths = (run: Loose[], reach: Reach): Inline[] => {
  const out: Inline[] = [];
  let at = 0;
  for (const m of runSpellings(run)) {
    const probe = foundProbe(reach, m[0]);
    if (!probe) continue;
    out.push(...cut(run, at, m.index), { kind: "path", text: m[0], href: probe.href });
    at = m.index + m[0].length;
  }
  return at === 0 ? run : [...out, ...cut(run, at, Infinity)];
};

const looseCode = (n: InlineOf<"code">, reach: Reach): Inline => {
  const probe = isWholePath(n.text) ? foundProbe(reach, n.text) : undefined;
  return probe ? { ...n, href: probe.href } : n;
};

const isWholePath = (text: string): boolean => looseSpellings(text).some((m) => m[0] === text);

const looseNode = (node: Inline, reach: Reach): Inline | Inline[] => {
  const n = linked(node, reach);
  if (n.kind === "text") return loosePaths([n], reach);
  return n.kind === "code" ? looseCode(n, reach) : n;
};

const linked = (node: Inline, reach: Reach): Inline => {
  const n: Inline =
    node.kind === "image" && isWebLink(node.src) ? { kind: "link", text: node.text, href: node.src } : node;
  if (n.kind === "link") return drawnLink(n, reach);
  if (n.kind === "path") return drawnPath(n, reach);
  if (n.kind === "code") return drawnCode(n, reach);
  return "children" in n ? { ...n, children: hyperlinks(n.children, reach) } : n;
};

const hyperlinks = (nodes: Inline[], reach: Reach): Inline[] =>
  reach.found?.size
    ? runsOf(nodes).flatMap((n) => (Array.isArray(n) ? loosePaths(n, reach) : looseNode(n, reach)))
    : nodes.map((node) => linked(node, reach));

const spellingsIn = (nodes: Inline[]): string[] =>
  runsOf(nodes).flatMap((n) => {
    if (Array.isArray(n)) return runSpellings(n).map((m) => m[0]);
    if ("children" in n) return spellingsIn(n.children);
    return n.kind === "code" && isWholePath(n.text) ? [n.text] : [];
  });

const isPlainText = (lang: string): boolean => ["", "text", "txt", "plain", "plaintext"].includes(lang.toLowerCase());

const codeSpans = (line: string): { start: number; end: number }[] => {
  const spellings = [...pathSpellings(line), ...looseSpellings(line)]
    .map((m) => ({ start: m.index, end: m.index + m[0].length }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let edge = 0;
  return spellings.filter((s) => {
    if (s.start < edge) return false;
    edge = s.end;
    return true;
  });
};

const spanNode = (line: string, span: { start: number; end: number }): Inline => ({
  kind: "code",
  text: line.slice(span.start, span.end),
});

const inlinesOf = (block: Block): Inline[][] => {
  switch (block.kind) {
    case "code":
      return isPlainText(block.lang)
        ? block.lines.map((line) => codeSpans(line).map((span) => spanNode(line, span))).filter((nodes) => nodes.length)
        : [];
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

const pathKey = (reach: Reach, path: string): string[] =>
  reach.pathLinks && linksAsPath(path) ? bareKey(reach, pathHref(reach, path)) : [];

const bareKeysIn = (nodes: Inline[], reach: Reach): string[] =>
  nodes.flatMap((n) => {
    if (n.kind === "path") return pathKey(reach, n.text);
    if (n.kind === "code") return isPathSpelling(n.text) ? pathKey(reach, n.text) : [];
    if (n.kind === "link") return /^file:/i.test(n.href) ? bareKey(reach, n.href) : [];
    return "children" in n ? bareKeysIn(n.children, reach) : [];
  });

const pathsToProbe = (blocks: Block[], reach: Reach): string[] => {
  if (reach.fileLinks === null) return [];
  return nestedBlocks(blocks).flatMap((block) => {
    const spellings = spelled.get(block) ?? inlinesOf(block).flatMap(spellingsIn);
    spelled.set(block, spellings);
    const loose = reach.pathLinks ? spellings.flatMap((spelling) => looseProbe(reach, spelling)?.key ?? []) : [];
    return [...loose, ...inlinesOf(block).flatMap((nodes) => bareKeysIn(nodes, reach))];
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
    case "code": {
      if (!isPlainText(block.lang)) return block;
      const links = block.lines.map((line) => {
        const found = codeSpans(line).flatMap((span): CodeLink[] => {
          const node = drawn([spanNode(line, span)])[0];
          return node?.kind === "code" && node.href ? [{ ...span, href: node.href }] : [];
        });
        return found.length ? found : undefined;
      });
      return links.some(Boolean) ? { ...block, links } : block;
    }
    default:
      return block;
  }
};

const hyperlinked = new WeakMap<Block, Record<string, Block>>();

const drawable = (block: Block, reach: Reach): Block => {
  const cached: Record<string, Block> = hyperlinked.get(block) ?? {};
  hyperlinked.set(block, cached);
  const key = `${+reach.httpLinks}${+reach.editorLinks}${+reach.obsidianLinks}${+reach.hyperlinks}${reach.fileLinks ?? ""}\0${reach.found?.size ?? 0}${reach.pathLinks ? `\0${reach.home}\0${reach.cwd}` : ""}`;
  cached[key] ??= hyperlinkBlock(block, reach);
  return cached[key];
};

const heightOf = (blocks: Block[], w: number, style: Style): number =>
  blocks.reduce((sum, block, b) => sum + (b ? 1 : 0) + blockHeight(block, w, style), 0);

const tableShape = (
  block: TableBlock,
  style: Style,
): { base: TableBlock; block: TableBlock; tree: Tree | undefined; heat: Heat | undefined } => {
  const base = pivotOf(block, style.pivotTable) ?? block;
  const tree = treeOf(base, style.treeTable, statusOf(base, style.statusMatrix, false) !== undefined);
  const heat = heatOf(base, style.heatTable);
  if (!tree && !heat) return { base, block: base, tree, heat };
  const rows = heatRows({ ...base, rows: treeRows(base, tree) }, heat, style.heatTable);
  return { base, block: { ...base, rows }, tree, heat };
};

const blockHeight = (block: Block, w: number, style: Style): number => {
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
            sum +
            textRows(displayText(item.inline), w - pad) +
            (item.blocks ? heightOf(item.blocks, w - pad, style) + 1 : 0)
          );
        },
        textRows(`${"━".repeat(20)} ${block.items.length}/${block.items.length} done`, w),
      );
    case "code":
      return block.lines.reduce((sum, line) => sum + textRows(line, w - 8), 3);
    case "table": {
      const base = pivotOf(block, style.pivotTable) ?? block;
      if (tablePlan(base, style, w, textsOf(style, base)).stack) return stackedHeight(base, w);
      const shaped = tableShape(block, style).block;
      const plan = tablePlan(shaped, style, w, textsOf(style, shaped));
      if (plan.stack) return stackedHeight(base, w);
      const classic = style.tableLayout === "classic" && tableSize(shaped);
      const widths = classic ? columnWidths(classic.natural, w - 4, 3, classic.words) : plan.widths;
      const tallest = (cells: TableCell[]) =>
        Math.max(1, ...widths.map((cw, c) => textRows(displayText(cells[c] ?? []), cw)));
      return shaped.rows.reduce((sum, row) => sum + 1 + tallest(row), 4 + tallest(shaped.header));
    }
    case "quote":
      return Math.max(1, heightOf(block.blocks, w - 2, style));
    case "alert":
      return 3 + heightOf(block.blocks, w - 4, style);
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

const renderInline = (
  el: ElementTable,
  style: Style,
  nodes: Inline[],
  keyBase: string,
  numberFace: { color?: string } = { color: style.theme.number },
): RenderNode[] => {
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
        return h(Text, _extends({ key: key }, numberFace), n.text);
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

const KEPT_CHARS = 1_000_000;
const keptTotals = new WeakMap<ReadonlyMap<string, unknown>, { size: number; chars: number }>();

const keptChars = (cache: ReadonlyMap<string, unknown>): number => {
  const known = keptTotals.get(cache);
  if (known?.size === cache.size) return known.chars;
  let chars = 0;
  for (const key of cache.keys()) chars += key.length;
  return chars;
};

const remember = <V>(cache: Map<string, V>, key: string, make: () => V, limit = 200): V => {
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const value = make();
  let chars = keptChars(cache) + (cache.has(key) ? 0 : key.length);
  cache.set(key, value);
  for (const old of cache.keys()) {
    if (cache.size <= limit && (chars <= KEPT_CHARS || old === key)) break;
    chars -= old.length;
    cache.delete(old);
  }
  keptTotals.set(cache, { size: cache.size, chars });
  return value;
};

const highlighted = new WeakMap<Theme, Map<string, Segment[][] | null>>();

const grammarFor = (lang: string): Grammar | undefined => {
  const name = lang.toLowerCase();
  const grammar = Object.hasOwn(languages, name) ? languages[name] : undefined;
  return grammar !== null && typeof grammar === "object" ? grammar : undefined;
};

const shownSegment = (seg: Segment, piece: string, style: Style, room?: number): Segment => ({
  ...seg,
  text: seg.italic ? piece : shownCode(piece, style, room),
});

const LONG_WORD = 1000;

const hasLongWord = (code: string): boolean => code.split(/[^$\w\xA0-\uFFFF]/).some((word) => word.length > LONG_WORD);

const segmentRows = (
  style: Style,
  lines: string[],
  lang: string,
  room?: number,
  shown = lines.length,
  isOpen = false,
): Segment[][] | null => {
  const grammar = grammarFor(lang);
  if (!grammar) return null;
  const code = (isOpen ? lines.slice(0, shown) : lines).join("\n");
  const cache = highlighted.get(style.theme) ?? new Map<string, Segment[][] | null>();
  highlighted.set(style.theme, cache);
  return remember(cache, `${style.reorder ? style.shape : ""}\0${room ?? ""}\0${lang}\0${shown}\0${code}`, () =>
    hasLongWord(code) ? null : tokenRows(style, code, grammar, shown, room),
  );
};

const tokenRows = (style: Style, code: string, grammar: Grammar, shown: number, room?: number): Segment[][] => {
  const out: Segment[][] = [[]];
  for (const seg of flatten(tokenize(code, grammar), style)) {
    for (const [i, piece] of seg.text.split("\n").entries()) {
      if (i > 0 && out.push([]) > shown) return keptRows(style, out.slice(0, shown));
      if (piece) out[out.length - 1].push(shownSegment(seg, piece, style, room));
    }
  }
  return keptRows(style, out);
};

const keptRows = (style: Style, rows: Segment[][]): Segment[][] => (style.reorder ? rows : rows.map(mergeRuns));

const mergeRuns = (row: Segment[]): Segment[] =>
  row.reduce<Segment[]>((runs, seg) => {
    const last = runs[runs.length - 1];
    if (last && last.color === seg.color && last.italic === seg.italic)
      runs[runs.length - 1] = { ...last, text: last.text + seg.text };
    else runs.push(seg);
    return runs;
  }, []);

const highlightBlock = (
  { Text }: ElementTable,
  style: Style,
  lines: string[],
  lang: string,
  key: string,
  room?: number,
  shown?: number,
  isOpen?: boolean,
): RenderElement[] | null => {
  const rows = segmentRows(style, lines, lang, room, shown, isOpen);
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

const heldSegments = (style: Style, lines: string[], lang: string, shown: number, isOpen?: boolean): Segment[][] => {
  const plain = plainBlock(lang, lines);
  return (
    (isShellLang(lang)
      ? lines.slice(0, shown).map((line) => shellLine(style, line, plain))
      : segmentRows(style, lines, lang, undefined, shown, isOpen)) ??
    lines.slice(0, shown).map((text) => (text ? [{ text, italic: false }] : []))
  );
};

const heldCode = (
  el: ElementTable,
  style: Style,
  lines: string[],
  shown: number,
  lang: string,
  gutter: number,
  room: number,
  key: string,
  isOpen?: boolean,
): RenderElement[] =>
  heldSegments(style, lines, lang, shown, isOpen).flatMap((segs, i) =>
    visualRows(tabbed(mergeRuns(segs)), room).map((part, k) =>
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

const figureFallbackLines = (block: BlockOf<"code">): string[] =>
  isFigureLang(block.lang) ? block.lines.map(figureText) : block.lines;

const linkedLine = (
  { Text, Link }: ElementTable,
  style: Style,
  line: string,
  links: readonly CodeLink[],
  key: string,
): RenderElement => {
  const pieces: RenderNode[] = [];
  let at = 0;
  links.forEach(({ start, end, href }, i) => {
    if (start > at) pieces.push(line.slice(at, start));
    pieces.push(h(Link, { key: `l${i}`, href, label: line.slice(start, end) }));
    at = end;
  });
  if (at < line.length) pieces.push(line.slice(at));
  return h(Text, { key: key, color: style.theme.codeText }, pieces);
};

const codeRows = (
  el: ElementTable,
  style: Style,
  lines: string[],
  shown: number,
  lang: string,
  _numbered: boolean,
  room: number,
  key: string,
  isOpen?: boolean,
  links?: readonly (readonly CodeLink[] | undefined)[],
): RenderElement[] => {
  const plain = plainBlock(lang, lines);
  const draw = (line: string, i: number): RenderElement => {
    const found = links?.[i];
    return found
      ? linkedLine(el, style, line, found, `${key}.${i}`)
      : codeLine(el, style, line, lang, `${key}.${i}`, room, plain);
  };
  if (style.shape === "engine" && !plain && !isShellLang(lang) && Object.keys(grammarFor(lang) ?? {}).length === 0) {
    return lines.slice(0, shown).map((line, i) => {
      const text = BOX_DRAWING.test(line) ? null : engineProse(line);
      return text === null
        ? h(el.Text, _extends({ key: `${key}.ltr${i}` }, heldLtr(style)), draw(line, i))
        : h(el.Text, { key: `${key}.${i}`, color: style.theme.codeText }, text);
    });
  }
  const rows =
    (isShellLang(lang) || links ? null : highlightBlock(el, style, lines, lang, key, room, shown, isOpen)) ??
    lines.slice(0, shown).map(draw);
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

const plainBlock = (lang: string, lines: readonly string[]): boolean =>
  lang === "" && lines.some((line) => BOX_DRAWING.test(line));

const SHELL_COMMENT = /^\s*#/;

const codeLine = (
  el: ElementTable,
  style: Style,
  line: string,
  lang: string,
  key: string,
  room?: number,
  plain = false,
): RenderElement => {
  const { Text } = el;
  const t = style.theme;
  const isShell = isShellLang(lang);
  if (plain || BOX_DRAWING.test(line)) return h(Text, { key: key, color: t.codeText }, line || " ");
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

const shellLine = (style: Style, line: string, plain = false): Segment[] => {
  if (!line) return [];
  if (plain || BOX_DRAWING.test(line)) return [{ text: line, color: style.theme.codeText, italic: false }];
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

const tableCells = (block: BlockOf<"table">): Inline[][] => [...block.header, ...block.rows.flat()];

const mostlyRtl = (style: Style, lines: Inline[][]): boolean =>
  lines.filter((line) => flowOf(style, line, Infinity)?.base === "R").length * 2 > lines.length;

const isRtlTable = (style: Style, block: BlockOf<"table">): boolean =>
  mostlyRtl(
    style,
    tableCells(block).filter((cell) => displayText(cell).trim() !== ""),
  );

const ART_WIDTH = 100;

const cellText = (style: Style) => (style.hyperlinks ? inlineText : displayText);

const tableSize = (block: BlockOf<"table">, shown: (cell: Inline[]) => string = displayText) => {
  const rows = [block.header, ...block.rows].map((r) => block.header.map((_, c) => shown(r[c] ?? [])));
  const column = (measure: (text: string) => number) =>
    block.header.map((_, c) => Math.max(...rows.map((r) => measure(r[c]))));
  return { natural: column(widestLine), words: column(longestWord) };
};

type Face = Ink;

const own = (face: Face): Face => ({
  ...(face.color !== undefined ? { color: face.color } : {}),
  ...(face.bold !== undefined ? { bold: face.bold } : {}),
  ...(face.italic !== undefined ? { italic: face.italic } : {}),
  ...(face.dim !== undefined ? { dim: face.dim } : {}),
});

const numberPaint = (face: Face, header: boolean, t: Theme): { color?: string } =>
  header || face.color === undefined ? { color: t.number } : {};

const INLINE_FACE: Partial<Record<Inline["kind"], (t: Theme) => Face>> = {
  strong: (t) => ({ color: t.strong, bold: true }),
  emphasis: (t) => ({ color: t.emphasis, italic: true }),
  math: (t) => ({ color: t.emphasis, italic: true }),
  code: (t) => ({ color: t.inlineCode }),
  link: (t) => ({ color: t.link }),
  image: (t) => ({ color: t.link }),
  number: (t) => ({ color: t.number }),
  path: (t) => ({ color: t.path }),
  footnote: (t) => ({ color: t.accent }),
};

const cellInks = (t: Theme, nodes: Inline[], face: Face): Ink[] =>
  nodes.flatMap((n) => {
    const inner: Face = { ...face, ...own(INLINE_FACE[n.kind]?.(t) ?? {}) };
    return "children" in n
      ? cellInks(t, n.children, inner)
      : Array.from({ length: displayText([n]).length }, (): Ink => inner);
  });

const blank = (n: number): Ink[] => Array.from({ length: n }, (): Ink => ({}));

const glyphInks = (piece: string, from: number, paint: Ink[]): Ink[] => {
  let at = from;
  return graphemes(piece).flatMap((g) => {
    const ink = paint[at] ?? {};
    at += g.length;
    return cells(g).map(() => ink);
  });
};

const placed = (piece: string, w: number, align: TableAlign) => {
  const room = Math.max(0, w - width(piece));
  const left = align === "right" ? room : align === "center" ? Math.floor(room / 2) : 0;
  return { left, right: room - left };
};

const tablePicture = (block: BlockOf<"table">, screen: boolean, t: Theme = {}): { text: string; inks: Ink[][] } => {
  const rows = [block.header, ...block.rows].map((r) => block.header.map((_, c) => r[c] ?? []));
  const texts = rows.map((r) => r.map(displayText));
  const { natural, words } = tableSize(block);
  const widths = columnWidths(natural, ART_WIDTH - 4, 3, words);
  const rule: Ink = own({ color: t.tableRule, dim: !t.tableRule || undefined });
  const header: Ink = own({ color: t.tableHeader, bold: screen || undefined });
  const lines: string[] = [];
  const inks: Ink[][] = [];
  const line = (l: string, m: string, r: string, fill = "─") => {
    const text = l + widths.map((w) => fill.repeat(w + 2)).join(m) + r;
    lines.push(text);
    inks.push(cells(text).map(() => rule));
  };
  const alignOf = (i: number, c: number): TableAlign => (i === 0 && !screen ? "center" : (block.align[c] ?? "left"));
  const paintOf = (i: number, c: number): Ink[] =>
    i === 0 ? Array.from({ length: texts[i][c].length }, (): Ink => header) : cellInks(t, rows[i][c], {});
  const row = (i: number) => {
    const paints = texts[i].map((_, c) => paintOf(i, c));
    const pieces = texts[i].map((text, c) => wrapRanges(text, widths[c]));
    for (let k = 0; k < Math.max(...pieces.map((p) => p.length)); k++) {
      const parts = pieces.map((p, c) => {
        const [a, b] = p[k] ?? [0, 0];
        const piece = texts[i][c].slice(a, b);
        const { left, right } = placed(piece, widths[c], alignOf(i, c));
        return {
          text: ` ${" ".repeat(left)}${piece}${" ".repeat(right)} │`,
          ink: [...blank(left + 1), ...glyphInks(piece, a, paints[c]), ...blank(right + 1), rule],
        };
      });
      lines.push(`│${parts.map((part) => part.text).join("")}`);
      inks.push([rule, ...parts.flatMap((part) => part.ink)]);
    }
  };
  line("┌", "┬", "┐");
  row(0);
  for (let i = 1; i < rows.length; i++) {
    if (i === 1 && screen) line("╞", "╪", "╡", "═");
    else line("├", "┼", "┤");
    row(i);
  }
  line("└", "┴", "┘");
  return { text: lines.join("\n"), inks };
};

const tableGrid = (block: BlockOf<"table">): string => tablePicture(block, false).text;

const tableArt = (block: BlockOf<"table">): string => ["```", tableGrid(block), "```"].join("\n");

const rightToLeft = (block: BlockOf<"table">): BlockOf<"table"> => {
  const flip = <T>(row: T[], fill: T) => block.header.map((_, c) => row[c] ?? fill).reverse();
  return {
    ...block,
    header: flip(block.header, []),
    rows: block.rows.map((row) => flip(row, [])),
    align: flip(block.align, "left"),
  };
};

const tableArts = (block: BlockOf<"table">, t: Theme, rtl: boolean) => {
  let picture: { text: string; inks: Ink[][] } | undefined;
  const drawn = () => (picture ??= tablePicture(rtl ? rightToLeft(block) : block, true, t));
  return {
    art: () => tableArt(rtl ? rightToLeft(block) : block),
    grid: () => drawn().text,
    hues: () => drawn().inks,
  };
};

const artsOf = (
  drawn: DrawnBlock | undefined,
  block: Block,
  t: Theme,
  rtl: boolean,
): { art?: string | (() => string); grid?: string | (() => string); hues?: () => Hues } =>
  drawn?.art !== undefined
    ? { art: drawn.art, grid: drawn.art, hues: drawn.hues }
    : block.kind === "table"
      ? tableArts(block, t, rtl)
      : {};

const columnRoom = (box: boolean, columns: number): number => (box ? columns - 4 : columns);

const tableMinimums = (natural: number[], words: number[]): number[] =>
  natural.map((w, c) => Math.min(w, Math.max(1, words[c] ?? 1)));

const textsOf = (style: Style, block: TableBlock): boolean =>
  style.reorder && style.shape === "inverse" && isRtlTable(style, block);

const tablePlan = (block: TableBlock, style: Style, columns: number, texts: boolean) => {
  const box = style.tableStyle === "box";
  const gap = box ? 0 : style.tableStyle === "grid" ? 3 : 2;
  const sizingGap = box || style.tableStyle === "grid" ? 3 : 2;
  const { natural, words } = tableSize(block, cellText(style));
  const room = columnRoom(box, columns);
  const minimum = tableMinimums(natural, words);
  const spread = minimum.reduce((a, b) => a + b, sizingGap * Math.max(0, minimum.length - 1));
  if (
    natural.length > 0 &&
    !texts &&
    (style.tableLayout === "stacked" || (style.tableLayout === "auto" && spread > room))
  ) {
    return { stack: true, box, gap, natural, words, widths: [] as number[] };
  }
  const widths =
    style.tableLayout === "compact"
      ? columnWidths(natural, Math.min(room, spread), sizingGap, words)
      : columnWidths(natural, room, sizingGap, words);
  return { stack: false, box, gap, natural, words, widths };
};

const stackedPlan = (header: TableCell[], columns: number) => {
  const widest = header.reduce((a, cell) => Math.max(a, width(displayText(cell))), 0);
  const labelW = Math.min(Math.max(widest, 1), Math.max(1, Math.floor(columns / 3)));
  return { labelW, room: Math.max(1, columns - labelW - 1) };
};

const stackedHeight = (block: TableBlock, columns: number): number => {
  const { labelW, room } = stackedPlan(block.header, columns);
  const pair = (cells: TableCell[]) =>
    Math.max(
      1,
      ...block.header.map((hdr, c) =>
        Math.max(textRows(displayText(hdr), labelW), textRows(displayText(cells[c] ?? []), room)),
      ),
    );
  return Math.max(
    1,
    block.rows.reduce((sum, r) => sum + pair(r), Math.max(0, block.rows.length - 1)),
  );
};

const padTo = (runs: Inline[], w: number): Inline[] => [
  ...runs,
  { kind: "text", text: " ".repeat(Math.max(0, w - width(inlineText(runs)))) },
];

const stackedTable = (
  el: ElementTable,
  style: Style,
  block: TableBlock,
  columns: number,
  key: string,
  tip?: Tip,
): RenderElement => {
  const { Box, Text } = el;
  const t = style.theme;
  const { labelW, room } = stackedPlan(block.header, columns);
  const separators = style.tableStyle !== "minimal" && block.rows.length > 0;
  const label = (labels: Inline[][], i: number): RenderElement =>
    h(
      Text,
      { bold: true, color: t.tableHeader },
      labels[i] ? inlineText(padTo(labels[i], labelW)) : " ".repeat(labelW),
    );
  const separator = (i: number): RenderElement =>
    h(Text, { key: `${key}.s${i}`, color: t.tableRule, dimColor: !t.tableRule }, "─".repeat(columns));
  const pairLine = (labels: Inline[][], values: Inline[][], c: number, i: number, k: string): RenderElement =>
    h(
      Box,
      { key: `${k}.${c}.${i}`, flexDirection: "row" },
      label(labels, i),
      h(
        Text,
        null,
        " ",
        values[i]
          ? (pressInline(el, style, values[i], room, `${k}.${c}.v${i}`, tip) ??
              renderInline(el, style, values[i], `${k}.${c}.v${i}`))
          : "",
      ),
    );
  const record = (cells: TableCell[], i: number): RenderElement[] => {
    const k = `${key}.r${i}`;
    return block.header.flatMap((hdr, c) => {
      const labels = wrapInline(headerRuns(hdr), labelW);
      const values = wrapInline(cells[c] ?? [], room);
      return Array.from({ length: Math.max(1, Math.max(labels.length, values.length)) }, (_, l) =>
        pairLine(labels, values, c, l, k),
      );
    });
  };
  const lines: RenderElement[] = block.rows.flatMap((r, i) => [
    ...record(r, i),
    ...(separators && i < block.rows.length - 1 ? [separator(i)] : []),
  ]);
  return h(Box, { key: key, flexDirection: "column" }, lines);
};

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

const heavyBetween = (
  style: Style,
  buckets: (Bucket | undefined)[],
  group: Group | undefined,
  groupOption: GroupTable,
  i: number,
): boolean => statusHeavy(style.statusMatrix, buckets, i) || groupHeavy(groupOption, group, i);

const treeRuns = (
  tree: Tree | undefined,
  style: Style,
  group: Group | undefined,
): { option: GroupTable; runs: Group | undefined } => ({
  option: tree ? (style.treeTable === "full" ? "full" : "merge") : style.groupTable,
  runs: tree ? { column: 0, starts: tree.starts[0] ?? [], sizes: tree.sizes[0] ?? [] } : group,
});

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
  const shape = tableShape(block, style);
  const base = shape.base;
  const tree = shape.tree;
  const heat = shape.heat;
  const group = groupOf(base, tree ? "off" : style.groupTable, style.statusMatrix === "group");
  const { option: groupOption, runs } = treeRuns(tree, style, group);
  if (tablePlan(base, style, columns, textsOf(style, base)).stack)
    return stackedTable(el, style, base, columns, key, tip);
  const drawn = group ? { ...shape.block, rows: groupRows(shape.block, group, style.groupTable) } : shape.block;
  const texts = textsOf(style, drawn);
  const plan = tablePlan(drawn, style, columns, texts);
  if (plan.stack) return stackedTable(el, style, base, columns, key, tip);
  const shown = cellText(style);
  const status = statusOf(base, style.statusMatrix, false);
  const layout = statusRows(drawn, status, style.statusMatrix);
  const { natural, widths, box, gap } = plan;
  const test = testReport(el, t, base, style.testMatrix, `${key}.t`);
  const foot = test ? undefined : statusFooter(el, t, status, style.statusMatrix, `${key}.f`);
  const bench = benchOf(base, style.benchTable);
  const spark = benchSpark(el, t, base, bench, style.benchTable, `${key}.s`);
  const schema = schemaOf(base, style.schemaTable);
  const api = apiOf(base, style.apiTable);
  const compare = compareOf(base, style.compareTable);
  const kv = kvOf(base, style.kvTable);
  const rowAt = compare || kv || group || tree || heat ? new Map(drawn.rows.map((cells, r) => [cells, r])) : undefined;
  const look =
    (at: number | undefined) =>
    (c: number, cell: TableCell, plain: { color?: string } = {}) =>
      treeLook(
        t,
        tree,
        at,
        c,
        groupLook(
          t,
          group,
          at,
          c,
          statusLook(
            t,
            status,
            c,
            cell,
            benchLook(
              t,
              bench,
              c,
              cell,
              schemaLook(
                t,
                schema,
                c,
                cell,
                compareLook(
                  t,
                  compare,
                  at,
                  c,
                  cell,
                  apiLook(t, api, c, cell, kvLook(t, kv, at, c, cell, heatLook(t, heat, at, c, plain))),
                ),
              ),
            ),
          ),
        ),
      );
  const order = natural.map((_, c) => c);
  const mirror = rtl && mirrored(style);
  const flip = rtl && !mirror;
  const { opening, wall, held, marked } = tableEdges(style, base, rtl, mirror);
  if (flip) order.reverse();
  const lead = (k: string) => (opening ? h(Text, { key: `${k}.m`, color: t.rule }, opening) : null);
  const columnGap = held ? 0 : gap;
  const spacer = (k: string) => (held ? h(Text, { key: k }, LTR_BLANK + " ".repeat(gap - 1)) : null);
  const ruleChar = style.tableStyle === "grid" ? "━" : "─";
  const justify = (c: number) =>
    base.align[c] === "right" ? "flex-end" : base.align[c] === "center" ? "center" : "flex-start";

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
      const side = cell?.base === "R" && base.align[c] !== "center" ? "flex-end" : justify(c);
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

  const row = (cells: Inline[][], k: string, isHeader: boolean, border = bar, at?: number): RenderElement =>
    texts
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
              ? base.align[c] === "center"
                ? "center"
                : "flex-start"
              : cell?.base === "R" && base.align[c] !== "center"
                ? "flex-end"
                : justify(c);
            const runs = isHeader ? headerRuns(content) : content;
            const face = isHeader ? { bold: true, color: t.tableHeader } : look(at)(c, cells[c] ?? [], {});
            const numberFace = numberPaint(face, isHeader, t);
            const cellBox = h(
              Box,
              { key: `${k}.${c}`, width: w, flexShrink: 0, justifyContent: side },
              pressInline(el, style, runs, w, `${k}.${c}.p`, tip, face, { justifyContent: side }) ??
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
                    : h(Text, face, renderInline(el, style, content, `${k}.${c}`, numberFace))),
            );

            return [i > 0 && (box ? border(`${k}.${c}s`, wall(" │ ")) : spacer(`${k}.${c}g`)), cellBox];
          }),
          box && border(`${k}.r`, wall(" │")),
        );

  const wrappedRow = (cells: Inline[][], k: string, isHeader: boolean, at?: number): RenderElement[] => {
    if (!isHeader && cells.some(hasLink))
      return [
        row(cells, k, isHeader, clipped(Math.max(1, ...widths.map((w, c) => mostLines(shown(cells[c] ?? []), w)))), at),
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
        undefined,
        at,
      ),
    );
  };

  if (box) {
    const lines: (RenderElement | undefined)[] = [
      edge(`${key}.t`, "┌─┬┐"),
      ...wrappedRow(drawn.header, `${key}.h`, true),
      edge(`${key}.hr`, "╞═╪╡"),
    ];
    layout.rows.forEach((r, i) => {
      if (i > 0)
        lines.push(
          edge(
            `${key}.r${i}r`,
            groupEdge(
              groupOption,
              runs,
              i,
              statusEdge(style.statusMatrix, layout.buckets, i - 1, "├─┼┤", "╞═╪╡"),
              "╞═╪╡",
            ),
          ),
        );
      lines.push(...wrappedRow(r, `${key}.r${i}`, false, rowAt?.get(r)));
    });
    lines.push(edge(`${key}.b`, "└─┴┘"));
    return h(
      Box,
      _extends({ key: key, flexDirection: "column" }, flip ? { alignSelf: "flex-end" } : {}),
      lines,
      foot,
      test,
      spark,
    );
  }

  const body: (RenderElement | undefined)[] = [row(drawn.header, `${key}.h`, true), rule(`${key}.hr`, true)];
  layout.rows.forEach((r, i) => {
    body.push(row(r, `${key}.r${i}`, false, undefined, rowAt?.get(r)));
    if (style.tableStyle !== "minimal" && i < layout.rows.length - 1)
      body.push(rule(`${key}.r${i}r`, heavyBetween(style, layout.buckets, runs, groupOption, i)));
  });
  return h(
    Box,
    _extends({ key: key, flexDirection: "column" }, flip ? { alignSelf: "flex-end" } : {}),
    body,
    foot,
    test,
    spark,
  );
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
    copy && ((text, id, label, rich, hues) => copy(text, `${key}.${id}`, label, rich, hues)),
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
  const lines = heightOf(block.blocks, inner, style);
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
    const lines = 1 + (block.blocks.length ? 1 + heightOf(block.blocks, inner, style) : 0);
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

const listSide = (style: Style, block: BlockOf<"list">): Flow["base"] | undefined => {
  if (!style.reorder || !block.items.some((item) => containsRtl(item.inline))) return undefined;
  return mostlyRtl(
    style,
    block.items.map((item) => item.inline),
  )
    ? "R"
    : "L";
};

const leftItem = (
  el: ElementTable,
  style: Style,
  depth: number,
  lead: string,
  color: string | undefined,
  inline: Inline[],
  room: number,
  k: string,
  look: Look,
  tip?: Tip,
): RenderElement => {
  const { Box, Text } = el;
  return h(
    Box,
    { key: k, flexDirection: "row", paddingLeft: depth * 2 },
    h(Text, { color: color }, lead),
    pressInline(el, style, inline, room, `${k}.i`, tip, look) ?? h(Text, look, renderInline(el, style, inline, k)),
  );
};

const leadSide = (style: Style, block: Block, room: number): Flow["base"] | undefined =>
  block.kind === "list" ? listSide(style, block) : flowOf(style, leadInline([block]), room)?.base;

const heldItem = (
  el: ElementTable,
  style: Style,
  item: ListItem,
  glyph: string,
  color: string | undefined,
  room: number,
  k: string,
  look: Look,
): RenderElement => {
  const { Box, Text } = el;
  const lines: Inline[][] = mirrored(style)
    ? (flowOf(style, item.inline, room - 1, false) as Flow).lines.map((line) => [
        { kind: "text", text: LTR_BLANK },
        ...line,
      ])
    : (flowOf(style, item.inline, room) as Flow).lines;
  return h(
    Box,
    { key: k, flexDirection: "row", paddingLeft: item.depth * 2 },
    h(Text, { color: color }, mirrored(style) ? glyph : `${glyph} `),
    h(Box, { flexDirection: "column" }, renderFlow(el, style, lines, k, look)),
  );
};

const listRow = (
  el: ElementTable,
  style: Style,
  item: ListItem,
  glyph: string,
  glyphColor: string | undefined,
  side: Flow["base"] | undefined,
  room: number,
  k: string,
  look: Look,
  tip?: Tip,
): RenderElement => {
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

const TASK_GLYPHS: Record<Style["taskStyle"], [string, string]> = {
  checks: ["[ ]", "[✓]"],
  ticks: ["○", "✓"],
  box: ["□", "✓"],
  progress: ["○", "✓"],
};

const renderList = (
  el: ElementTable,
  style: Style,
  block: BlockOf<"list">,
  columns: number,
  key: string,
  copy?: CopyButton,
  fold?: Fold,
  tip?: Tip,
): RenderElement => {
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
    block.items.map((full, i) => {
      const item = { ...full, depth: Math.min(full.depth, Math.floor(columns / 4)) };
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

const instanceKey = (id: string): string => {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

const noteTip = (blocks: Block[], toast: (text: string) => void): Tip | undefined => {
  const notes = blocks.find((block) => block.kind === "notes");
  if (notes?.kind !== "notes") return undefined;
  const text = new Map(
    notes.notes.map((note): [number, string] => [note.note, `${note.mark} ${inlineText(note.inline)}`]),
  );
  return (note) => {
    const line = text.get(note);
    return line === undefined ? undefined : () => toast(line);
  };
};

const NUMBER_AT = 10;
const NUMBER_MAX = 400;
const CODE_MAX = 400;
const FOLD_AT = 30;
const FOLD_SHOW = 20;

const codeRest = ({ Text }: ElementTable, total: number, shown: number, key: string): RenderElement[] =>
  shown === CODE_MAX && total > shown
    ? [h(Text, { key: `${key}.rest`, dimColor: true }, `… +${total - shown} lines`)]
    : [];

const codeId = (lines: string[]): string => {
  let h = 5381;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) h = (h * 33 + line.charCodeAt(i)) | 0;
    h = (h * 33 + 10) | 0;
  }
  return `${lines.length}:${(h >>> 0).toString(36)}`;
};

const unquoted = (block: BlockOf<"quote" | "alert">): string[] => {
  const lines = block.raw.split("\n").map((line) => line.replace(/^\s*>\s?/, ""));
  return block.kind === "alert" ? lines.filter((line, i) => i > 0 || !/^\s*\[![A-Za-z]+\]\s*$/.test(line)) : lines;
};

const copySource = (style: Style, block: Block): string | undefined =>
  block.kind === "code"
    ? block.lines.join("\n")
    : block.kind === "table"
      ? block.raw
      : style.inside
        ? undefined
        : block.kind === "list"
          ? block.raw
          : block.kind === "quote" || block.kind === "alert"
            ? unquoted(block).join("\n")
            : undefined;

const drawMath = (el: ElementTable, style: Style, blocks: Block[], drawn: Drawn = new Map()): Drawn => {
  for (const [i, block] of blocks.entries()) {
    const tex = drawn.has(i) ? null : mathOf(block);
    const text = tex === null || !texParses(tex) ? null : texText(tex);
    if (!text || text.includes("\\")) continue;
    const look = { italic: true, color: style.theme.emphasis };
    const rtl = flowOf(style, [{ kind: "text", text }], Infinity);
    drawn.set(i, {
      element: h(
        el.Box,
        { key: `b${i}`, paddingLeft: 2 },
        rtl ? renderFlow(el, style, rtl.lines, `b${i}.m`, look) : h(el.Text, look, text),
      ),
    });
  }
  return drawn;
};

const opensWithCopy = (block: Block): boolean =>
  block.kind === "quote" &&
  (block.blocks[0]?.kind === "code" ||
    block.blocks[0]?.kind === "table" ||
    (block.blocks[0] !== undefined && opensWithCopy(block.blocks[0])));

const holdsOnlyEmptyCode = (block: Block): boolean =>
  block.kind === "quote" &&
  block.blocks.length === 1 &&
  ((block.blocks[0].kind === "code" && block.blocks[0].lines.length === 0) || holdsOnlyEmptyCode(block.blocks[0]));

const MARK = 2;

const markerRoom = (style: Style): number => (style.copyButtons && style.copyButtonStyle === "hover" ? MARK : 0);

const codeLabel = (block: BlockOf<"code">): string => `── ${block.lang || "code"}`;

const buttonText = (button: RenderElement | null | undefined): string | undefined =>
  button?.type === "Button"
    ? `[ ${button.props.label} ]`
    : button?.type === "Text"
      ? (button.children ?? []).filter((c) => typeof c === "string").join("")
      : undefined;

const keyOf = (button: RenderElement): string => String(("props" in button ? button.props?.key : undefined) ?? "");

const markedRow = (
  { Box }: ElementTable,
  key: string,
  element: RenderElement,
  float: Floating,
  start: boolean,
): RenderElement =>
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

const renderBlocks = (
  el: ElementTable,
  style: Style,
  blocks: Block[],
  columns: number,
  drawn: Drawn = new Map(),
  copy?: CopyButton,
  fold?: Fold,
  tip?: Tip,
  picture?: PictureButtons,
): RenderElement[] => {
  const { Box, Text } = el;
  const t = style.theme;
  const hover = style.copyButtonStyle === "hover";
  const reserved = (buttons: RenderElement[]) =>
    buttons.reduce((w, button) => {
      const shown = buttonText(button);
      return shown === undefined ? w : w + (w ? 1 : 0) + width(shown);
    }, 0);
  const fitted = (parts: (RenderElement | null | undefined)[]): RenderElement[] => {
    const kept: RenderElement[] = [];
    for (const part of parts) {
      if (part && (!kept.length || reserved([...kept, part]) <= columns)) kept.push(part);
    }
    return kept;
  };
  const scopeOf = (button: RenderElement) => `copy:${style.noteKey ?? ""}:${keyOf(button)}`;
  const floating = (kept: RenderElement[], low = false, start = false): Floating => {
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
  const buttons = blocks.map((block, b): CopyRow => {
    const text = hover && holdsOnlyEmptyCode(block) ? undefined : copySource(style, block);
    const isPlainCode = block.kind === "code" && !drawn.get(b)?.element;
    const bitmap = drawn.get(b)?.png;
    const { art, grid, hues } = bitmap === undefined ? artsOf(drawn.get(b), block, style.theme, rtlTables[b]) : {};
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
      block.kind === "table" && bitmap === undefined
        ? copy?.(
            () => tableText(block),
            `html${b}`,
            "⧉ html",
            () => tableHtml(block, rtlTables[b]),
          )
        : null,
      grid !== undefined ? copy?.(grid, `png${b}`, "▣ png", "png", hues) : null,
      ...(bitmap === undefined ? [] : (picture?.(bitmap, b) ?? [])),
    ].filter(Boolean);
    return { first, more };
  });
  const codeHead = (label: string, button: RenderElement | null) => {
    if (!hover || !button) return null;
    const float = floating([button]);
    return { ...float, minWidth: Math.min(columns, width(label) + 1 + float.needs) };
  };
  const room = (b: number) => (hover && buttons[b].first ? columns - MARK : columns);
  const beside = (b: number) =>
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
        const lines = figureFallbackLines(block);
        const toggle = lines.length > FOLD_AT ? fold?.(codeId(lines), lines.length - FOLD_SHOW, `fold${b}`) : null;
        const shownCount = toggle?.folded ? FOLD_SHOW : Math.min(lines.length, CODE_MAX);
        const numbered = lines.length >= NUMBER_AT && lines.length <= NUMBER_MAX;
        const room = columns - 2 - gutterOf(lines, numbered);
        const gutter = numbered ? String(lines.length).length : 0;
        const held = mirrored(style) && lines.some((line) => hasRtl(line) && (!opensLatin(line) || width(line) > room));
        const rows = [
          ...(held
            ? heldCode(el, style, lines, shownCount, block.lang, gutter, room, key, block.isOpen)
            : codeRows(el, style, lines, shownCount, block.lang, numbered, room, key, block.isOpen, block.links)),
          ...codeRest(el, lines.length, shownCount, key),
        ];
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
  }) as RenderElement[];
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
  const cut = budgetCut(copied);
  const isFigure = (b: number) => b < cut && (blocks[b]?.kind === "table" || drawn.get(b)?.art !== undefined);
  const out: RenderElement[] = [];
  for (let b = 0; b < cut; b++) {
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
  return [...out, ...restSource(el, blocks.slice(cut), REST_ROOM - textIn(out))];
};

const NODE_BUDGET = 19800;

const nodesIn = (n: unknown): number => {
  if (Array.isArray(n)) return n.reduce<number>((sum, c) => sum + nodesIn(c), 0);
  if (n !== null && typeof n === "object") return 1 + ("children" in n ? nodesIn(n.children) : 0);
  return typeof n === "string" ? 1 : 0;
};

const REST_ROOM = 59000;

const TEXT_BUDGET = 90000;

const textIn = (n: unknown): number => {
  if (Array.isArray(n)) return n.reduce<number>((sum, c) => sum + textIn(c), 0);
  if (typeof n === "string") return n.length;
  return n !== null && typeof n === "object" && "children" in n ? textIn(n.children) : 0;
};

const budgetCut = (elements: RenderElement[]): number => {
  let left = NODE_BUDGET;
  let room = TEXT_BUDGET;
  const cut = elements.findIndex((element) => {
    left -= nodesIn(element);
    room -= textIn(element);
    return left < 0 || room < 0;
  });
  return cut < 0 ? elements.length : cut;
};

const REST_CHUNK = 8000;

const chunks = (text: string): string[] =>
  text.split("\n").reduce<string[]>((out, line) => {
    for (let at = 0; at < Math.max(line.length, 1); at += REST_CHUNK) {
      const piece = line.slice(at, at + REST_CHUNK);
      const last = out.length - 1;
      if (at === 0 && last >= 0 && out[last].length + piece.length + 1 <= REST_CHUNK) out[last] += `\n${piece}`;
      else out.push(piece);
    }
    return out;
  }, []);

const restSource = ({ Text }: ElementTable, rest: Block[], room: number): RenderElement[] => {
  if (!rest.length) return [];
  let left = room;
  const lines = rest
    .map((block) => block.raw)
    .join("\n\n")
    .split("\n");
  const fit = lines.findIndex((line) => {
    left -= line.length + 1;
    return left < 0;
  });
  const kept = fit < 0 ? lines : lines.slice(0, fit);
  const text = kept.length
    ? chunks(kept.join("\n").trimEnd()).map((chunk, i) => h(Text, { key: `rest${i}`, dimColor: true }, chunk))
    : [];
  return fit < 0 ? text : [...text, h(Text, { key: "restMore", dimColor: true }, `… +${lines.length - fit} lines`)];
};

const formatDuration = (ms: number): string => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${Math.max(s, 0)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

const renderTurnDuration = ({ Text }: ElementTable, style: Style, word: string, durationMs: number): RenderElement =>
  h(
    Text,
    { color: style.theme.codeComment },
    `✻ ${word} for `,
    h(Text, { color: style.theme.number }, formatDuration(durationMs)),
  );

const boxedPrompt = (style: Style): boolean => style.promptStyle === "bubble" || style.promptStyle === "wide";

const widePrompt = (style: Style, hebrew: boolean): boolean =>
  style.promptStyle === "wide" || (hebrew && mirrored(style));

const promptMark = (el: ElementTable, style: Style, rtl: boolean, tall: number): RenderElement => {
  const glyph = style.promptStyle === "bar" ? (rtl ? " ▐" : "▌ ") : rtl ? " ‹" : "› ";
  return style.promptStyle === "bar" && tall > 1
    ? quoteBar(el, glyph, style.theme.accent, tall)
    : h(el.Text, { color: style.theme.accent, bold: true }, glyph);
};

const renderUserPrompt = (el: ElementTable, style: Style, typed: string, columns: number): RenderElement => {
  const { Box, Text } = el;
  const t = style.theme;
  const color = style.promptStyle === "chevron" ? t.accent : t.heading;
  const rows = typed.split("\n");
  const marked = rows.map((line) => hyperlinks(parseInline(line, { numbers: false, paths: false }), style));
  const lines = rows.map((_, i) => flowOf(style, marked[i], columns - 4));
  const hebrew = lines.some((l) => l?.base === "R");
  const rtl = hebrew && !mirrored(style);
  const body = h(
    Box,
    _extends({ flexDirection: "column" }, rtl ? { alignItems: "flex-end" } : {}),
    rows.map((_, i) => {
      const flow = lines[i];
      return flow
        ? renderFlow(el, style, flow.lines, `p${i}`, { color, bold: style.promptStyle === "chevron" })
        : h(
            Text,
            { key: `p${i}`, color: color, bold: style.promptStyle === "chevron" },
            marked[i].every((n) => n.kind === "text")
              ? inlineText(marked[i]) || " "
              : renderInline(el, style, marked[i], `p${i}`),
          );
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
  const room = columns - 2;
  const tall = marked.reduce((sum, nodes) => sum + textRows(inlineText(nodes), room), 0);
  const mark = promptMark(el, style, rtl, tall);
  return h(
    Box,
    _extends({ flexDirection: "row", alignItems: "stretch" }, rtl ? { justifyContent: "flex-end" } : {}),
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
  type Span,
  width,
  wrapRanges,
};
