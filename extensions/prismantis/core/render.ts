import { Fragment, h } from "./jsx.ts";
import type { ElementTable, RenderElement, RenderNode, TextHoverProps } from "./jsx.ts"
import { tableHtml, tableText } from "./html.ts"
import type { Block, Inline } from "./markdown.ts"
import { mathOf } from "./latex.ts"
import { CONTROL, displayText, inlineText, isWebLink, nestedBlocks, texText } from "./markdown.ts"
import type { Flow } from "./rtl.ts"
import { LTR_BLANK, ROW_MARK, ROW_MARK_TEXT, WALL, codeVisual, commentTail, commentVisual, containsRtl, flow, hasRtl, heldCell, listMarker, opensLatin, terminalLine } from "./rtl.ts"
import type { Style, Theme } from "./theme.ts"
import type { PrismToken } from "./vendor/prism.js"
import { languages, tokenize } from "./vendor/prism.js"
export type TerminalEnv = Partial<Record<'FORCE_HYPERLINK' | 'TERM_PROGRAM' | 'TERM_PROGRAM_VERSION' | 'TERM' | 'WT_SESSION' | 'LC_TERMINAL' | 'VTE_VERSION' | 'TERMINAL_EMULATOR', string>>
export type CopyButton = (text: string | (() => string), key: string, label?: string, html?: () => string) => RenderElement | null
export type Drawn = Map<number, { element?: RenderElement; art?: string; note?: string }>
export type FoldLook = { label?: string; face?: (folded: boolean) => RenderElement }
export type Fold = (id: string, hidden: number, key: string, look?: FoldLook) => { folded: boolean; element: RenderElement; faced: boolean; around?: (rows: RenderElement, hover: TextHoverProps) => RenderElement } | null
export type Tip = (note: number) => (() => void) | undefined
export type ToolRow = { tool: string; input: unknown; isRunning: boolean; isErrored: boolean; isInterrupted: boolean }
export type FileChange = { kind: 'modified'; path: string; rows: DiffLine[] } | WholeFile | { kind: 'renamed'; path: string; to: string }
export type BashEdits = { files: FileChange[]; more: number; shared: boolean }
export type DrawPaste = (body: string, key: string) => RenderElement
function _extends() {return _extends = Object.assign ? Object.assign.bind() : function (n) {for (var e = 1; e < arguments.length; e++) {var t = arguments[e];for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]);}return n;}, _extends.apply(null, arguments);}











const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}\u20E3]|\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/u;
const segmenter = new Intl.Segmenter();

const graphemes = (s) => [...segmenter.segment(s)].map((g) => g.segment);

const cells = (s) => /^[ -~]*$/.test(s) ? [...s] : graphemes(s).flatMap((g) => WIDE.test(g) ? [g, ''] : [g]);

const ZERO = /^[\p{M}\p{Default_Ignorable_Code_Point}]+$/u;

const width = (s) =>
/^[ -~]*$/.test(s) ? s.length :
s.length === 1 ? ZERO.test(s) ? 0 : WIDE.test(s) ? 2 : 1 :
graphemes(s).reduce((w, g) => ZERO.test(g) ? w : w + (WIDE.test(g) ? 2 : 1), 0);

const widestLine = (text) => Math.max(...text.split('\n').map(width));

const wrapRanges = (text, w) => {
  const br = text.indexOf('\n');
  if (br >= 0) return [...wrapRanges(text.slice(0, br), w), ...wrapRanges(text.slice(br + 1), w).map(([a, b]) => [a + br + 1, b + br + 1])];
  if (width(text) <= w) return [[0, text.length]];
  const out = [];
  let line;
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

const sliceInline = (nodes, from, to) => {
  const out = [];
  let at = 0;
  for (const n of nodes) {
    const length = inlineText([n]).length;
    const a = Math.max(from - at, 0);
    const b = Math.min(to - at, length);
    at += length;
    if (a >= b) continue;
    if ('children' in n) out.push({ ...n, children: sliceInline(n.children, a, b) });else
    out.push({ ...n, text: n.text.slice(a, b) });
  }
  return out;
};

const hasLink = (nodes) => nodes.some((n) => n.kind === 'link' || 'children' in n && hasLink(n.children));

const headerRuns = (nodes) =>
nodes.flatMap((n) => n.kind === 'footnote' ? [n] : 'children' in n ? headerRuns(n.children) : [{ kind: 'text', text: n.text }]).
reduce((out, n) => {
  const last = out[out.length - 1];
  return n.kind === 'text' && last?.kind === 'text' ? [...out.slice(0, -1), { kind: 'text', text: last.text + n.text }] : [...out, n];
}, []);

const HTTP_LINKS_FROM = [2, 1, 289];
const EDITOR_LINKS_FROM = [2, 1, 294];
const CLICKABLE_MARKS_FROM = [2, 1, 295];

const releaseFrom = (from) => (base) => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(base ?? '');
  if (!m) return false;
  const version = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = version.findIndex((n, i) => n !== from[i]);
  return at === -1 || version[at] > from[at];
};

const takesHttpLinks = releaseFrom(HTTP_LINKS_FROM);

const takesEditorLinks = releaseFrom(EDITOR_LINKS_FROM);

const takesClickableMarks = releaseFrom(CLICKABLE_MARKS_FROM);

const fileRoot = (distro) => distro ? `file://wsl.localhost/${encodeURIComponent(distro)}` : 'file://';



const HYPERLINK_TERMINALS = ['ghostty', 'Hyper', 'kitty', 'alacritty', 'iTerm.app', 'iTerm2', 'WarpTerminal', 'Orca'];

const versionOf = (value = '') => {
  const short = /^(\d{1,2})(\d{2})$/.exec(value);
  return short ? [0, Number(short[1])] : value.split('.').map((n) => Number.parseInt(n, 10));
};

const atLeast = (value, major, minor) => {
  const [a = Number.NaN, b = Number.NaN] = versionOf(value);
  return a > major || a === major && b >= minor;
};

const programLinks = (program, version) =>
HYPERLINK_TERMINALS.includes(program) ||
program === 'WezTerm' && atLeast(version, 20200620, 0) ||
program === 'vscode' && atLeast(version, 1, 72) ||
program === 'tmux' && atLeast(version, 3, 4);

const drawsHyperlinks = (env) => {
  if (env.FORCE_HYPERLINK) return Number.parseInt(env.FORCE_HYPERLINK, 10) !== 0;
  const term = env.TERM ?? '';
  const vte = env.VTE_VERSION;
  return env.WT_SESSION !== undefined ||
  programLinks(env.TERM_PROGRAM ?? '', env.TERM_PROGRAM_VERSION) ||
  HYPERLINK_TERMINALS.includes(env.LC_TERMINAL ?? '') ||
  vte !== undefined && vte !== '0.50.0' && atLeast(vte, 0, 50) ||
  term === 'alacritty' || term.includes('kitty') ||
  env.TERMINAL_EMULATOR === 'JetBrains-JediTerm';
};



const LAUNCHERS = new Set([
'app', 'command', 'tool', 'terminal', 'pkg', 'mpkg', 'mobileconfig', 'prefpane', 'workflow', 'action', 'fileloc', 'inetloc', 'webloc',
'exe', 'com', 'scr', 'pif', 'cpl', 'msi', 'msp', 'msu', 'msix', 'msixbundle', 'appx', 'appxbundle', 'appinstaller', 'application', 'appref-ms', 'vsix',
'bat', 'cmd', 'ps1', 'psc1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'wsc', 'hta', 'chm', 'msc', 'reg', 'xll', 'wsb', 'diagcab', 'ahk', 'au3',
'lnk', 'url', 'scf', 'settingcontent-ms',
'desktop', 'sh', 'bash', 'zsh', 'csh', 'ksh', 'run', 'appimage', 'deb', 'rpm', 'snap', 'flatpak', 'flatpakref',
'jar', 'jnlp', 'py', 'pyw', 'pyz', 'pyzw', 'pyc', 'pl', 'rb', 'rbw']
);

const unescaped = (text) => text.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));

const extensionOf = (name) => /\.([^.]*)$/.exec(name.replace(/[. ]+$/, ''))?.[1] ?? '';

const launches = (href) => {
  const path = unescaped(href.replace(/[?#].*$/, '')).toLowerCase().replace(/[/\\]+$/, '');
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  return /\.app[/\\]/.test(path) || name.split(/[:\u0000-\u001f]/).some((part) => LAUNCHERS.has(extensionOf(part)));
};

const isHyperlink = (href, reach) =>
(reach.httpLinks ? /^https?:/i : /^(https:|http:\/\/localhost(:\d+)?([/?#]|$))/i).test(href) ||
reach.editorLinks && /^vscode(-insiders)?:\/\/file\//i.test(href) ||
reach.fileLinks !== null && /^file:/i.test(href) && !launches(href);

const plainLink = (text, href) => {
  const target = href.replace(/^mailto:/i, '');
  return text === target || `http://${text}` === target ? target : `${text} (${target})`;
};

const LINK_MAX = 2048;

const utf8Bytes = (cp) => cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;

const encodedLength = (href) =>
[...href].reduce((length, ch) => {
  const cp = ch.codePointAt(0);
  return length + (cp > 0x20 && cp < 0x7f ? 1 : 3 * utf8Bytes(cp));
}, 0);

const fileHref = (root, href) => {
  const local = /^file:(?:\/\/(?:localhost)?)?(\/(?![a-z]:|\/)[^?#]*)(.*)$/i.exec(href);
  return local && root !== 'file://' ? `${root}${local[1]}${local[2]}` : href;
};

const absolutePath = (reach, path) => {
  const base = path.startsWith('~') ? reach.home : path.startsWith('.') ? reach.cwd : '/';
  if (!base) return undefined;
  const parts = [];
  for (const part of `${slashes(base)}/${path.replace(/^~/, '').replace(/(?<=[^/.])\.+$/, '')}`.split('/')) {
    if (part === '..') parts.pop();else
    if (part !== '.' && part !== '') parts.push(part);
  }
  return `/${parts.join('/')}${path.endsWith('/') ? '/' : ''}`;
};

const pathHref = (reach, path) => {
  const target = absolutePath(reach, path);
  if (target === undefined || reach.fileLinks === null) return undefined;
  const href = `${reach.fileLinks}${encodeURI(target).replace(/[?#]/g, encodeURIComponent)}`;
  return href.length <= LINK_MAX && !launches(href) ? href : undefined;
};

const toolHref = (reach, path) => {
  if (!reach.pathLinks || reach.fileLinks === null) return undefined;
  const forward = path.replace(/\\/g, '/');
  if (/^[a-z]:\//i.test(forward)) return pathHref({ ...reach, fileLinks: 'file://' }, forward);
  if (!forward.startsWith('//')) return pathHref(reach, /^[/~.]/.test(forward) ? forward : `./${forward}`);
  const href = `file:${encodeURI(forward).replace(/[?#]/g, encodeURIComponent)}`;
  return href.length <= LINK_MAX && !launches(href) ? href : undefined;
};



const pieceText = (pieces) => pieces.map((p) => p.text).join('');

const drawPieces = (el, style, pieces) => {
  const hrefs = pieces.map((p) => p.path === undefined ? undefined : toolHref(style, p.path));
  return hrefs.some(Boolean) ? pieces.map((p, i) => {const href = hrefs[i];return href ? h(el.Link, { key: `p${i}`, href: href, label: p.text }) : p.text;}) : pieceText(pieces);
};

const decoded = (text) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
};

const linkPath = (root, href) => {
  const local = root !== 'file://' && href.startsWith(`${root}/`) ? href.slice(root.length) : href.replace(/^file:(\/\/(localhost)?(?=\/))?/i, '');
  return decoded(local.replace(/[?#].*$/, ''));
};

const labelPath = (reach, root, label) => {
  if (/^file:/i.test(label)) return linkPath(root, fileHref(root, label));
  if (/^([a-z]:[\\/]|\\\\)/i.test(label)) return label.replace(/\\/g, '/').replace(/^(?=[a-z]:)/i, '/');
  if (label.startsWith('/')) return label;
  return /^(~|\.{1,2})\//.test(label) ? absolutePath(reach, label) : undefined;
};

const withoutSlash = (path) => path?.replace(/(?<=.)\/+$/, '');

const hidesFile = (reach, n, href) => {
  const label = n.text.trim().replace(/[.,;:!?]+$/, '');
  if (!/^file:/i.test(n.href) || label === n.href) return false;
  const root = reach.fileLinks ?? 'file://';
  const shown = withoutSlash(labelPath(reach, root, label));
  return shown === undefined || shown !== withoutSlash(linkPath(root, href));
};

const drawnLink = (n, reach) => {
  const href = reach.fileLinks !== null && /^file:/i.test(n.href) ? fileHref(reach.fileLinks, n.href) : n.href;
  if (!isHyperlink(n.href, reach) || encodedLength(href) > LINK_MAX || hidesFile(reach, n, href)) return { kind: 'text', text: plainLink(n.text, n.href) };
  return href === n.href ? n : { ...n, href };
};

const linksAsPath = (path) => !path.startsWith('/') || /^\/[^/]+\/+[^/]/.test(path.replace(/\.+$/, ''));

const drawnPath = (n, reach) => {
  const href = reach.pathLinks && linksAsPath(n.text) ? pathHref(reach, n.text) : undefined;
  return href === undefined ? n : { ...n, href };
};

const PART = String.raw`[\p{L}\p{N}_@+-]+`;
const NAME = String.raw`\.?${PART}(?:\.${PART})*`;
const LOOSE_PATH = new RegExp(String.raw`(?<![\p{L}\p{N}_/\\.:~@+-])(?:[A-Za-z]:[\\/](?:${NAME}[\\/])*(?:${NAME})?|${NAME}(?:\/${NAME})*\/(?:${NAME})?|${PART}(?:\.${PART})+)(?![\p{L}\p{N}_/\\@+-]|\.[\p{L}\p{N}])`, 'gu');



const looseProbe = (reach, spelling) => {
  const drive = /^[a-z]:[\\/]/i.test(spelling);
  if (!drive && !reach.cwd) return undefined;
  const href = toolHref(reach, spelling);
  const key = drive ? spelling.replace(/\\/g, '/') : `${slashes(reach.cwd)}/${spelling}`;
  return href === undefined ? undefined : { key: key.replace(/(?<=[^/:])\/+$/, ''), href };
};

const looseSpellings = (text) => [...text.matchAll(LOOSE_PATH)];

const foundProbe = (reach, spelling) => {
  const probe = looseProbe(reach, spelling);
  return probe && reach.found?.has(probe.key) ? probe : undefined;
};

const loosePaths = (n, reach) => {
  const out = [];
  let at = 0;
  for (const m of looseSpellings(n.text)) {
    const probe = foundProbe(reach, m[0]);
    if (!probe) continue;
    if (m.index > at) out.push({ kind: 'text', text: n.text.slice(at, m.index) });
    out.push({ kind: 'path', text: m[0], href: probe.href });
    at = m.index + m[0].length;
  }
  if (at === 0) return [n];
  if (at < n.text.length) out.push({ kind: 'text', text: n.text.slice(at) });
  return out;
};

const looseCode = (n, reach) => {
  const probe = isWholePath(n.text) ? foundProbe(reach, n.text) : undefined;
  return probe ? { ...n, href: probe.href } : n;
};

const isWholePath = (text) => looseSpellings(text).some((m) => m[0] === text);

const looseNode = (n, reach) => {
  if (n.kind === 'text') return loosePaths(n, reach);
  return n.kind === 'code' ? looseCode(n, reach) : n;
};

const linked = (node, reach) => {
  const n = node.kind === 'image' && isWebLink(node.src) ? { kind: 'link', text: node.text, href: node.src } : node;
  if (n.kind === 'link') return drawnLink(n, reach);
  if (n.kind === 'path') return drawnPath(n, reach);
  return 'children' in n ? { ...n, children: hyperlinks(n.children, reach) } : n;
};

const hyperlinks = (nodes, reach) =>
reach.found?.size ? nodes.flatMap((node) => looseNode(linked(node, reach), reach)) : nodes.map((node) => linked(node, reach));

const spellingsIn = (nodes) =>
nodes.flatMap((n) => {
  if ('children' in n) return spellingsIn(n.children);
  if (n.kind === 'code') return isWholePath(n.text) ? [n.text] : [];
  return n.kind === 'text' ? looseSpellings(n.text).map((m) => m[0]) : [];
});

const inlinesOf = (block) => {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
      return [block.inline];
    case 'list':
      return block.items.map((item) => item.inline);
    case 'table':
      return [...block.header, ...block.rows.flat()];
    case 'notes':
      return block.notes.map((note) => note.inline);
    default:
      return [];
  }
};

const spelled = new WeakMap();

const pathsToProbe = (blocks, reach) => {
  if (!reach.pathLinks || reach.fileLinks === null) return [];
  return nestedBlocks(blocks).flatMap((block) => {
    const spellings = spelled.get(block) ?? inlinesOf(block).flatMap(spellingsIn);
    spelled.set(block, spellings);
    return spellings.flatMap((spelling) => looseProbe(reach, spelling)?.key ?? []);
  });
};

const hyperlinkBlock = (block, reach) => {
  const drawn = (nodes) => hyperlinks(nodes, reach);
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
      return { ...block, inline: drawn(block.inline) };
    case 'list':
      return { ...block, items: block.items.map((item) => ({ ...item, inline: drawn(item.inline) })) };
    case 'table':
      return { ...block, header: block.header.map(drawn), rows: block.rows.map((r) => r.map(drawn)) };
    case 'notes':
      return { ...block, notes: block.notes.map((note) => ({ ...note, inline: drawn(note.inline) })) };
    default:
      return block;
  }
};

const hyperlinked = new WeakMap();

const drawable = (block, reach) => {
  const cached = hyperlinked.get(block) ?? {};
  hyperlinked.set(block, cached);
  const key = `${+reach.httpLinks}${+reach.editorLinks}${reach.fileLinks ?? ''}${reach.pathLinks ? `\0${reach.home}\0${reach.cwd}\0${reach.found?.size ?? 0}` : ''}`;
  return cached[key] ??= hyperlinkBlock(block, reach);
};

const mostLines = (text, w) => (text.match(/\S+/g)?.length ?? 0) + Math.ceil(width(text) / w);

const textRows = (text, w) =>
text.split('\n').reduce((sum, line) => sum + (width(line) <= w ? 1 : mostLines(line, Math.max(1, w))), 0);

const heightOf = (blocks, w) => blocks.reduce((sum, block, b) => sum + (b ? 1 : 0) + blockHeight(block, w), 0);

const blockHeight = (block, w) => {
  switch (block.kind) {
    case 'heading':
      return 2 * textRows(displayText(block.inline), w - 4) + 2;
    case 'paragraph':
      return textRows(displayText(block.inline), w);
    case 'list':
      return block.items.reduce((sum, item) => {
        const pad = item.depth * 2 + item.marker.length + 4;
        return sum + textRows(displayText(item.inline), w - pad) + (item.blocks ? heightOf(item.blocks, w - pad) + 1 : 0);
      }, textRows(`${'━'.repeat(20)} ${block.items.length}/${block.items.length} done`, w));
    case 'code':
      return block.lines.reduce((sum, line) => sum + textRows(line, w - 8), 3);
    case 'table':{
        const { natural, words } = tableSize(block);
        const widths = columnWidths(natural, w - 4, 3, words);
        const tallest = (cells) => Math.max(1, ...widths.map((cw, c) => textRows(displayText(cells[c] ?? []), cw)));
        return block.rows.reduce((sum, row) => sum + 1 + tallest(row), 4 + tallest(block.header));
      }
    case 'quote':
      return Math.max(1, heightOf(block.blocks, w - 2));
    case 'alert':
      return 3 + heightOf(block.blocks, w - 4);
    case 'rule':
      return 1;
    case 'notes':
      return block.notes.reduce((sum, note) => sum + textRows(`${note.mark} ${displayText(note.inline)}`, w), 1);
  }
};

const wrapInline = (nodes, w) => {
  const text = inlineText(nodes);
  return width(text) <= w && !text.includes('\n') ? [nodes] : wrapRanges(text, w).map(([a, b]) => sliceInline(nodes, a, b));
};

const mirrored = (style) => style.shape === 'mirror';

const heldLtr = (style) => style.shape === 'engine' ? { dir: 'ltr' } : {};

const heldLabel = (style, label, text) => mirrored(style) && hasRtl(text) ? label.replace(/ $/, LTR_BLANK) : label;

const flows = new Map();
const flowOf = (style, nodes, columns, mark = !(style.inside && mirrored(style))) =>
style.reorder && containsRtl(nodes) ? remember(flows, `${style.shape}\0${mark}\0${columns}\0${JSON.stringify(nodes)}`, () => flow(nodes, columns, width, style.shape, mark), 2000) : null;

const cellFlow = (style, nodes, held, mark) =>
held && style.reorder && containsRtl(nodes) ? remember(flows, `held\0${JSON.stringify(nodes)}`, () => heldCell(nodes), 2000) : flowOf(style, nodes, Infinity, mark);

const noteHover = (style, note) =>
note === undefined || style.noteKey === undefined ? {} : { hover: { scope: `fn:${style.noteKey}:${note}`, inverse: true } };

const renderInline = (el, style, nodes, keyBase) => {
  const { Text } = el;
  const t = style.theme;
  return nodes.map((n, i) => {
    const key = `${keyBase}.${i}`;
    switch (n.kind) {
      case 'text':
        return h(Text, { key: key }, n.text);
      case 'strong':
        return h(Text, { key: key, bold: true, color: t.strong }, renderInline(el, style, n.children, key));
      case 'emphasis':
        return h(Text, { key: key, italic: true, color: t.emphasis }, renderInline(el, style, n.children, key));
      case 'strike':
        return h(Text, { key: key, strikethrough: true, dimColor: true }, renderInline(el, style, n.children, key));
      case 'code':
        return h(Text, { key: key, color: t.inlineCode }, n.href === undefined ? n.text : h(el.Link, { href: n.href, label: n.text }));
      case 'math':
        return h(Text, { key: key, italic: true, color: t.emphasis }, n.text);
      case 'link':
        return n.text === n.href ? h(Text, { key: key, color: t.link }, h(el.Link, { href: n.href })) : h(el.Link, { key: key, href: n.href }, h(Text, { color: t.link }, n.text));
      case 'image':
        return h(Text, { key: key, color: t.link }, n.text);
      case 'number':
        return h(Text, { key: key, color: t.number }, n.text);
      case 'path':
        return h(Text, { key: key, color: t.path }, n.href === undefined ? n.text : h(el.Link, { href: n.href, label: n.text }));
      case 'dim':
        return n === ROW_MARK ? h(Text, { key: key, color: t.rule }, n.text) : h(Text, { key: key, dimColor: true }, n.text);
      case 'footnote':
        return h(Text, _extends({ key: key, color: t.accent }, noteHover(style, n.note)), n.text);
    }
  });
};

const renderFlow = (el, style, lines, key, props = {}) => {
  const { Text } = el;
  return lines.map((line, i) => h(Text, _extends({ key: `${key}.${i}` }, props), renderInline(el, style, line, `${key}.${i}`)));
};




const marksIn = (nodes, at = 0) => {
  const out = [];
  for (const n of nodes) {
    const length = inlineText([n]).length;
    if (n.kind === 'footnote' && n.note !== undefined) out.push({ start: at, end: at + length, text: n.text, note: n.note });else
    if ('children' in n) out.push(...marksIn(n.children, at));
    at += length;
  }
  return out;
};

const piecesOf = (text, a, b, columns, marks) => {
  if (width(text.slice(a, b)) <= columns) return [[a, b]];
  const out = [];
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

const pressInline = (el, style, nodes, columns, key, tip, look = {}, box = {}) => {
  const marks = tip ? marksIn(nodes).flatMap((m) => {
    const press = tip(m.note);
    return press ? [{ ...m, press }] : [];
  }) : [];
  if (!marks.length) return null;
  const { Box, Text, Button } = el;
  const run = (a, b) => h(Text, _extends({ key: `${key}.t${a}` }, look), renderInline(el, style, sliceInline(nodes, a, b), `${key}.t${a}`));
  const text = inlineText(nodes);
  const words = [...text.matchAll(/\s*\S+\s*/g)].flatMap((m) => piecesOf(text, m.index, m.index + m[0].length, Math.max(1, columns), marks));
  return (
    h(Box, _extends({ key: key, flexDirection: "row", flexWrap: "wrap" }, box),
    words.map(([a, b]) => {
      const inside = marks.filter((m) => m.start >= a && m.end <= b);
      if (!inside.length) return run(a, b);
      const parts = [];
      let at = a;
      for (const m of inside) {
        if (m.start > at) parts.push(run(at, m.start));
        parts.push(
          h(Button, _extends({ key: `${key}.n${m.start}`, plain: true }, noteHover(style, m.note), { onPress: m.press }),
          h(Text, { color: style.theme.accent, bold: look.bold }, m.text)
          )
        );
        at = m.end;
      }
      if (at < b) parts.push(run(at, b));
      return h(Box, { key: `${key}.w${a}`, flexDirection: "row", flexShrink: 0 }, parts);
    })
    ));

};

const PRISM_COLORS = {
  comment: 'codeComment', prolog: 'codeComment', doctype: 'codeComment', cdata: 'codeComment',
  string: 'codeString', char: 'codeString', 'template-string': 'codeString', 'attr-value': 'codeString', url: 'codeString',
  number: 'number', boolean: 'number', constant: 'number', symbol: 'number', inserted: 'number',
  keyword: 'codeFlag', important: 'codeFlag', atrule: 'codeFlag', rule: 'codeFlag', deleted: 'codeFlag',
  function: 'codeCommand', 'class-name': 'codeCommand', builtin: 'codeCommand', key: 'codeCommand', selector: 'codeCommand',
  property: 'link', tag: 'link', 'attr-name': 'emphasis', variable: 'emphasis', regex: 'path'
};



const shownCode = (text, style, room, command = false) => style.reorder ? codeVisual(text, style.shape, room, width, command) : text;

const flatten = (tokens, style, color, italic = false) =>
tokens.flatMap((token) => {
  if (typeof token === 'string') return [{ text: token, color, italic }];
  const names = [token.type, ...(Array.isArray(token.alias) ? token.alias : token.alias ? [token.alias] : [])];
  const slot = names.map((n) => PRISM_COLORS[n]).find(Boolean);
  const inner = Array.isArray(token.content) ? token.content : [token.type === 'comment' && typeof token.content === 'string' && style.reorder ? commentVisual(token.content, style.shape) : token.content];
  return flatten(inner, style, slot ? style.theme[slot] : color, italic || token.type === 'comment');
});

const remember = (cache, key, make, limit = 200) => {
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const value = make();
  cache.set(key, value);
  if (cache.size > limit) cache.delete(cache.keys().next().value);
  return value;
};

const highlighted = new WeakMap();

const grammarFor = (lang) => {
  const name = lang.toLowerCase();
  const grammar = Object.hasOwn(languages, name) ? languages[name] : undefined;
  return grammar !== null && typeof grammar === 'object' ? grammar : undefined;
};

const shownSegment = (seg, piece, style, room) => ({ ...seg, text: seg.italic ? piece : shownCode(piece, style, room) });

const segmentRows = (style, lines, lang, room) => {
  const grammar = grammarFor(lang);
  if (!grammar) return null;
  const code = lines.join('\n');
  const cache = highlighted.get(style.theme) ?? new Map();
  highlighted.set(style.theme, cache);
  return remember(cache, `${style.reorder ? style.shape : ''}\0${room ?? ''}\0${lang}\0${code}`, () => {
    const out = [[]];
    for (const seg of flatten(tokenize(code, grammar), style)) {
      seg.text.split('\n').forEach((piece, i) => {
        if (i > 0) out.push([]);
        if (piece) out[out.length - 1].push(shownSegment(seg, piece, style, room));
      });
    }
    return out;
  });
};

const highlightBlock = ({ Text }, style, lines, lang, key, room) => {
  const rows = segmentRows(style, lines, lang, room);
  if (!rows) return null;
  return rows.map((row, r) =>
  h(Text, { key: `${key}.${r}`, color: style.theme.codeText },
  row.length ? row.map((s, i) => h(Text, { key: `${key}.${r}.${i}`, color: s.color, italic: s.italic }, s.text)) : ' '
  )
  );
};

const gutterOf = (lines, numbered) => numbered ? String(lines.length).length + 2 : 0;

const heldCode = (el, style, lines, shown, lang, gutter, room, key) =>
(segmentRows(style, lines, lang) ?? lines.map((text) => text ? [{ text, italic: false }] : [])).slice(0, shown).flatMap((segs, i) =>
visualRows(tabbed(wordPieces(segs, null)), room).map((part, k) =>
h(el.Box, { key: `${key}.h${i}.${k}`, flexDirection: "row" },
numberedLine(el, style, `  ${gutter ? k ? ' '.repeat(gutter + 2) : `${String(i + 1).padStart(gutter)}  ` : ''}`, part, `${key}.h${i}.${k}`)
)
));

const codeRows = (el, style, lines, shown, lang, numbered, room, key) => {
  if (style.nativeCode) return [h(el.Code, _extends({ key: "code", source: lines.slice(0, shown).join('\n') || ' ' }, lang ? { language: lang } : {}, numbered ? { startLine: 1 } : {}))];
  const rows = (isShellLang(lang) ? null : highlightBlock(el, style, lines, lang, key, room))?.slice(0, shown) ?? lines.slice(0, shown).map((line, i) => codeLine(el, style, line, lang, `${key}.${i}`, room));
  return style.shape === 'engine' ? rows.map((row, i) => h(el.Text, _extends({ key: `${key}.ltr${i}` }, heldLtr(style)), row)) : rows;
};

const codeBody = (el, style, rows, gutter, held, more) => {
  const { Box, Text } = el;
  return (
    h(Box, { flexDirection: "column", paddingLeft: held ? 0 : 2 },
    held || !gutter || style.nativeCode ? rows : rows.map((row, i) => row.type === 'Text' ? h(Box, { key: `n${i}`, flexDirection: "row" }, h(Text, { color: style.theme.codeComment, dimColor: true }, `${String(i + 1).padStart(gutter)}  `), row) : row),
    held && more ? h(Box, { paddingLeft: 2 }, more) : more
    ));

};

const isShellLang = (lang) => lang === '' || /^(sh|bash|zsh|shell|console|fish|powershell|ps1)$/i.test(lang);

const codeLine = (el, style, line, lang, key, room) => {
  const { Text } = el;
  const t = style.theme;
  const isShell = isShellLang(lang);
  if (/[\u2500-\u257F]/.test(line)) return h(Text, { key: key, color: t.codeText }, line);
  const comment = style.reorder ? commentTail(line, style.shape) : null;
  if (comment) {
    return (
      h(Text, { key: key, color: t.codeText },
      comment.head ? codeLine(el, style, comment.head, lang, `${key}.h`) : null,
      h(Text, { color: t.codeComment }, comment.marker + comment.tail)
      ));

  }
  if (!isShell) return h(Text, { key: key, color: t.codeText }, shownCode(line, style, room) || ' ');
  if (/^\s*#/.test(line)) return h(Text, { key: key, color: t.codeComment }, line);
  const parts = shownCode(line, style, room, true).split(/("[^"]*"|'[^']*'|\s+)/).filter((p) => p !== '');
  let seenCommand = false;
  return (
    h(Text, { key: key, color: t.codeText },
    parts.map((p, i) => {
      if (/^\s+$/.test(p)) return h(Text, { key: `${key}.${i}` }, p);
      if (/^["']/.test(p)) return h(Text, { key: `${key}.${i}`, color: t.codeString }, p);
      if (/^--?[\w-]/.test(p)) return h(Text, { key: `${key}.${i}`, color: t.codeFlag }, p);
      if (!seenCommand && !/^[$>|&;]+$/.test(p)) {
        seenCommand = true;
        return h(Text, { key: `${key}.${i}`, color: t.codeCommand }, p);
      }
      if (/^(\||&&|;|\|\|)$/.test(p)) seenCommand = false;
      return h(Text, { key: `${key}.${i}` }, p);
    })
    ));

};

const longestWord = (text) => Math.max(0, ...text.split(/\s+/).map(width));

const columnWidths = (natural, available, gap, words = []) => {
  const room = Math.max(natural.length, available - gap * (natural.length - 1));
  const total = natural.reduce((a, b) => a + b, 0);
  if (total <= room) return natural;
  const minimum = natural.map((w, c) => Math.min(w, Math.max(1, words[c] ?? 1)));
  const widths = natural.map(() => 0);
  let open = natural.map((_, c) => c);
  let left = room;
  for (let fixed = [-1]; fixed.length;) {
    const share = Math.floor(left / open.length);
    const claim = (c) => natural[c] <= share ? natural[c] : minimum[c];
    const minimumsFit = open.reduce((a, c) => a + minimum[c], 0) <= left;
    const needed = open.reduce((a, c) => a + claim(c), 0);
    fixed = open.filter((c) => natural[c] <= share);
    if (minimumsFit && (!fixed.length || needed > left)) fixed = open.filter((c) => minimum[c] > share);
    fixed.forEach((c) => (widths[c] = claim(c), left -= widths[c]));
    open = open.filter((c) => !fixed.includes(c));
  }
  open.forEach((c, i) => widths[c] = Math.max(1, Math.floor(left / open.length) + (i < left % open.length ? 1 : 0)));
  while (widths.reduce((a, b) => a + b, 0) > room) {
    const widest = widths.indexOf(Math.max(...widths));
    if (widths[widest] <= 1) break;
    widths[widest]--;
  }
  return widths;
};

const tableCells = (block) => [...block.header, ...block.rows.flat()];

const mostlyRtl = (style, lines) => lines.filter((line) => flowOf(style, line, Infinity)?.base === 'R').length * 2 > lines.length;

const isRtlTable = (style, block) => mostlyRtl(style, tableCells(block).filter((cell) => displayText(cell).trim() !== ''));

const ART_WIDTH = 100;

const tableSize = (block) => {
  const cells = [block.header, ...block.rows].map((r) => block.header.map((_, c) => displayText(r[c] ?? [])));
  const column = (measure) => block.header.map((_, c) => Math.max(...cells.map((r) => measure(r[c]))));
  return { natural: column(widestLine), words: column(longestWord) };
};

const tableArt = (block) => {
  const cells = [block.header, ...block.rows].map((r) => block.header.map((_, c) => displayText(r[c] ?? [])));
  const { natural, words } = tableSize(block);
  const widths = columnWidths(natural, ART_WIDTH - 4, 3, words);
  const pad = (text, c, align) => {
    const room = Math.max(0, widths[c] - width(text));
    const left = align === 'right' ? room : align === 'center' ? Math.floor(room / 2) : 0;
    return ' '.repeat(left) + text + ' '.repeat(room - left);
  };
  const line = (l, m, r) => l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r;
  const row = (r, header) => {
    const lines = r.map((text, c) => wrapRanges(text, widths[c]).map(([a, b]) => text.slice(a, b)));
    return Array.from({ length: Math.max(...lines.map((l) => l.length)) }, (_, i) =>
    `│ ${lines.map((l, c) => pad(l[i] ?? '', c, header ? 'center' : block.align[c] ?? 'left')).join(' │ ')} │`);
  };
  const art = [line('┌', '┬', '┐'), ...row(cells[0], true), ...cells.slice(1).flatMap((r) => [line('├', '┼', '┤'), ...row(r, false)]), line('└', '┴', '┘')];
  return ['```', ...art, '```'].join('\n');
};

const clip = ({ Box }, w, drawn, key) =>
h(Box, { key: key, flexDirection: "column", minWidth: w },
h(Box, { height: 0, flexGrow: 1, overflow: "hidden" },
drawn
)
);


const tableEdges = (style, block, rtl, mirror) => {
  const held = !rtl && mirrored(style) && tableCells(block).some(containsRtl);
  return {
    opening: mirror ? ROW_MARK_TEXT : held ? LTR_BLANK : '',
    wall: (text) => mirror ? text.replace('│', WALL) : held ? text.replace(/ $/, LTR_BLANK) : text,
    held,
    marked: !mirror && !held
  };
};

const renderTable = (el, style, block, columns, key, rtl, tip) => {
  const { Box, Text } = el;
  const t = style.theme;
  const box = style.tableStyle === 'box';
  const gap = box ? 0 : style.tableStyle === 'grid' ? 3 : 2;
  const { natural, words } = tableSize(block);
  const widths = box ? columnWidths(natural, columns - 4, 3, words) : columnWidths(natural, columns, gap, words);
  const order = natural.map((_, c) => c);
  const mirror = rtl && mirrored(style);
  const flip = rtl && !mirror;
  const { opening, wall, held, marked } = tableEdges(style, block, rtl, mirror);
  if (flip) order.reverse();
  const lead = (k) => opening ? h(Text, { key: `${k}.m`, color: t.rule }, opening) : null;
  const columnGap = held ? 0 : gap;
  const spacer = (k) => held ? h(Text, { key: k }, LTR_BLANK + ' '.repeat(gap - 1)) : null;
  const ruleChar = style.tableStyle === 'grid' ? '━' : '─';
  const justify = (c) =>
  block.align[c] === 'right' ? 'flex-end' : block.align[c] === 'center' ? 'center' : 'flex-start';

  const rule = (k, heavy) =>
  h(Box, { key: k, flexDirection: "row", columnGap: columnGap },
  lead(k),
  order.map((c, i) => [
  i > 0 && spacer(`${k}.${c}g`),
  h(Text, { key: `${k}.${c}`, color: t.tableRule, dimColor: !heavy && !t.tableRule },
  (heavy ? ruleChar : '─').repeat(widths[c])
  )]
  )
  );


  const bar = (k, text, lines = 1) =>
  h(Text, { key: k, color: t.tableRule, dimColor: !t.tableRule }, Array.from({ length: lines }, () => text).join('\n'));

  const clipped = (lines) => (k, text) => clip(el, width(text), bar(`${k}.b`, text, lines), k);
  const edge = (k, [left, fill, mid, right]) =>
  bar(k, (mirror ? WALL : left) + order.map((c) => fill.repeat(widths[c] + 2)).join(mid) + (mirror ? WALL : right));

  const terminalRow = (cells, k, isHeader) => {
    const parts = box ? [{ kind: 'dim', text: '│ ' }] : [];
    order.forEach((c, i) => {
      if (i > 0) parts.push(box ? { kind: 'dim', text: ' │ ' } : { kind: 'text', text: ' '.repeat(gap) });
      const cell = flowOf({ ...style, shape: 'visual' }, cells[c] ?? [], Infinity);
      const content = cell ? cell.lines[0] : cells[c] ?? [];
      const pad = Math.max(0, widths[c] - width(inlineText(content)));
      const side = cell?.base === 'R' && block.align[c] !== 'center' ? 'flex-end' : justify(c);
      const before = side === 'flex-end' ? pad : side === 'center' ? Math.floor(pad / 2) : 0;
      parts.push({ kind: 'text', text: ' '.repeat(before) }, ...(isHeader ? [{ kind: 'strong', children: content }] : content), { kind: 'text', text: ' '.repeat(pad - before) });
    });
    if (box) parts.push({ kind: 'dim', text: ' │' });
    return h(Text, { key: k }, renderInline(el, style, terminalLine(parts), k));
  };

  const row = (cells, k, isHeader, border = bar) => rtl && style.shape === 'inverse' ? terminalRow(cells, k, isHeader) :
  h(Box, { key: k, flexDirection: "row", columnGap: columnGap, alignItems: "stretch" },
  !box && lead(k),
  box && border(`${k}.l`, wall('│ ')),
  order.map((c, i) => {
    const w = widths[c];
    const cell = cellFlow(style, cells[c] ?? [], held, marked);
    const content = cell ? cell.lines[0] : cells[c] ?? [];
    const side = mirror ? block.align[c] === 'center' ? 'center' : 'flex-start' : cell?.base === 'R' && block.align[c] !== 'center' ? 'flex-end' : justify(c);
    const runs = isHeader ? headerRuns(content) : content;
    const cellBox =
    h(Box, { key: `${k}.${c}`, width: w, flexShrink: 0, justifyContent: side },
    pressInline(el, style, runs, w, `${k}.${c}.p`, tip, isHeader ? { bold: true, color: t.tableHeader } : {}, { justifyContent: side }) ?? (
    isHeader ?
    h(Text, { bold: true, color: t.tableHeader }, runs.some((n) => n.kind === 'footnote') ? renderInline(el, style, runs, `${k}.${c}`) : inlineText(runs)) :
    mirror && inlineText(content).trim() === '' ? h(Text, null, ' '.repeat(w)) :
    h(Text, null, renderInline(el, style, content, `${k}.${c}`)))
    );

    return [i > 0 && (box ? border(`${k}.${c}s`, wall(' │ ')) : spacer(`${k}.${c}g`)), cellBox];
  }),
  box && border(`${k}.r`, wall(' │'))
  );


  const wrappedRow = (cells, k, isHeader) => {
    if (!isHeader && cells.some(hasLink)) return [row(cells, k, isHeader, clipped(Math.max(1, ...widths.map((w, c) => mostLines(displayText(cells[c] ?? []), w)))))];
    const wrapped = widths.map((w, c) => {
      const content = cells[c] ?? [];
      if (natural[c] <= w && !inlineText(content).includes('\n')) return [content];
      return wrapInline(isHeader ? headerRuns(content) : content, w);
    });
    return Array.from({ length: Math.max(...wrapped.map((l) => l.length)) }, (_, i) =>
    row(wrapped.map((l) => l[i] ?? []), `${k}.${i}`, isHeader));
  };

  if (box) {
    const lines = [edge(`${key}.t`, '┌─┬┐'), ...wrappedRow(block.header, `${key}.h`, true), edge(`${key}.hr`, '╞═╪╡')];
    block.rows.forEach((r, i) => {
      if (i > 0) lines.push(edge(`${key}.r${i}r`, '├─┼┤'));
      lines.push(...wrappedRow(r, `${key}.r${i}`, false));
    });
    lines.push(edge(`${key}.b`, '└─┴┘'));
    return h(Box, _extends({ key: key, flexDirection: "column" }, flip ? { alignSelf: 'flex-end' } : {}), lines);
  }

  const body = [row(block.header, `${key}.h`, true), rule(`${key}.hr`, true)];
  block.rows.forEach((r, i) => {
    body.push(row(r, `${key}.r${i}`, false));
    if (style.tableStyle !== 'minimal' && i < block.rows.length - 1) body.push(rule(`${key}.r${i}r`, false));
  });
  return h(Box, _extends({ key: key, flexDirection: "column" }, flip ? { alignSelf: 'flex-end' } : {}), body);
};

const renderHeading = (el, style, block, key) => {
  const rtl = flowOf(style, block.inline, Infinity);
  if (!rtl) return drawHeading(el, style, block, block.inline, key);
  if (rtl.base === 'R' && mirrored(style) && style.headingStyle === 'banner' && block.level <= 2) return mirroredBanner(el, style, block.level, rtl.lines[0], key);
  const heading = drawHeading(el, style, block, rtl.lines[0], key);
  return rtl.base === 'R' && !mirrored(style) ? h(el.Box, { key: key, alignSelf: "flex-end" }, heading) : heading;
};

const mirroredBanner = (el, style, level, inline, key) => {
  const { Box, Text } = el;
  const color = style.theme.heading;
  const text = h(Text, { key: `${key}.h`, bold: true, underline: level === 2, color: color }, level === 1 ? `${WALL} ` : '', renderInline(el, style, inline, key), level === 1 ? ` ${WALL}` : '');
  if (level === 2) return text;
  const edge = (k) => h(Text, { key: k, color: color }, WALL + '━'.repeat(width(inlineText(inline)) + 2) + WALL);
  return h(Box, { key: key, flexDirection: "column" }, edge(`${key}.t`), text, edge(`${key}.b`));
};

const HEADING_RULE = 200;

const drawHeading = (el, style, block, inline, key) => {
  const { Box, Text } = el;
  const t = style.theme;
  const color = block.level <= 2 ? t.heading : t.accent ?? t.heading;
  const label = inlineText(inline);
  switch (style.headingStyle) {
    case 'uppercase':
      return h(Text, { key: key, bold: true, color: color }, block.level === 1 ? label.toUpperCase() : label);
    case 'underline':
      return h(Text, { key: key, bold: true, underline: block.level <= 2, color: color }, label);
    case 'banner':
      if (block.level === 1) return h(Box, { key: key, alignSelf: "flex-start", borderStyle: "bold", borderColor: color, paddingX: 1 }, h(Text, { bold: true, color: color }, renderInline(el, style, inline, key)));
      return block.level === 2 ?
      h(Box, { key: key, flexDirection: "column", alignSelf: "flex-start" }, h(Text, { bold: true, color: color }, renderInline(el, style, inline, key)), style.gridFace ? h(Box, { flexDirection: "row" }, h(Box, { width: 0, flexGrow: 1, height: 1, overflow: "hidden" }, h(Text, { color: color }, '━'.repeat(HEADING_RULE)))) : h(Text, { color: color }, '━'.repeat(width(label)))) :
      h(Text, { key: key, bold: true, color: block.level === 3 ? color : t.strong }, renderInline(el, style, inline, key));
    default:
      return h(Text, { key: key, bold: true, color: color }, renderInline(el, style, inline, key));
  }
};

const ALERT_COLOR = { note: 'blue', tip: 'green', important: 'magenta', warning: 'yellow', caution: 'red' };

const prose = (style) => style.inside === 'quote' ? { italic: true, color: style.theme.quote } : {};

const renderParagraph = (el, style, block, columns, key, tip) => {
  const { Box, Text } = el;
  const rtl = flowOf(style, block.inline, columns);
  if (rtl?.base === 'R') return h(Box, _extends({ key: key, flexDirection: "column" }, mirrored(style) ? {} : { alignItems: 'flex-end' }), renderFlow(el, style, rtl.lines, key, prose(style)));
  const inline = rtl ? rtl.lines[0] : block.inline;
  return pressInline(el, style, inline, columns, key, tip, { ...(style.narration ? { bold: true } : {}), ...prose(style) }) ?? h(Text, _extends({ key: key, bold: style.narration }, prose(style)), renderInline(el, style, inline, key));
};

const leadInline = (blocks) => {
  const first = blocks[0];
  if (first?.kind === 'paragraph' || first?.kind === 'heading') return first.inline;
  if (first?.kind === 'list') return first.items[0]?.inline ?? [];
  return first?.kind === 'quote' || first?.kind === 'alert' ? leadInline(first.blocks) : [];
};

const renderNested = (el, style, blocks, columns, key, copy, fold, tip) =>
renderBlocks(el, style, blocks, columns, drawMath(el, style, blocks), copy && ((text, id, label, html) => copy(text, `${key}.${id}`, label, html)), fold && ((id, hidden, k) => fold(id, hidden, `${key}.${k}`)), tip);

const quoteBar = (el, text, color, lines) =>
lines <= 1 ? h(el.Text, { color: color }, text) : clip(el, width(text), h(el.Text, { color: color }, Array.from({ length: lines }, () => text).join('\n')));

const renderQuote = (el, style, block, columns, key, copy, fold, tip) => {
  const { Box } = el;
  const t = style.theme;
  const inner = columns - 2;
  const lines = heightOf(block.blocks, inner);
  const body = h(Box, { flexDirection: "column", rowGap: 1 }, renderNested(el, { ...style, inside: 'quote' }, block.blocks, inner, key, copy, fold, tip));
  if (!mirrored(style) && flowOf(style, leadInline(block.blocks), inner)?.base === 'R') {
    return (
      h(Box, { key: key, flexDirection: "row", justifyContent: "flex-end", alignItems: "stretch" },
      body,
      quoteBar(el, ' │', t.accent, lines)
      ));

  }
  return (
    h(Box, { key: key, flexDirection: "row", alignItems: "stretch" },
    quoteBar(el, mirrored(style) ? ROW_MARK_TEXT : '│ ', t.accent, lines),
    body
    ));

};

const renderAlert = (el, style, block, columns, key, copy, fold, tip) => {
  const { Box, Text } = el;
  const color = ALERT_COLOR[block.level];
  const inner = columns - 4;
  const hebrew = flowOf(style, leadInline(block.blocks), inner)?.base === 'R';
  const label = block.level[0].toUpperCase() + block.level.slice(1);
  const body = block.blocks.length ? h(Box, { flexDirection: "column", rowGap: 1 }, renderNested(el, { ...style, inside: 'alert' }, block.blocks, inner, key, copy, fold, tip)) : null;
  if (hebrew && mirrored(style)) {
    const lines = 1 + (block.blocks.length ? 1 + heightOf(block.blocks, inner) : 0);
    const edge = (k) => h(Text, { key: k, color: color }, WALL + '─'.repeat(inner + 2) + WALL);
    return (
      h(Box, { key: key, flexDirection: "column", alignSelf: "flex-start" },
      edge(`${key}.t`),
      h(Box, { flexDirection: "row", alignItems: "stretch" },
      quoteBar(el, ROW_MARK_TEXT, color, lines),
      h(Box, { flexDirection: "column", width: inner },
      h(Text, { bold: true, color: color }, label),
      body
      ),
      quoteBar(el, ` ${WALL}`, color, lines)
      ),
      edge(`${key}.b`)
      ));

  }
  return (
    h(Box, _extends({ key: key, flexDirection: "column", alignSelf: hebrew ? 'flex-end' : 'flex-start' }, hebrew ? { alignItems: 'flex-end' } : {}, { borderStyle: "round", borderColor: color, paddingX: 1 }),
    h(Text, { bold: true, color: color }, label),
    body
    ));

};

const listSide = (style, block) => {
  if (!style.reorder || !block.items.some((item) => containsRtl(item.inline))) return undefined;
  return mostlyRtl(style, block.items.map((item) => item.inline)) ? 'R' : 'L';
};

const leftItem = (el, style, depth, lead, color, inline, room, k, look, tip) => {
  const { Box, Text } = el;
  return (
    h(Box, { key: k, flexDirection: "row", paddingLeft: depth * 2 },
    h(Text, { color: color }, lead),
    pressInline(el, style, inline, room, `${k}.i`, tip, look) ?? h(Text, look, renderInline(el, style, inline, k))
    ));

};

const leadSide = (style, block, room) => block.kind === 'list' ? listSide(style, block) : flowOf(style, leadInline([block]), room)?.base;

const heldItem = (el, style, item, glyph, color, room, k, look) => {
  const { Box, Text } = el;
  const lines = mirrored(style) ? flowOf(style, item.inline, room - 1, false).lines.map((line) => [{ kind: 'text', text: LTR_BLANK }, ...line]) : flowOf(style, item.inline, room).lines;
  return (
    h(Box, { key: k, flexDirection: "row", paddingLeft: item.depth * 2 },
    h(Text, { color: color }, mirrored(style) ? glyph : `${glyph} `),
    h(Box, { flexDirection: "column" }, renderFlow(el, style, lines, k, look))
    ));

};

const listRow = (el, style, item, glyph, glyphColor, side, room, k, look, tip) => {
  const { Box, Text } = el;
  const rtl = flowOf(style, item.inline, room);
  const right = side ? side === 'R' : rtl?.base === 'R';
  const lines = rtl?.lines ?? [mirrored(style) ? [ROW_MARK, ...item.inline] : item.inline];
  const drawn = () => (rtl ? null : pressInline(el, style, lines[0], room, `${k}.i`, tip, look, mirrored(style) ? {} : { justifyContent: 'flex-end' })) ?? renderFlow(el, style, lines, k, look);
  return right && mirrored(style) ?
  h(Box, { key: k, flexDirection: "row" },
  h(Text, { color: glyphColor }, `${' '.repeat(item.depth * 2)}${glyph} `),
  h(Box, { flexDirection: "column" }, drawn())
  ) :
  right ?
  h(Box, { key: k, flexDirection: "row", justifyContent: "flex-end", paddingRight: item.depth * 2 },
  h(Box, { flexDirection: "column", alignItems: "flex-end" }, drawn()),
  h(Text, { color: glyphColor }, ` ${listMarker(glyph, style.shape)}`)
  ) :
  rtl?.base === 'R' ?
  heldItem(el, style, item, glyph, glyphColor, room, k, look) :

  leftItem(el, style, item.depth, `${glyph} `, glyphColor, rtl ? rtl.lines[0] : item.inline, room, k, look, tip);

};

const TASK_GLYPHS = { checks: ['[ ]', '[✓]'], ticks: ['○', '✓'], box: ['□', '✓'], progress: ['○', '✓'] };

const renderList = (el, style, block, columns, key, copy, fold, tip) => {
  const { Box, Text } = el;
  const t = style.theme;
  const tasks = block.items.filter((item) => item.task !== undefined);
  const done = tasks.filter((item) => item.task).length;
  const filled = tasks.length ? Math.round(done / tasks.length * 20) : 0;
  const strike = style.taskStyle === 'checks' || style.taskStyle === 'box';
  const tick = style.taskStyle === 'ticks' || style.taskStyle === 'progress';
  const side = listSide(style, block);
  return (
    h(Box, { key: key, flexDirection: "column" },
    style.taskStyle === 'progress' && tasks.length > 0 &&
    h(Text, null,
    h(Text, { color: t.accent }, '━'.repeat(filled)),
    h(Text, { color: t.bullet, dimColor: true }, '─'.repeat(20 - filled)),
    h(Text, { color: t.bullet }, ` ${done}/${tasks.length} done`)
    ),

    block.items.map((item, i) => {
      const k = `${key}.${i}`;
      const glyph = item.task !== undefined ? TASK_GLYPHS[style.taskStyle][item.task ? 1 : 0] : /\d/.test(item.marker) ? item.marker : item.depth ? '◦' : '•';
      const glyphColor = item.task && tick ? t.accent : t.bullet;
      const pad = item.depth * 2 + glyph.length + 1;
      const look = { ...(item.task === true ? { dimColor: true, strikethrough: strike } : {}), ...prose(style) };
      const row = listRow(el, style, item, glyph, glyphColor, side, columns - pad, k, look, tip);
      if (!item.blocks) return row;
      return (
        h(Box, { key: k, flexDirection: "column" },
        row,
        h(Box, { flexDirection: "column", paddingLeft: pad }, renderNested(el, style, item.blocks, columns - pad, k, copy, fold, tip))
        ));

    })
    ));

};







const instanceKey = (id) => {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = h * 33 + id.charCodeAt(i) | 0;
  return (h >>> 0).toString(36);
};

const noteTip = (blocks, toast) => {
  const notes = blocks.find((block) => block.kind === 'notes');
  if (notes?.kind !== 'notes') return undefined;
  const text = new Map(notes.notes.map((note) => [note.note, `${note.mark} ${inlineText(note.inline)}`]));
  return (note) => {
    const line = text.get(note);
    return line === undefined ? undefined : () => toast(line);
  };
};

const NUMBER_AT = 10;
const NUMBER_MAX = Infinity;
const FOLD_AT = 30;
const FOLD_SHOW = 20;

const codeId = (lines) => {
  let h = 5381;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) h = h * 33 + line.charCodeAt(i) | 0;
    h = h * 33 + 10 | 0;
  }
  return `${lines.length}:${(h >>> 0).toString(36)}`;
};

const copySource = (style, block) =>
block.kind === 'code' ? block.lines.join('\n') :
block.kind === 'table' ? block.raw :
style.inside ? undefined :
block.kind === 'list' ? block.raw :
block.kind === 'quote' || block.kind === 'alert' ? block.raw.split('\n').map((line) => line.replace(/^\s*>\s?/, '')).join('\n') :
undefined;

const drawMath = (el, style, blocks, drawn = new Map()) => {
  for (const [i, block] of blocks.entries()) {
    const tex = drawn.has(i) ? null : mathOf(block);
    const text = tex === null ? null : texText(tex);
    if (text && !text.includes('\\')) drawn.set(i, { element: h(el.Box, { key: `b${i}`, paddingLeft: 2 }, h(el.Text, { italic: true, color: style.theme.emphasis }, text)) });
  }
  return drawn;
};

const opensWithCopy = (block) =>
block.kind === 'quote' && (block.blocks[0]?.kind === 'code' || block.blocks[0]?.kind === 'table' || block.blocks[0] !== undefined && opensWithCopy(block.blocks[0]));

const holdsOnlyEmptyCode = (block) =>
block.kind === 'quote' && block.blocks.length === 1 && (block.blocks[0].kind === 'code' && block.blocks[0].lines.length === 0 || holdsOnlyEmptyCode(block.blocks[0]));

const MARK = 2;

const markerRoom = (style) => style.copyButtons && style.copyButtonStyle === 'hover' ? MARK : 0;

const codeLabel = (block) => `── ${block.lang || 'code'}`;



const buttonText = (button) =>
button?.type === 'Button' ? `[ ${button.props.label} ]` : button?.type === 'Text' ? (button.children ?? []).filter((c) => typeof c === 'string').join('') : undefined;

const keyOf = (button) => String(('props' in button ? button.props?.key : undefined) ?? '');

const markedRow = ({ Box }, key, element, float, start) =>
h(Box, _extends({ key: key, flexDirection: "column" }, start ? { alignItems: 'flex-end' } : { alignSelf: 'flex-start' }),
h(Box, _extends({ flexDirection: "row", columnGap: 1, minWidth: float.needs }, start ? { justifyContent: 'flex-end' } : {}),
start ? float.marker : null,
element,
start ? null : float.marker,
float.element
)
);


const renderBlocks = (el, style, blocks, columns, drawn = new Map(), copy, fold, tip) => {
  const { Box, Text } = el;
  const t = style.theme;
  const hover = style.copyButtonStyle === 'hover';
  const reserved = (buttons) =>
  buttons.reduce((w, button) => {
    const shown = buttonText(button);
    return shown === undefined ? w : w + (w ? 1 : 0) + width(shown);
  }, 0);
  const fitted = (parts) =>
  parts.reduce((kept, part) => part && (!kept.length || reserved([...kept, part]) <= columns) ? [...kept, part] : kept, []);
  const scopeOf = (button) => `copy:${style.noteKey ?? ''}:${keyOf(button)}`;
  const floating = (kept, low = false, start = false) => {
    const scope = scopeOf(kept[0]);
    return {
      needs: reserved(kept),
      marker: h(Box, { flexShrink: 0, alignSelf: low ? 'flex-end' : 'flex-start', hover: { scope } }, h(Text, { dimColor: true }, "\u29C9")),
      element: h(Box, _extends({ position: "absolute" }, low ? { bottom: 0 } : { top: 0 }, start ? { left: 0 } : { right: 0 }, { display: "none", hover: { scope, display: 'flex' } }), kept.flatMap((button, i) => i ? [h(Text, { key: `gap${i}` }, " "), button] : [button]))
    };
  };
  const shown = blocks.map((block) => drawable(block, style));
  const rtlTables = shown.map((block) => style.reorder && block.kind === 'table' && isRtlTable(style, block));
  const buttons = blocks.map((block, b) => {
    const text = hover && holdsOnlyEmptyCode(block) ? undefined : copySource(style, block);
    const isPlainCode = block.kind === 'code' && !drawn.get(b)?.element;
    const art = drawn.get(b)?.art ?? (block.kind === 'table' ? () => tableArt(block) : undefined);
    const first = text === undefined || isPlainCode ? null : copy?.(text, `copy${b}`, block.kind === 'table' ? '⧉ md' : art === undefined ? undefined : '⧉ source');
    const second = first && art !== undefined ? copy?.(art, `art${b}`, '⧉ art') : null;
    const html = first && block.kind === 'table' ? copy?.(() => tableText(block), `html${b}`, '⧉ html', () => tableHtml(block)) : null;
    return { first, second, html };
  });
  const codeHead = (label, button) => {
    if (!hover || !button) return null;
    const float = floating([button]);
    return { ...float, minWidth: Math.min(columns, width(label) + 1 + float.needs) };
  };
  const room = (b) => hover && buttons[b].first ? columns - MARK : columns;
  const beside = (b) => !buttons[b].first ? columns : hover ? columns - MARK : columns - reserved([buttons[b].first]) - 2;
  const rendered = shown.map((block, b) => {
    const key = `b${b}`;
    switch (block.kind) {
      case 'heading':
        return renderHeading(el, style, block, key);
      case 'paragraph':
        return drawn.get(b)?.element ?? renderParagraph(el, style, block, columns, key, tip);
      case 'quote':
        return renderQuote(el, style, block, beside(b), key, copy, fold, tip);
      case 'alert':
        return renderAlert(el, style, block, beside(b), key, copy, fold, tip);
      case 'rule':
        return h(Text, { key: key, color: t.rule, dimColor: !t.rule }, '─'.repeat(Math.max(8, Math.min(columns, 80))));
      case 'code':{
          const done = drawn.get(b)?.element;
          if (done) return done;
          const note = drawn.get(b)?.note;
          const lines = block.lines;
          const toggle = lines.length > FOLD_AT ? fold?.(codeId(lines), lines.length - FOLD_SHOW, `fold${b}`) : null;
          const shown = toggle?.folded ? FOLD_SHOW : lines.length;
          const numbered = lines.length >= NUMBER_AT && lines.length <= NUMBER_MAX;
          const room = columns - 2 - gutterOf(lines, numbered);
          const gutter = numbered ? String(lines.length).length : 0;
          const held = !style.nativeCode && mirrored(style) && lines.some((line) => hasRtl(line) && (!opensLatin(line) || width(line) > room));
          const rows = held ? heldCode(el, style, lines, shown, block.lang, gutter, room, key) : codeRows(el, style, lines, shown, block.lang, numbered, room, key);
          const button = copy?.(lines.join('\n'), `copy${b}`) ?? null;
          const label = codeLabel(block);
          const head = codeHead(label, button);
          return (
            h(Box, { key: key, flexDirection: "column", alignSelf: "flex-start", minWidth: head?.minWidth },
            note ? h(Text, { color: t.codeComment }, note) : null,
            h(Box, { flexDirection: "row", justifyContent: "space-between", columnGap: head ? 1 : 4 },
            h(Text, { color: t.codeComment }, label),
            head ? head.marker : button,
            head?.element
            ),
            codeBody(el, style, rows, gutter, held, toggle?.element ?? null)
            ));

        }
      case 'list':
        return renderList(el, style, block, room(b), key, copy, fold, tip);
      case 'table':
        return renderTable(el, style, block, room(b), key, rtlTables[b], tip);
      case 'notes':
        return (
          h(Box, { key: key, flexDirection: "column" },
          h(Text, { dimColor: true }, '─'.repeat(Math.min(columns, 12))),
          block.notes.map((note, i) => h(Text, _extends({ key: `${key}.${i}`, dimColor: true }, noteHover(style, note.note)), note.mark, " ", renderInline(el, style, note.inline, `${key}.${i}`)))
          ));

    }
  });
  const copied = rendered.map((element, b) => {
    const block = blocks[b];
    const { first, second, html } = buttons[b];
    if (!first) return element;
    const { Box } = el;
    const hebrew = style.reorder && hasRtl(block.raw);
    const rtl = hebrew && !mirrored(style);
    const mirror = hebrew && mirrored(style);
    if (hover) {
      const wide = rtl && (block.kind === 'list' || block.kind === 'quote' || block.kind === 'alert' || rtlTables[b]);
      const start = !!wide && (!!rtlTables[b] || leadSide(style, block, room(b)) === 'R');
      return markedRow(el, `c${b}`, element, floating(fitted([first, second, html]), opensWithCopy(block), start), start);
    }
    const button = second ?
    h(el.Box, { key: `copies${b}`, flexDirection: "row", columnGap: 1 },
    first,
    second,
    html
    ) :
    first;
    return (block.kind === 'quote' || block.kind === 'alert') && !mirrored(style) ?
    h(Box, _extends({ key: `c${b}`, flexDirection: "row", columnGap: 2 }, rtl ? { justifyContent: 'flex-end' } : {}),
    element,
    opensWithCopy(block) ? h(Box, { alignSelf: "flex-end" }, button) : button
    ) :

    h(Box, _extends({ key: `c${b}`, flexDirection: "column" }, mirror ? { width: '100%' } : rtl && (block.kind === 'list' || rtlTables[b]) ? {} : { alignSelf: 'flex-start' }),
    h(Box, { justifyContent: "flex-end" }, button),
    element
    );

  });
  const isFigure = (b) => blocks[b]?.kind === 'table' || drawn.get(b)?.art !== undefined;
  const out = [];
  for (let b = 0; b < rendered.length; b++) {
    if (!isFigure(b) || !isFigure(b + 1)) {
      out.push(copied[b]);
      continue;
    }
    const start = b;
    while (isFigure(b + 1)) b++;
    out.push(
      h(Box, { key: `row${start}`, flexDirection: "row", flexWrap: "wrap", columnGap: 4, rowGap: 1 },
      copied.slice(start, b + 1).map((figure, i) => h(Box, { key: `f${start + i}`, flexShrink: 0 }, figure))
      )
    );
  }
  return out;
};



const VERBS = {
  Bash: 'Ran', PowerShell: 'Ran', Read: 'Read', Write: 'Wrote', Edit: 'Edited', MultiEdit: 'Edited', NotebookEdit: 'Edited',
  Grep: 'Searched', Glob: 'Listed', WebFetch: 'Fetched', WebSearch: 'Searched the web for', Agent: 'Delegated', Task: 'Delegated'
};

const field = (input, ...keys) => {
  if (input === null || typeof input !== 'object') return undefined;
  for (const k of keys) {
    const v = input[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return undefined;
};

const TARGET_FIELDS = ['file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'description'];

const statusColor = (t, row) =>
row.isErrored ? t.codeFlag : row.isInterrupted ? t.codeComment : row.isRunning ? t.accent : t.number;

const toolDim = (style) => style.toolStyle !== "classic";

const toolGutter = ({ Box, Text }, style, color, running) =>
style.toolStyle.startsWith("tree") ?
h(Box, { width: 4, flexShrink: 0 }, h(Text, { color: color }, '  ⎿ ')) :
h(Box, { width: 2, flexShrink: 0 }, h(Text, { color: color }, running ? '◌' : '●'));

const toolLayout = (el, style, columns, label, color, running, text) => {
  const { Box, Text } = el;
  if (style.toolStyle !== "chat") return h(Box, { flexDirection: "row" }, toolGutter(el, style, color, running), text);
  const w = Math.min(width(label) + 2, Math.max(20, Math.floor(columns * 0.6)));
  return (
    h(Box, { flexDirection: "row", justifyContent: "flex-end", width: "100%" },
    h(Box, { width: w, flexDirection: "row" }, text, h(Text, { color: color }, running ? " ◌" : " ●"))
    ));

};



const slashes = (path) => path.replace(/\\/g, '/').replace(/\/+$/, '');

const folded = (path) => /^[a-z]:(\/|$)/i.test(path) ? path.toLowerCase() : path;

const shortPath = (style, path) => {
  const target = folded(slashes(path));
  for (const [root, home] of [[style.cwd, false], [style.home, true]]) {
    const base = folded(slashes(root));
    if (base !== '' && target.startsWith(`${base}/`)) return home ? `~${path.slice(base.length)}` : path.slice(base.length + 1);
  }
  return path;
};

const compactPath = (path) => {
  const parts = path.split('/');
  if (!path.startsWith('/') || parts.length <= 6) return path;
  return [...parts.slice(0, 3), '…', ...parts.slice(-2)].join('/');
};

const sameDir = (a, b) => a !== '' && folded(slashes(a)) === folded(slashes(b));

const shortTarget = (places, path) => sameDir(places.cwd, path) ? '.' : sameDir(places.home, path) ? '~' : compactPath(shortPath(places, path));


const PATH_FIELDS = ['file_path', 'notebook_path', 'path'];

const FILE_TOOLS = new Set(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Grep', 'Glob']);

const toolPath = (tool, path) => tool !== undefined && FILE_TOOLS.has(tool) ? path : undefined;

const targetOf = (style, input, fields) => {
  const target = field(input, ...fields);
  const path = target !== undefined && PATH_FIELDS.some((k) => field(input, k) === target) ? target : undefined;
  return { target: path === undefined ? target : shortPath(style, path), path };
};

const RESULT_LINES = 3;

const renderShellResult = (el, style, output) => {
  const { Box, Text } = el;
  const out = output !== null && typeof output === 'object' ? output : {};
  const shown = [...lines(out.stdout), ...lines(out.stderr)];
  const head = shown.slice(0, RESULT_LINES).map((l) => shortenPaths(l, style));
  return (
    h(Box, { flexDirection: "row" },
    h(Text, { dimColor: true }, '  ⎿  '),
    h(Box, { flexDirection: "column" },
    head.length === 0 ? h(Text, { dimColor: true }, "(No output)") : head.map((l, i) => h(Text, { key: `l${i}`, wrap: "truncate-end" }, l === '' ? ' ' : l)),
    shown.length > head.length ? h(Text, { dimColor: true }, `… +${shown.length - head.length} lines`) : null
    )
    ));

};

const DIFF_LINES = 20;
const DIFF_MAX = Infinity;
const DIFF_EXTRA = Infinity;



const HEX = /^#[0-9a-f]{6}$/i;

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const tint = (base, color, share) => {
  if (!base || !color || !HEX.test(base) || !HEX.test(color)) return undefined;
  const [b, c] = [channels(base), channels(color)];
  return `#${b.map((v, i) => Math.round(v * (1 - share) + c[i] * share).toString(16).padStart(2, '0')).join('')}`;
};

const luminance = (hex) => {
  const [r, g, b] = channels(hex).map((v) => v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const TEXT_CONTRAST = 4.5;

const fullHue = (hex) => {
  const [r, g, b] = channels(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const spread = max - Math.min(r, g, b);
  const lightness = (max + max - spread) / 2;
  if (spread === 0 || spread / (1 - Math.abs(2 * lightness - 1)) < 0.1) return hex;
  const sector = max === r ? ((g - b) / spread + 6) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4;
  const x = 1 - Math.abs(sector % 2 - 1);
  const pure = [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]][Math.floor(sector)];
  return `#${pure.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
};

const diffTint = (text, color) => {
  if (!text || !color || !HEX.test(text) || !HEX.test(color)) return undefined;
  const dark = contrast(text, '#000000') >= contrast(text, '#ffffff');
  const base = dark ? '#000000' : '#ffffff';
  const hue = fullHue(color);
  let share = dark ? 0.3 : 0.2;
  while (share > 0.05 && contrast(text, tint(base, hue, share)) < TEXT_CONTRAST) share -= 0.01;
  return tint(base, hue, share);
};

const leftToEngine = (output, press) => {
  if (output === null || typeof output !== 'object') return false;
  const out = output;
  return out.staged === true || out.type === 'create' && !press;
};

const diffLines = (output) => {
  if (output === null || typeof output !== 'object') return undefined;
  const out = output;
  if (!Array.isArray(out.structuredPatch) || out.structuredPatch.length === 0) return undefined;
  const rows = [];
  for (const [h, hunk] of out.structuredPatch.entries()) {
    if (typeof hunk?.oldStart !== 'number' || typeof hunk.newStart !== 'number' || !Array.isArray(hunk.lines)) return undefined;
    rows.push(...hunkRows(hunk.lines, hunk.oldStart, hunk.newStart, h));
  }
  return rows;
};

const hunkRows = (lines, oldStart, newStart, hunk) => {
  const rows = [];
  let [o, n] = [oldStart, newStart];
  for (const l of lines) {
    if (typeof l !== 'string') continue;
    const mark = l[0] === '+' || l[0] === '-' || l[0] === '\\' ? l[0] : ' ';
    let num = 0;
    if (mark === '-') num = o++;else
    if (mark !== '\\') {
      if (mark === ' ') o++;
      num = n++;
    }
    rows.push({ mark, num, text: l.slice(1).replace(CONTROL, ''), hunk });
  }
  return rows;
};

const realLines = (rows) => rows.filter((r) => r.mark !== '\\').length;

const firstLines = (rows, count) => {
  let [end, seen] = [0, 0];
  while (end < rows.length && (rows[end].mark === '\\' || seen < count)) if (rows[end++].mark !== '\\') seen++;
  return rows.slice(0, end);
};

const EXTENSIONS = {
  mts: 'typescript', cts: 'typescript', mjs: 'javascript', cjs: 'javascript', pyi: 'python', rs: 'rust',
  h: 'c', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', jsonc: 'json', htm: 'html', tf: 'hcl'
};

const pathLanguage = (path) => {
  const name = path?.split(/[\\/]/).pop() ?? '';
  if (/^(Dockerfile|Containerfile)(\.|$)/i.test(name)) return 'dockerfile';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (Object.hasOwn(EXTENSIONS, ext)) return EXTENSIONS[ext];
  return ext && grammarFor(ext) ? ext : undefined;
};

const lifted = new Map();

const onTint = (color, bg) => {
  if (!color || !HEX.test(color) || !HEX.test(bg) || contrast(color, bg) >= TEXT_CONTRAST) return color;
  return remember(lifted, `${color}${bg}`, () => {
    const toward = contrast(bg, '#ffffff') >= contrast(bg, '#000000') ? '#ffffff' : '#000000';
    let share = 0;
    while (share < 1 && contrast(tint(color, toward, share), bg) < TEXT_CONTRAST) share = Math.min(1, share + 0.02);
    return tint(color, toward, share);
  });
};

const fileSegments = (style, path, lines) => {
  const lang = pathLanguage(path);
  return (lang === undefined ? null : segmentRows(style, lines, lang)) ?? lines.map((text) => text ? [{ text, italic: false }] : []);
};

const diffSegments = (style, rows, path) => {
  const out = rows.map((r) => (r.mark === '-' || r.mark === '\\') && r.text ? [{ text: r.text, italic: false }] : []);
  let start = 0;
  while (start < rows.length) {
    let end = start;
    while (end < rows.length && rows[end].hunk === rows[start].hunk) end++;
    const after = Array.from({ length: end - start }, (_, i) => start + i).filter((r) => rows[r].mark === ' ' || rows[r].mark === '+');
    const now = fileSegments(style, path, after.map((r) => rows[r].text));
    after.forEach((r, i) => out[r] = now[i]);
    start = end;
  }
  return out;
};

const WORD_SHARE = 0.3;

const wordTint = (text, color) => {
  const row = diffTint(text, color);
  return row && tint(row, color, WORD_SHARE);
};

const WORD = /\w+|\s+|[^\w\s]/g;
const WORD_CELLS = 40000;
const WORD_CHANGE = 0.5;

const solid = (unit) => /\S/.test(unit);

const unitsOf = (segs) => segs.flatMap((s) => s.text.match(WORD) ?? []);

const keptUnits = (a, b) => {
  const width = b.length + 1;
  const lcs = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) lcs[i * width + j] = a[i] === b[j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
  }
  const kept = [a.map(() => false), b.map(() => false)];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) kept[0][i++] = kept[1][j++] = true;else
    if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) i++;else
    j++;
  }
  return kept;
};

const changedUnits = (units, kept) => {
  const changed = units.map((u, i) => !kept[i] && solid(u));
  return units.map((_, i) => changed[i] || !kept[i] && changed[i - 1] === true && changed[i + 1] === true);
};

const weight = (units, flags) => units.reduce((n, u, i) => solid(u) && (!flags || flags[i]) ? n + u.length : n, 0);

const wordDiffs = new Map();

const wordDiff = (a, b) => {
  if (a.length * b.length > WORD_CELLS) return null;
  return remember(wordDiffs, `${a.join('\u0001')}\n${b.join('\u0001')}`, () => {
    const kept = keptUnits(a, b);
    const flags = [changedUnits(a, kept[0]), changedUnits(b, kept[1])];
    const changed = weight(a, flags[0]) + weight(b, flags[1]);
    return changed === 0 || changed > (weight(a) + weight(b)) * WORD_CHANGE ? null : flags;
  });
};

const runOf = (rows, from, mark, hunk) => {
  const at = [];
  let end = from;
  for (; end < rows.length && rows[end].hunk === hunk && (rows[end].mark === mark || rows[end].mark === '\\'); end++) if (rows[end].mark === mark) at.push(end);
  return [at, end];
};

const wordFlags = (rows, segments) => {
  const flags = rows.map(() => null);
  for (let i = 0; i < rows.length;) {
    if (rows[i].mark !== '-') {
      i++;
      continue;
    }
    const [removed, mid] = runOf(rows, i, '-', rows[i].hunk);
    const [added, end] = runOf(rows, mid, '+', rows[i].hunk);
    for (let k = 0; k < Math.min(removed.length, added.length); k++) {
      const diff = wordDiff(unitsOf(segments[removed[k]]), unitsOf(segments[added[k]]));
      if (diff) [flags[removed[k]], flags[added[k]]] = diff;
    }
    i = Math.max(end, i + 1);
  }
  return flags;
};



const merged = (pieces) =>
pieces.reduce((acc, p) => {
  const last = acc[acc.length - 1];
  if (last && last.color === p.color && last.italic === p.italic && last.word === p.word) acc[acc.length - 1] = { ...last, text: last.text + p.text };else
  acc.push(p);
  return acc;
}, []);

const wordPieces = (segs, flags) => {
  let u = 0;
  return merged(segs.flatMap((s) => flags ? (s.text.match(WORD) ?? []).map((text) => ({ ...s, text, word: flags[u++] })) : [{ ...s, word: false }]));
};

const TAB = 8;

const tabbed = (pieces) => {
  if (!pieces.some((p) => p.text.includes('\t'))) return pieces;
  let col = 0;
  return pieces.map((p) => {
    let text = '';
    for (const g of graphemes(p.text)) {
      const out = g === '\t' ? ' '.repeat(TAB - col % TAB) : g;
      text += out;
      col += width(out);
    }
    return { ...p, text };
  });
};

const cutAt = (blank, space, from, at) => blank || space <= from ? at : space;

const rowStarts = (text, room) => {
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
    if (!blank) seen = true;else
    if (seen) space = at;
  }
  return starts;
};

const splitRows = (pieces, starts) => {
  const rows = starts.map(() => []);
  let [at, r] = [0, 0];
  for (const p of pieces) {
    for (let from = 0; from < p.text.length;) {
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

const visualRows = (pieces, room) => {
  const text = pieces.map((p) => p.text).join('');
  return room === undefined || room < DIFF_ROOM || width(text) <= room ? [pieces] : splitRows(pieces, rowStarts(text, room));
};

const lift = (color, band) => {
  const lifted = band && color ? onTint(color, band) : undefined;
  return lifted && lifted !== color ? { hover: { color: lifted } } : {};
};

const drawCode = ({ Text }, style, pieces, bg, word, key, band) => {
  if (!pieces.length) return ' ';
  return pieces.map((p, j) => {
    const lit = p.word && word !== undefined;
    if (!lit && !p.color && !p.italic) return p.text;
    const on = lit ? word : bg;
    return h(Text, _extends({ key: `${key}.${j}`, color: on ? onTint(p.color ?? style.theme.codeText, on) : p.color, italic: p.italic }, lit ? { backgroundColor: word } : lift(p.color, band)), p.text);
  });
};



const spend = (budget, cost) => {
  if (cost > budget.left) return false;
  budget.left -= cost;
  return true;
};

const filePieces = (style, path, lines) => fileSegments(style, path, lines).map((segs) => tabbed(wordPieces(segs, null)));

const onBand = (color, band) => {
  const lifted = band && color ? onTint(color, band) : undefined;
  return lifted ? { hover: { color: lifted } } : {};
};

const muted = (style, band) => onBand(style.theme.codeComment ?? style.theme.codeText, band);

const numberedLine = (el, style, label, pieces, key, band) => [
h(el.Text, _extends({ key: `${key}.g`, color: style.theme.codeComment, dimColor: true }, muted(style, band)), heldLabel(style, label, pieceText(pieces))),
h(el.Text, _extends({ key: `${key}.c`, color: style.theme.codeText }, lift(style.theme.codeText, band)), drawCode(el, style, pieces, undefined, undefined, `${key}.c`, band))];


const partCost = (part) => Math.max(1, part.reduce((m, p) => m + (p.color || p.italic || p.word ? 2 : 1), 0));

const lineCost = (parts, bar, note, row = 0) =>
parts.reduce((n, part) => n + (bar ? 8 : 6) + row + partCost(part), 0) - (note ? 0 : bar ? 9 : 7);

const plainParts = (text) => [text ? [{ text, italic: false, word: false }] : []];





const UNTINTED = { '+': undefined, '-': undefined, ' ': undefined, '\\': undefined };

const markColors = (theme) => ({ ...UNTINTED, '+': theme.diffAdded ?? theme.number, '-': theme.diffRemoved ?? theme.codeFlag, '\\': theme.codeText });

const diffPaint = (style, gutter) => {
  const t = style.theme;
  const marks = markColors(t);
  const tinted = style.diffStyle === 'card' || style.diffStyle === 'full';
  const lines = { ...UNTINTED, '+': diffTint(t.codeText, marks['+']), '-': diffTint(t.codeText, marks['-']) };
  return {
    look: style.diffStyle,
    gutter,
    marks,
    tints: tinted ? lines : UNTINTED,
    words: tinted ? { ...UNTINTED, '+': wordTint(t.codeText, marks['+']), '-': wordTint(t.codeText, marks['-']) } : lines
  };
};

const codeRoom = (paint, columns) =>
columns === undefined ? undefined : columns - 5 - (paint.look === 'card' ? 4 : 0) - (paint.look === 'bar' ? 2 : 0) - paint.gutter - 3;

const barOf = (mark) => mark === ' ' || mark === '\\' ? '  ' : '▌ ';

const markOf = (mark) => mark === '\\' ? '  ' : `${mark} `;

const numberOf = (paint, r, k) => `${k || r.mark === '\\' ? ' '.repeat(paint.gutter) : String(r.num).padStart(paint.gutter)} `;

const lineRows = (el, style, paint, r, i, parts) => {
  const bg = paint.tints[r.mark];
  return parts.map((part, k) =>
  h(el.Box, _extends({ key: k ? `d${i}.${k}` : `d${i}`, flexDirection: "row" }, bg ? { backgroundColor: bg } : {}),
  lineText(el, style, paint, r, `d${i}.${k}`, k, part, 0, false)
  )
  );
};





const diffShape = (style, shown, path, columns) => {
  const paint = diffPaint(style, String(Math.max(0, ...shown.map((r) => r.num))).length);
  const segments = diffSegments(style, shown, path);
  const flags = wordFlags(shown, segments);
  const room = codeRoom(paint, columns);
  return {
    paint,
    room,
    lines: shown.map((r, i) => ({ r, i, parts: visualRows(tabbed(wordPieces(segments[i], flags[i] ?? null)), room), gap: i > 0 && r.hunk !== shown[i - 1].hunk }))
  };
};

const gapRow = (el, paint, key) => h(el.Text, { key: key, dimColor: true }, paint.look === 'bar' ? '  ...' : '...');

const TEXT_ROW = 2;

const afforded = (line, paint, budget, row) => {
  const gap = line.gap && spend(budget, 2);
  if (spend(budget, lineCost(line.parts, paint.look === 'bar', line.r.mark === '\\', row))) return { ...line, gap };
  return { ...line, gap, parts: line.r.mark === '\\' ? [] : plainParts(line.r.text) };
};

const diffBody = (el, style, shown, path, columns, budget) => {
  const { paint, lines } = diffShape(style, shown, path, columns);
  return lines.map((line) => afforded(line, paint, budget, 0)).flatMap(({ r, i, parts, gap }) => [...(gap ? [gapRow(el, paint, `gap${i}`)] : []), ...lineRows(el, style, paint, r, i, parts)]);
};

const lineText = (el, style, paint, r, key, k, part, pad, fill = true) => {
  const { Text } = el;
  const bg = paint.tints[r.mark];
  const on = bg && fill ? { backgroundColor: bg } : {};
  const code = style.theme.codeText;
  return [
  ...(paint.look === 'bar' ? [h(Text, _extends({ key: `${key}.b`, color: paint.marks[r.mark] }, on), barOf(r.mark))] : []),
  h(Text, _extends({ key: `${key}.n`, dimColor: true }, on), heldLabel(style, numberOf(paint, r, k), r.text)),
  h(Text, _extends({ key: `${key}.m`, color: paint.marks[r.mark], dimColor: r.mark === ' ' }, on), markOf(r.mark)),
  h(Text, _extends({ key: `${key}.c`, color: bg ? onTint(code, bg) : code }, on), drawCode(el, style, part, bg, paint.words[r.mark], key)),
  ...(bg && pad > 0 ? [h(Text, _extends({ key: `${key}.p` }, on), ' '.repeat(pad))] : [])];

};

const diffText = (el, style, shown, path, columns, budget) => {
  const { paint, room, lines } = diffShape(style, shown, path, columns);
  const kept = lines.map((line) => afforded(line, paint, budget, TEXT_ROW));
  const lead = (paint.look === 'bar' ? 2 : 0) + paint.gutter + 3;
  const used = (part) => lead + (part.length ? width(part.map((p) => p.text).join('')) : 1);
  const fits = room !== undefined && room >= DIFF_ROOM;
  const span = !fits ? 0 : paint.look === 'full' ? lead + room : Math.max(0, ...kept.flatMap((l) => l.parts.map(used)));
  const rows = kept.flatMap(({ r, i, parts, gap }) => [
  ...(gap ? [[gapRow(el, paint, `t${i}.g`)]] : []),
  ...parts.map((part, k) => lineText(el, style, paint, r, `t${i}.${k}`, k, part, span - used(part)))]
  );
  return h(el.Text, { key: "rows" }, rows.flatMap((row, n) => n ? ['\n', ...row] : row));
};

const diffBox = (el, style, rows, fold, id, key, path, budget, columns, title) => {
  const { Box, Text } = el;
  const t = style.theme;
  const added = rows.filter((r) => r.mark === '+').length;
  const removed = rows.filter((r) => r.mark === '-').length;
  const total = realLines(rows);
  const toggle = total > DIFF_LINES ? fold?.(id, total - DIFF_LINES, `fold${key}`) : null;
  const shown = firstLines(rows, toggle?.folded === false ? DIFF_MAX : DIFF_LINES);
  const hidden = total - realLines(shown);
  const marks = markColors(t);
  const frame = style.diffStyle === 'card' ? { borderStyle: 'round', borderColor: t.rule, paddingX: 1 } : {};
  const head =
  h(Text, { key: "head" },
  title === undefined ? null : h(Text, { color: t.path }, style.pressPreview === true && toggle?.around ? `${title} ` : drawPieces(el, style, [{ text: title, path }, { text: ' ' }])),
  h(Text, { color: marks['+'], dimColor: added === 0 }, `+${added}`),
  h(Text, null, " "),
  h(Text, { color: marks['-'], dimColor: removed === 0 }, `−${removed}`)
  );

  const press = style.pressPreview === true ? toggle?.around : undefined;
  return (
    h(Box, _extends({ key: `card${key}`, flexDirection: "column", flexShrink: 1 }, frame),
    press ? press(h(Text, { key: "all" }, head, '\n', diffText(el, style, shown, path, columns, budget)), { inverse: false }) : [head, ...diffBody(el, style, shown, path, columns, budget)],
    hidden > 0 && toggle?.folded !== true ? h(Text, { dimColor: true }, `… +${hidden} lines`) : null,
    toggle?.element ?? null
    ));

};

const diffRow = (el, style, cards, below) =>
h(el.Box, { flexDirection: "row" },
h(el.Text, { dimColor: true }, below ? '     ' : '  ⎿  '),
h(el.Box, _extends({ flexDirection: "column", flexShrink: 1 }, style.diffStyle === 'full' ? { flexGrow: 1 } : { alignItems: 'flex-start' }), cards)
);


const editedIntoBeing = (output, rows) => {
  const out = output;
  const fresh = out.oldString === '' && (out.originalFile === null || out.originalFile === '') && rows.every((r) => r.mark === '+' || r.mark === '\\');
  return fresh && typeof out.filePath === 'string' ? { kind: 'created', path: out.filePath, lines: rows.filter((r) => r.mark === '+').map((r) => r.text) } : undefined;
};

const written = (output) => {
  const out = output;
  return out.type === 'create' && typeof out.filePath === 'string' && typeof out.content === 'string' ? { kind: 'created', path: out.filePath, lines: lines(out.content) } : undefined;
};

const renderDiffCard = (el, style, output, fold, id, columns) => {
  const budget = { left: DIFF_EXTRA };
  const write = written(output);
  if (write) return diffRow(el, style, [wholeFileCard(el, style, write, fold, id, '', budget, columns, false)], false);
  const rows = diffLines(output);
  if (rows === undefined) return undefined;
  const made = editedIntoBeing(output, rows);
  const path = output.filePath;
  return diffRow(el, style, [made ? wholeFileCard(el, style, made, fold, id, '', budget, columns) : diffBox(el, style, rows, fold, id, '', typeof path === 'string' ? path : undefined, budget, columns)], false);
};







const EDIT_NOTES = {
  first: 'every file that changed while this ran, by this command or anything else: a view of the changes, not an audit of the command',
  shared: 'another command ran in this repository at the same time, so changes by either may show under either one',
  tree: 'a git step in this command can move the working tree, so these may be its changes rather than edits'
};

const bashEdits = (output) => {
  if (output === null || typeof output !== 'object') return undefined;
  const diff = output.bashEditDiff;
  if (diff === null || typeof diff !== 'object') return undefined;
  const { files, moreFiles, shared } = diff;
  if (!Array.isArray(files) || files.length === 0) return undefined;
  const changed = files.map(fileChange);
  if (!changed.every((f) => f !== undefined)) return undefined;
  return { files: renamed(changed), more: typeof moreFiles === 'number' && moreFiles > 0 ? moreFiles : 0, shared: shared === true };
};

const fileChange = (entry) => {
  const file = entry;
  const kind = file?.created === true ? 'created' : file?.deleted === true ? 'deleted' : 'modified';
  const rows = kind !== 'modified' && Array.isArray(file?.hunks) && file.hunks.length === 0 ? [] : diffLines({ structuredPatch: file?.hunks });
  if (typeof file?.filePath !== 'string' || rows === undefined) return undefined;
  if (kind === 'modified') return { kind, path: file.filePath, rows };
  const mark = kind === 'created' ? '+' : '-';
  return { kind, path: file.filePath, lines: rows.filter((r) => r.mark === mark).map((r) => r.text) };
};

const pairable = (file) => (file.kind === 'created' || file.kind === 'deleted') && file.lines.length > 0;

const sameLines = (a, b) => a.length === b.length && a.every((line, i) => line === b[i]);

const renamed = (files) => {
  const paired = new Set();
  const out = [];
  for (const file of files) {
    if (paired.has(file)) continue;
    const twin = pairable(file) ? files.find((other) => !paired.has(other) && pairable(other) && other.kind !== file.kind && sameLines(other.lines, file.lines)) : undefined;
    if (!twin) {
      out.push(file);
      continue;
    }
    paired.add(file).add(twin);
    const [from, to] = file.kind === 'deleted' ? [file, twin] : [twin, file];
    out.push({ kind: 'renamed', path: from.path, to: to.path });
  }
  return out;
};

const withoutBashEdits = (output) => {
  if (output === null || typeof output !== 'object') return output;
  const { bashEditDiff: _, ...rest } = output;
  return rest;
};

const hasShellOutput = (output) => {
  const out = output !== null && typeof output === 'object' ? output : {};
  return lines(out.stdout).length + lines(out.stderr).length > 0;
};

const PREVIEW_LINES = 10;

const lineCount = (n) => n === 0 ? 'empty' : `${n} ${n === 1 ? 'line' : 'lines'}`;

const BAND_SHARE = 0.12;
const BAND_FLOOR = 0.06;
const BAND_STEP = 1.2;
const BAND_MOST = 0.4;

const previewInks = (theme) =>
[theme.codeText, ...Object.values(PRISM_COLORS).map((k) => theme[k])].filter((c) => c !== undefined && HEX.test(c));

const stepped = (share, by) => Math.round((share + by) * 100) / 100;

const bandFrom = (background, text) => {
  let share = 0.02;
  while (share < BAND_MOST && contrast(tint(background, text, share), background) < BAND_STEP) share = stepped(share, 0.01);
  return tint(background, text, share);
};

const previewBand = (theme, background) => {
  const text = theme.codeText;
  if (!text || !HEX.test(text)) return undefined;
  if (background && HEX.test(background)) return bandFrom(background, text);
  const base = contrast(text, '#000000') >= contrast(text, '#ffffff') ? '#000000' : '#ffffff';
  const inks = previewInks(theme).filter((c) => contrast(c, base) >= TEXT_CONTRAST);
  let share = BAND_SHARE;
  while (share > BAND_FLOOR && inks.some((c) => contrast(c, tint(base, text, share)) < TEXT_CONTRAST)) share = stepped(share, -0.01);
  return tint(base, text, share);
};

const PREVIEW_ROW = 4;
const PLAIN_LINE = 7;

const previewRows = (pieces, text, room, budget) => {
  const rich = visualRows(pieces, room);
  if (spend(budget, Math.max(0, rich.reduce((n, part) => n + PREVIEW_ROW + partCost(part), 0) - PLAIN_LINE))) return rich;
  return [tabbed(plainParts(text)[0])];
};

const previewText = (el, style, path, shown, key, band, columns, budget) => {
  const gutter = String(shown.length).length;
  const room = columns === undefined ? undefined : columns - 5 - gutter - 2;
  return filePieces(style, path, shown).flatMap((pieces, i) =>
  previewRows(pieces, shown[i], room, budget).flatMap((part, k) => [
  ...(i || k ? ['\n'] : []),
  ...numberedLine(el, style, k ? ' '.repeat(gutter + 2) : `${String(i + 1).padStart(gutter)}  `, part, `${key}.${i}.${k}`, band)]
  ));
};

const wholeHead = (el, style, file, band) =>
h(el.Text, { key: "head" },
band ? h(el.Text, onBand(style.theme.codeText, band), 'Created ') : file.kind === 'created' ? 'Created ' : 'Deleted ',
h(el.Text, _extends({ color: style.theme.path }, lift(style.theme.path, band)), shortPath(style, file.path)),
h(el.Text, _extends({ dimColor: true }, muted(style, band)), ` (${lineCount(file.lines.length)})`)
);




const wholeRows = (el, style, file, shown, { marked, press, band, columns, budget }) => {
  const lines = file.lines.slice(0, shown);
  if (lines.length === 0) return null;
  if (!marked) return h(el.Text, { key: "rows" }, previewText(el, style, file.path, lines, 'rows', band, columns, budget));
  const diff = lines.map((text, i) => ({ mark: file.kind === 'created' ? '+' : '-', num: i + 1, text, hunk: 0 }));
  return press ? diffText(el, style, diff, file.path, columns, budget) : h(el.Box, { key: "rows", flexDirection: "column" }, diffBody(el, style, diff, file.path, columns, budget));
};



const wholeToggle = (fold, file, head, id, key) => {
  const n = file.lines.length;
  if (file.kind === 'created') return n > PREVIEW_LINES ? fold(id, n - PREVIEW_LINES, `fold${key}`) : null;
  return n > 0 ? fold(id, n, `fold${key}`, { label: `show ${lineCount(n)}`, face: () => head }) : null;
};

const wholeBody = (el, style, file, head, rows, toggle, band) => {
  const press = style.pressPreview === true ? toggle?.around : undefined;
  const hover = { inverse: false, ...(band ? { backgroundColor: band } : {}) };
  if (press && file.kind === 'created') return press(h(el.Text, { key: "all" }, wholeHead(el, style, file, band), rows ? ['\n', rows] : null), hover);
  return [toggle?.faced ? toggle.element : head, rows && press ? press(rows, hover) : rows];
};

const wholeFileCard = (el, style, file, fold, id, key, budget, columns, marked = true) => {
  const n = file.lines.length;
  const created = file.kind === 'created';
  const head = wholeHead(el, style, file);
  const toggle = wholeToggle(fold, file, head, id, key);
  const shown = Math.min(n, toggle?.folded === false ? DIFF_MAX : created ? PREVIEW_LINES : 0);
  const press = style.pressPreview === true && toggle?.around !== undefined;
  const band = press && !marked ? previewBand(style.theme, style.background) : undefined;
  const rows = wholeRows(el, style, file, shown, { marked, press, band, columns, budget });
  const rest = n > shown && (toggle ? !toggle.folded : created);
  return (
    h(el.Box, { key: `file${key}`, flexDirection: "column" },
    wholeBody(el, style, file, head, rows, toggle, band),
    rest ? h(el.Text, { key: "rest", dimColor: true }, `… +${n - shown} lines`) : null,
    toggle && !toggle.faced ? toggle.element : null
    ));

};

const renamedLine = (el, style, from, to, key) =>
h(el.Text, { key: `file${key}` },
'Renamed ',
h(el.Text, { color: style.theme.path }, shortPath(style, from)),
' → ',
h(el.Text, { color: style.theme.path }, shortPath(style, to))
);


const renderBashEdits = (el, style, edits, fold, id, below = false, notes = [], columns) => {
  const budget = { left: DIFF_EXTRA };
  const cards = edits.files.map((file, i) =>
  file.kind === 'modified' ? diffBox(el, style, file.rows, fold, `${id}:${i}`, String(i), file.path, budget, columns, shortPath(style, file.path)) :
  file.kind === 'renamed' ? renamedLine(el, style, file.path, file.to, String(i)) :
  wholeFileCard(el, style, file, fold, `${id}:${i}`, String(i), budget, columns));
  const more = edits.more ? [h(el.Text, { key: "more", dimColor: true }, `… +${edits.more} more ${edits.more === 1 ? 'file' : 'files'}`)] : [];
  const said = notes.map((note, i) => h(el.Text, { key: `note${i}`, dimColor: true }, `(${note})`));
  return diffRow(el, style, [...cards, ...more, ...said], below);
};

const TREE_MOVERS = new Set(['checkout', 'switch', 'stash', 'pull', 'merge', 'rebase', 'reset', 'restore', 'clean', 'cherry-pick', 'revert']);

const gitSubcommand = (args) => {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) return arg;
    if (arg === '-C' || arg === '-c') i++;
  }
  return undefined;
};

const editNotes = (edits, first, command) => [
...(first ? [EDIT_NOTES.first] : []),
...(edits.shared ? [EDIT_NOTES.shared] : []),
...(command !== undefined && movesTree(command) ? [EDIT_NOTES.tree] : [])];


const movesTree = (command) =>
parseShell(command).segments.some(({ words }) => {
  const argv = commandWords(words);
  const [name, ...rest] = argv[0] === 'sudo' ? argv.slice(1) : argv;
  return name?.split('/').pop() === 'git' && TREE_MOVERS.has(gitSubcommand(rest) ?? '');
});

const NOISE_LINES = /^((Error:\s*)?Exit code \d+|at\s+(\S+\s+\()?\S+:\d+(:\d+)?\)?|Node\.js v\d.*|exit status \d+|\.\.\. \d+ more)$/i;

const REFUSAL = /^(Error:\s*)?(The user doesn't want to proceed|Permission (for|to) .*\bdenied|The server-side auto mode classifier|\S+ hook error:)/i;

const refusalReason = (output) => {
  if (typeof output !== 'string' || /^(Error:\s*)?Exit code \d+/m.test(output) || !REFUSAL.test(output)) return undefined;
  return output.replace(/\s+/g, ' ').trim();
};

const rememberCall = (calls, id, limit = 2000) => {
  calls.delete(id);
  calls.add(id);
  if (calls.size > limit) calls.delete(calls.values().next().value);
};

const errorReason = (output) => {
  const out = output !== null && typeof output === 'object' ? output : {};
  const text = typeof output === 'string' ? output : typeof out.stderr === 'string' && out.stderr.trim() ? out.stderr : out.stdout;
  if (typeof text !== 'string') return undefined;
  return text.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !NOISE_LINES.test(l)).at(-1);
};

const renderFailure = (el, style, output, key) => {
  const refusal = refusalReason(output);
  const reason = refusal ?? errorReason(output);
  if (reason === undefined) return undefined;
  const chat = style.toolStyle === 'chat';
  return (
    h(el.Box, { key: key, flexDirection: "row", width: "100%", justifyContent: chat ? 'flex-end' : 'flex-start' },
    h(el.Text, { color: style.theme.codeFlag, wrap: refusal === undefined ? 'truncate-middle' : 'wrap' }, `${chat ? '' : '  ⎿ '}${refusal ?? shortenPaths(reason, style)}`)
    ));

};

const shellLabel = (call, style) => {
  const command = field(call.input, 'command') ?? '';
  const plain = call.tool === 'Bash' ? describeShell(command, style) : undefined;
  if (plain) return plain;
  const description = field(call.input, 'description');
  if (description === undefined) return `Ran ${shortenPaths(command.split('\n')[0], style)}`;
  const programs = call.tool === 'Bash' ? programsOf(command) : [];
  return programs.length ? `${description} · ${programs.join(', ')}` : description;
};

const callPieces = (call, style) => {
  if (call.tool === 'Bash' || call.tool === 'PowerShell') return [{ text: shellLabel(call, style) }];
  if (call.tool === 'Grep') {
    const pattern = field(call.input, 'pattern');
    const path = field(call.input, 'path');
    if (pattern !== undefined) return path === undefined ? [{ text: `Searched . for "${pattern}"` }] : [{ text: 'Searched ' }, { text: shortTarget(style, path), path }, { text: ` for "${pattern}"` }];
  }
  const verb = call.tool === 'Skill' ? 'Loaded skill' : VERBS[call.tool] ?? call.tool.replace(/^mcp__([^_]+)__/, '$1 ');
  const target = field(call.input, 'skill', ...TARGET_FIELDS);
  const args = call.tool === 'Skill' ? field(call.input, 'args') : undefined;
  if (target === undefined) return [{ text: verb }];
  const path = toolPath(call.tool, PATH_FIELDS.some((k) => field(call.input, k) === target) ? target : undefined);
  return [{ text: `${verb} ` }, { text: shortTarget(style, target), path }, ...(args ? [{ text: ` ${args}` }] : [])];
};

const quietToolRow = (el, style, row, columns) => {
  const t = style.theme;
  const dot = statusColor(t, row);
  const pieces = callPieces(row, style);
  const label = `${pieceText(pieces)}${row.isInterrupted ? ' interrupted' : row.isErrored ? ' failed' : ''}`;
  return toolLayout(el, style, columns, label, dot, row.isRunning,
  h(el.Text, { wrap: "truncate-end", dimColor: toolDim(style) },
  drawPieces(el, style, pieces),
  row.isInterrupted ? h(el.Text, { dimColor: true }, " interrupted") : row.isErrored ? h(el.Text, { color: t.codeFlag }, " failed") : null
  )
  );
};

const renderToolRow = (el, style, row, columns = 100) => {
  if (style.toolOutput === 'quiet') return quietToolRow(el, style, row, columns);
  const { Text } = el;
  const t = style.theme;
  const isShell = row.tool === 'Bash' || row.tool === 'PowerShell';
  const verb = VERBS[row.tool] ?? row.tool.replace(/^mcp__([^_]+)__/, '$1 ');
  const found = isShell ? { target: field(row.input, 'command')?.split('\n')[0] } : targetOf(style, row.input, TARGET_FIELDS);
  const target = found.target;
  const dot = statusColor(t, row);
  const isPath = target !== undefined && (found.path !== undefined || /^(~|\.{0,2}\/|[A-Za-z]:\\)/.test(target));

  const label = `${verb}${target === undefined ? "" : ` ${target}`}${row.isInterrupted ? " interrupted" : row.isErrored ? " failed" : ""}`;
  return toolLayout(el, style, columns, label, dot, row.isRunning,
  h(Text, { wrap: "truncate-end", dimColor: toolDim(style) },
  h(Text, { bold: !toolDim(style), dimColor: toolDim(style) }, verb),
  target === undefined ? null : h(Text, null, " "),
  target === undefined ? null : isShell ? codeLine(el, style, target, 'bash', 'cmd') : h(Text, { color: isPath ? t.path : t.inlineCode, dimColor: toolDim(style) }, drawPieces(el, style, [{ text: target, path: toolPath(row.tool, found.path) }])),
  row.isInterrupted ? h(Text, { dimColor: true }, " interrupted") : row.isErrored ? h(Text, { color: t.codeFlag }, " failed") : null
  )
  );
};

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch', 'Skill']);

const READ_COMMANDS = new Set([
'awk', 'basename', 'cat', 'cd', 'column', 'cut', 'diff', 'dirname', 'du', 'echo', 'file', 'find', 'grep', 'head', 'jq', 'less',
'ls', 'nl', 'pdftotext', 'printf', 'pwd', 'readlink', 'realpath', 'rg', 'sed', 'sort', 'stat', 'tail', 'test', 'tr', 'tree',
'true', 'uniq', 'wc', 'which']
);

const READ_SUBCOMMANDS = {
  git: /^(log|show|diff|status|blame|grep|ls-files|rev-parse|branch --show-current)\b/,
  gh: /^((pr|issue|run|release) (view|list|diff|checks)|search)\b/
};

const flagValue = (args, i, flag) => {
  const arg = args[i];
  return arg === flag ? args[i + 1] ?? '' : arg.slice(flag.length).replace(/^=/, '');
};

const ghApiReadsOnly = (rest) =>
!rest.some((a, i) => {
  if (/^(-[fF]|--field|--raw-field|--input)/.test(a)) return true;
  if (!/^(-X|--method)/.test(a)) return false;
  return !/^GET$/i.test(flagValue(rest, i, a.startsWith('--') ? '--method' : '-X'));
});



const HEREDOC = /<<(?!<)-?\s*(['"]?)([A-Za-z_][\w-]*)\1/g;

const dropHeredocBodies = (command) => {
  const lines = command.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    for (const [,, end] of line.matchAll(HEREDOC)) {
      while (i + 1 < lines.length && lines[i + 1].trim() !== end) i++;
      i++;
    }
  }
  return out.join('\n');
};

const parseShell = (source) => {
  const command = dropHeredocBodies(source);
  const segments = [{ words: [], piped: false }];
  let word = '';
  let quote = '';
  let started = false;
  let redirects = false;
  const current = () => segments[segments.length - 1];
  const endWord = () => {
    if (started) current().words.push(word);
    word = '';
    started = false;
  };
  const endSegment = (piped) => {
    endWord();
    if (current().words.length) segments.push({ words: [], piped });else
    current().piped = piped;
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = '';else
      if (ch === '\\' && quote === '"' && /[$`"\\\n]/.test(command[i + 1] ?? '')) word += command[++i];else
      word += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (ch === '\\' && command[i + 1] === '\n') {
      i++;
    } else if (ch === '\\' && i + 1 < command.length) {
      word += command[++i];
      started = true;
    } else if (ch === '\n' || ch === ';') {
      endSegment(false);
    } else if (ch === '&' && command[i + 1] === '&') {
      i++;
      endSegment(false);
    } else if (ch === '&' && command[i + 1] !== '>' && command[i - 1] !== '|' && command[i - 1] !== '>') {
      endSegment(false);
    } else if (ch === '|') {
      const or = command[i + 1] === '|';
      if (or) i++;
      endSegment(!or);
    } else if (ch === '>' || ch === '<') {
      const harmless = ch === '>' && /^(&\d|\s*\/dev\/null)/.exec(command.slice(i + 1));
      if (harmless) i += harmless[0].length;else
      redirects = true;
      if (/^(\d|&)$/.test(word)) {
        word = '';
        started = false;
      }
      endWord();
    } else if (/\s/.test(ch)) {
      endWord();
    } else {
      word += ch;
      started = true;
    }
  }
  endWord();
  return { segments: segments.filter((s) => s.words.length), redirects };
};

const isAssignment = (word) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);

const LEADING_KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{', '(', 'time']);
const HEADER_KEYWORDS = new Set(['for', 'select', 'done', 'fi', 'esac', '}', ')']);

const commandWords = (words) => {
  let i = 0;
  while (i < words.length && (isAssignment(words[i]) || LEADING_KEYWORDS.has(words[i]))) i++;
  return HEADER_KEYWORDS.has(words[i] ?? '') ? [] : words.slice(i);
};

const readsOnly = ({ words }) => {
  const [name, ...rest] = commandWords(words);
  if (name === undefined) return true;
  const args = rest.join(' ');
  if (name === 'gh' && rest[0] === 'api') return ghApiReadsOnly(rest.slice(1));
  if (Object.hasOwn(READ_SUBCOMMANDS, name)) return READ_SUBCOMMANDS[name].test(args) && !(name === 'git' && rest.some((a) => /^--output\b/.test(a)));
  if (!READ_COMMANDS.has(name)) return false;
  if (name === 'sed') {
    const [script, ...files] = rest.filter((a) => a !== '-n');
    return script !== undefined && /^\d+(,\d+)?p$/.test(script) && files.every((f) => !f.startsWith('-'));
  }
  if (name === 'find') return !rest.some((a) => /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/.test(a));
  if (name === 'awk') return !rest.some((a) => /^(-f|--file|-i|--include|-E|--exec|-l|--load)/.test(a)) && !/system\s*\(|getline|@(include|load)|[|>]/.test(args);
  if (name === 'sort') return !rest.some((a) => /^(-[A-Za-z]*o|--output)/.test(a));
  if (name === 'uniq') return operandsOf(name, rest).length < 2;
  if (name === 'tree') return !rest.some((a) => /^(-o|--output)/.test(a));
  if (name === 'rg') return !rest.some((a) => /^--pre/.test(a));
  if (name === 'pdftotext') return rest.at(-1) === '-';
  return true;
};

const isReadOnlyCall = (tool, input) => {
  if (READ_TOOLS.has(tool)) return true;
  if (tool !== 'Bash' && tool !== 'PowerShell') return false;
  const command = field(input, 'command');
  if (command === undefined) return false;
  if (/\$\(|`|<<|\btee\b/.test(command)) return false;
  const shell = parseShell(command);
  return !shell.redirects && shell.segments.every(readsOnly);
};

const TRIVIAL_PROGRAMS = new Set(['cd', 'echo', 'export', 'printf', 'pwd', 'set', 'test', 'true']);

const programsOf = (command) => {
  const names = [];
  for (const part of parseShell(command).segments) {
    const name = commandWords(part.words)[0]?.split('/').pop();
    if (name && !TRIVIAL_PROGRAMS.has(name) && !names.includes(name)) names.push(name);
  }
  return names.length > 3 ? [...names.slice(0, 3), '…'] : names;
};

const shortenPaths = (text, places) => {
  const prefix = (path) => new RegExp(`(?<![\\w.~:/-])${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`, 'g');
  let out = text;
  if (places.cwd) out = out.replace(prefix(places.cwd), '');
  if (places.home) out = out.replace(prefix(places.home), '~/');
  return out.replace(/(?<![\w.~:/-])\/[^\s'"`;|&<>()]+/g, compactPath);
};

const VALUE_FLAGS = {
  grep: new Set(['-A', '-B', '-C', '-m', '-e', '-f', '--max-count', '--include', '--exclude', '--exclude-dir']),
  rg: new Set(['-A', '-B', '-C', '-m', '-e', '-f', '-g', '-t', '--type', '--glob', '--max-count', '--max-depth']),
  tree: new Set(['-L', '-P', '-I']),
  uniq: new Set(['-f', '-s', '-w'])
};

const operandsOf = (name, args) => {
  const valued = VALUE_FLAGS[name];
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (valued?.has(a)) i++;else
    if (!a.startsWith('-')) out.push(a);
  }
  return out;
};

const describeCommand = (name, args, places) => {
  const files = (list) => list.map((f) => shortTarget(places, f)).join(', ');
  const ops = operandsOf(name, args);
  if (TRIVIAL_PROGRAMS.has(name)) return '';
  if (name === 'sed') {
    const range = args.find((a) => /^\d+(,\d+)?p$/.test(a));
    const targets = ops.filter((a) => a !== range);
    if (!range || !targets.length) return undefined;
    const [from, to] = range.slice(0, -1).split(',');
    return `Read ${files(targets)} lines ${from}${to ? `–${to}` : ''}`;
  }
  if (name === 'cat' || name === 'less' || name === 'nl') return ops.length ? `Read ${files(ops)}` : undefined;
  if (name === 'pdftotext') return ops.length ? `Read ${files(ops.slice(0, 1))}` : undefined;
  if (name === 'head' || name === 'tail') {
    const targets = ops.filter((a) => !/^\d+$/.test(a));
    return targets.length ? `Read ${name === 'head' ? 'start' : 'end'} of ${files(targets)}` : undefined;
  }
  if (name === 'grep' || name === 'rg') {
    const e = args.indexOf('-e');
    const pattern = e >= 0 ? args[e + 1] : ops[0];
    const paths = e >= 0 ? ops : ops.slice(1);
    return pattern === undefined ? undefined : `Searched ${paths.length ? files(paths) : '.'} for "${pattern}"`;
  }
  if (name === 'ls' || name === 'tree') return `Listed ${ops.length ? files(ops) : '.'}`;
  if (name === 'find') return `Listed ${args[0] && !args[0].startsWith('-') ? files([args[0]]) : '.'}`;
  if (name === 'wc') return ops.length ? `Counted ${files(ops)}` : undefined;
  return undefined;
};

const describeShell = (command, places = { cwd: '', home: '' }) => {
  if (!isReadOnlyCall('Bash', { command })) return undefined;
  const vars = new Map();
  const expand = (w) => w.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, v) => vars.get(v) ?? m);
  const parts = [];
  for (const segment of parseShell(command).segments) {
    const words = commandWords(segment.words);
    if (!words.length) {
      for (const w of segment.words.filter(isAssignment)) vars.set(w.slice(0, w.indexOf('=')), expand(w.slice(w.indexOf('=') + 1)));
      continue;
    }
    if (segment.piped) continue;
    const [name, ...args] = words.map(expand);
    if (args.some((a) => /\$\{?[A-Za-z_]/.test(a))) return undefined;
    const text = describeCommand(name, args, places);
    if (text === undefined) return undefined;
    if (text) parts.push(text);
  }
  return parts.length ? parts.join(' · ') : undefined;
};

const OUTPUT_LINES = 120;

const lines = (value) => typeof value === 'string' && value !== '' ? value.replace(CONTROL, '').replace(/\n$/, '').split('\n') : [];

const renderExpandedShell = (el, style, row) => {
  const { Box, Text } = el;
  const t = style.theme;
  const command = (field(row.input, 'command') ?? '').split('\n');
  const out = row.output !== null && typeof row.output === 'object' ? row.output : {};
  const stdout = lines(out.stdout);
  const stderr = lines(out.stderr);
  const shown = [...stdout.map((text) => ({ text, color: undefined })), ...stderr.map((text) => ({ text, color: t.codeFlag }))];
  const visible = shown.slice(0, OUTPUT_LINES);
  const dot = statusColor(t, row);
  return (
    h(Box, { flexDirection: "column" },
    h(Box, { flexDirection: "row" },
    h(Box, { width: 2, flexShrink: 0 },
    h(Text, { color: dot }, row.isRunning ? '◌' : '●')
    ),
    h(Box, { flexDirection: "column" },
    command.map((line, i) =>
    h(Text, { key: `c${i}` },
    i === 0 ? h(Text, { bold: true }, `${row.tool}(`) : null,
    codeLine(el, style, line, 'bash', `cmd${i}`),
    i === command.length - 1 ? h(Text, { bold: true }, ")") : null
    )
    )
    )
    ),
    row.isRunning ? null :
    h(Box, { paddingLeft: 2 },
    h(Box, { flexDirection: "column", alignSelf: "flex-start", borderStyle: "round", borderColor: t.codeComment, paddingX: 1 },
    visible.length === 0 ? h(Text, { dimColor: true }, "(No output)") : visible.map((l, i) => h(Text, { key: `o${i}`, color: l.color }, l.text === '' ? ' ' : l.text)),
    shown.length > visible.length ? h(Text, { dimColor: true }, `\u2026 +${shown.length - visible.length} lines`) : null
    )
    )

    ));

};

const GROUPS = [
[/^(Bash|PowerShell)$/, 'ran', 'command'],
[/^Read$/, 'read', 'file'],
[/^(Write|Edit|MultiEdit|NotebookEdit)$/, 'edited', 'file'],
[/^(Grep|Glob)$/, 'searched', 'pattern'],
[/^(WebFetch|WebSearch)$/, 'fetched', 'page'],
[/^(Agent|Task)$/, 'delegated', 'task']];


const groupSummary = (calls) => {
  const counts = new Map();
  for (const call of calls) {
    const [, verb, noun] = GROUPS.find(([re]) => re.test(call.tool)) ?? [, 'used', call.tool.replace(/^mcp__([^_]+)__/, '$1 ')];
    const label = `${verb} ${noun}`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const parts = [...counts].map(([label, n]) => {
    const [verb, ...noun] = label.split(' ');
    const name = noun.join(' ');
    return `${verb} ${n} ${n === 1 ? name : name.endsWith('h') ? `${name}es` : `${name}s`}`;
  });
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const quietToolGroup = (el, style, calls, isActive, columns) => {
  const t = style.theme;
  const failed = calls.filter((c) => c.isErrored);
  const running = isActive && calls.some((c) => c.isRunning);
  const dot = failed.length ? t.codeFlag : running ? t.accent : t.number;
  const labels = calls.map((c) => callPieces(c, style)).filter((l, i, all) => pieceText(l) !== (i ? pieceText(all[i - 1]) : undefined));
  const label = labels.map(pieceText).join(' · ');
  const reasons = failed.map((c, i) => renderFailure(el, style, c.output, `r${i}`)).filter((r) => r !== undefined);
  const isShell = (c) => c.tool === 'Bash' || c.tool === 'PowerShell';
  const results = calls.flatMap((c, i) => c.isErrored || c.output === undefined || !isShell(c) || isReadOnlyCall(c.tool, c.input) ? [] : [h(el.Box, { key: `o${i}` }, renderShellResult(el, style, c.output))]);
  const row = toolLayout(el, style, columns, label, dot, running,
  h(el.Text, { wrap: "truncate-end", dimColor: toolDim(style) }, drawPieces(el, style, labels.flatMap((l, i) => i ? [{ text: ' · ' }, ...l] : l)))
  );
  if (!reasons.length && !results.length) return row;
  return (
    h(el.Box, { flexDirection: "column" },
    row,
    reasons,
    results
    ));

};

const renderToolGroup = (el, style, calls, isActive, columns = 100) => {
  if (style.toolOutput === 'quiet') return quietToolGroup(el, style, calls, isActive, columns);
  const { Text } = el;
  const t = style.theme;
  const failed = calls.filter((c) => c.isErrored).length;
  const running = isActive && calls.some((c) => c.isRunning);
  const dot = failed ? t.codeFlag : running ? t.accent : t.number;
  const last = calls[calls.length - 1];
  const lastFound = last ? targetOf(style, last.input, ['command', ...TARGET_FIELDS]) : {};
  const lastTarget = lastFound.target?.split('\n')[0];
  const summary = groupSummary(calls);
  const label = `${summary}${failed ? ` · ${failed} failed` : ""}${lastTarget ? ` · last: ${lastTarget}` : ""}`;
  return toolLayout(el, style, columns, label, dot, running,
  h(Text, { wrap: "truncate-end", dimColor: toolDim(style) },
  h(Text, { bold: !toolDim(style), dimColor: toolDim(style) }, summary),
  failed ? h(Text, { color: t.codeFlag }, ` · ${failed} failed`) : null,
  lastTarget ? h(Text, { dimColor: true }, drawPieces(el, style, [{ text: ' · last: ' }, { text: lastTarget, path: toolPath(last?.tool, lastFound.path) }])) : null
  )
  );
};

const formatDuration = (ms) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${Math.max(s, 0)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m`;
};

const renderTurnDuration = ({ Text }, style, word, durationMs, time) =>
h(Text, { color: style.theme.codeComment },
`✻ ${word} for `,
h(Text, { color: style.theme.number }, formatDuration(durationMs)),
time === undefined ? null : ' · ',
time === undefined ? null : h(Text, { color: style.theme.number }, time)
);


const pasteLang = (body) => {
  const s = body.trim();
  if (/^[[{]/.test(s)) {
    try {
      JSON.parse(s);
      return 'json';
    } catch {}
  }
  if (/^@@ /m.test(s) && /^(diff |--- |\+\+\+ )/m.test(s)) return 'diff';
  return /^<[a-z!?]/i.test(s) && />$/.test(s) ? 'markup' : '';
};

const PASTE = /<pasted_content id="([^"]*)">\n?([\s\S]*?)\n?<\/pasted_content id="\1">/g;



const boxedPrompt = (style) => style.promptStyle === 'bubble' || style.promptStyle === 'wide';

const widePrompt = (style, hebrew) => style.promptStyle === 'wide' || hebrew && mirrored(style);

const renderUserPrompt = (el, style, typed, columns, time, paste) => {
  const { Box, Text } = el;
  const pastes = [];
  const text = typed.replace(PASTE, (_, _id, body) => `\0${pastes.push(body) - 1}\0`);
  const own = (line) => paste && /^\0\d+\0$/.test(line) ? pastes[Number(line.slice(1, -1))] : undefined;
  const told = (line) => line.replace(/\0(\d+)\0/g, (_, n) => `[Pasted text +${pastes[Number(n)].split('\n').length} lines]`);
  const t = style.theme;
  const color = style.promptStyle === 'chevron' ? t.accent : t.heading;
  const rows = text.split('\n');
  const lines = rows.map((line) => own(line) === undefined ? flowOf(style, [{ kind: 'text', text: told(line) }], columns - 4 - (time === undefined ? 0 : time.length + 1)) : null);
  const hebrew = lines.some((l) => l?.base === 'R');
  const rtl = hebrew && !mirrored(style);
  const body =
  h(Box, _extends({ flexDirection: "column" }, rtl ? { alignItems: 'flex-end' } : {}),
  rows.map((line, i) => {
    const pasted = own(line);
    if (pasted !== undefined) return paste(pasted, `paste${i}`);
    const flow = lines[i];
    return flow ? renderFlow(el, style, flow.lines, `p${i}`, { color, bold: style.promptStyle === 'chevron' }) : h(Text, { key: `p${i}`, color: color, bold: style.promptStyle === 'chevron' }, told(line));
  })
  );

  const stamp = time === undefined ? null : h(Text, { color: t.codeComment }, rtl ? ` ${time}` : `${time} `);
  const content = stamp === null ? body : h(Box, { flexDirection: "row" }, rtl ? body : stamp, rtl ? stamp : body);
  if (boxedPrompt(style)) {
    return h(Box, _extends({ borderStyle: "round", borderColor: t.accent, paddingX: 1, alignSelf: rtl ? 'flex-end' : 'flex-start' }, widePrompt(style, hebrew) ? { width: '100%' } : {}), content);
  }
  const mark = h(Text, { color: t.accent, bold: true }, style.promptStyle === 'bar' ? rtl ? ' ▐' : '▌ ' : rtl ? ' ‹' : '› ');
  return h(Box, _extends({ flexDirection: "row" }, rtl ? { justifyContent: 'flex-end' } : {}), rtl ? content : mark, rtl ? mark : content);
};
export { graphemes, cells, width, takesHttpLinks, takesEditorLinks, takesClickableMarks, fileRoot, drawsHyperlinks, pathsToProbe, mirrored, heldLtr, PRISM_COLORS, remember, highlightBlock, codeLine, columnWidths, tableArt, instanceKey, noteTip, drawMath, MARK, markerRoom, renderBlocks, shortPath, shortTarget, renderShellResult, tint, contrast, fullHue, diffTint, leftToEngine, diffLines, pathLanguage, onTint, wordTint, renderDiffCard, EDIT_NOTES, bashEdits, withoutBashEdits, hasShellOutput, BAND_STEP, previewBand, renderBashEdits, editNotes, movesTree, refusalReason, rememberCall, errorReason, renderFailure, renderToolRow, isReadOnlyCall, programsOf, shortenPaths, describeShell, renderExpandedShell, groupSummary, renderToolGroup, formatDuration, renderTurnDuration, pasteLang, renderUserPrompt };
