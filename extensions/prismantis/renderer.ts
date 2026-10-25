import { getCapabilities, hyperlink, renderImage, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { hoveredKey, pointerMoved } from "../lib/pointer-hover.ts";
import type { RenderElement, RenderNode } from "./core/jsx.ts";
import { graphemes, width as measureTextWidth } from "./core/render.ts";

export type MouseHit = {
	row: number;
	from: number;
	to: number;
	onPress: () => void;
	key: unknown;
};

export type RenderedBox = {
	lines: string[];
	width: number;
	intrinsicWidth: number;
	hits: MouseHit[];
};

type TextStyle = {
	color?: string;
	backgroundColor?: string;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strikethrough?: boolean;
	dimColor?: boolean;
	inverse?: boolean;
	href?: string;
	onPress?: () => void;
	pressKey?: unknown;
	hover?: Record<string, unknown>;
};

type InlineSpan = {
	text: string;
	style: TextStyle;
};

const NAMED_FG: Record<string, number> = {
	black: 30,
	red: 31,
	green: 32,
	yellow: 33,
	blue: 34,
	magenta: 35,
	cyan: 36,
	white: 37,
	gray: 90,
	grey: 90,
	blackbright: 90,
	redbright: 91,
	greenbright: 92,
	yellowbright: 93,
	bluebright: 94,
	magentabright: 95,
	cyanbright: 96,
	whitebright: 97,
};

const NAMED_BG: Record<string, number> = {
	black: 40,
	red: 41,
	green: 42,
	yellow: 43,
	blue: 44,
	magenta: 45,
	cyan: 46,
	white: 47,
	gray: 100,
	grey: 100,
	blackbright: 100,
	redbright: 101,
	greenbright: 102,
	yellowbright: 103,
	bluebright: 104,
	magentabright: 105,
	cyanbright: 106,
	whitebright: 107,
};

function parseHexRgb(color: string): [number, number, number] | undefined {
	const c = color.trim();
	if (/^#[0-9a-f]{6}$/i.test(c)) {
		return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
	}
	if (/^#[0-9a-f]{3}$/i.test(c)) {
		return [
			parseInt(c[1]! + c[1]!, 16),
			parseInt(c[2]! + c[2]!, 16),
			parseInt(c[3]! + c[3]!, 16),
		];
	}
	const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(c);
	if (rgb) {
		return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
	}
	return undefined;
}

export function fgSgr(color: string | undefined): string {
	if (!color) return "";
	const rgb = parseHexRgb(color);
	if (rgb) return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
	const ansi = /^ansi256\((\d{1,3})\)$/i.exec(color.trim());
	if (ansi) return `\x1b[38;5;${Number(ansi[1])}m`;
	const named = NAMED_FG[color.trim().toLowerCase()];
	return named !== undefined ? `\x1b[${named}m` : "";
}

export function bgSgr(color: string | undefined): string {
	if (!color) return "";
	const rgb = parseHexRgb(color);
	if (rgb) return `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
	const ansi = /^ansi256\((\d{1,3})\)$/i.exec(color.trim());
	if (ansi) return `\x1b[48;5;${Number(ansi[1])}m`;
	const named = NAMED_BG[color.trim().toLowerCase()];
	return named !== undefined ? `\x1b[${named}m` : "";
}

function stylePrefix(style: TextStyle): string {
	let out = "";
	if (style.bold) out += "\x1b[1m";
	if (style.dimColor) out += "\x1b[2m";
	if (style.italic) out += "\x1b[3m";
	if (style.underline) out += "\x1b[4m";
	if (style.inverse) out += "\x1b[7m";
	if (style.strikethrough) out += "\x1b[9m";
	if (style.color) out += fgSgr(style.color);
	if (style.backgroundColor) out += bgSgr(style.backgroundColor);
	return out;
}

function formatSpan(span: InlineSpan): string {
	if (span.text === "") return "";
	const { style } = span;
	const lit = style.pressKey !== undefined && style.pressKey === litKey;
	const prefix = stylePrefix(lit ? mergeStyle(style, style.hover ?? DEFAULT_HOVER) : style);
	const styled = prefix ? `${prefix}${span.text}\x1b[0m` : span.text;
	if (style.href) {
		return hyperlink(styled, style.href);
	}
	return styled;
}

function isRenderElement(node: RenderNode): node is RenderElement {
	return typeof node === "object" && node !== null && !Array.isArray(node) && "type" in node;
}

const DEFAULT_HOVER = { inverse: true };

// The press key of the element under the pointer while a component renders, read by formatSpan.
let litKey: unknown;

function hoverProps(props: Record<string, unknown>): Record<string, unknown> | undefined {
	return typeof props.hover === "object" && props.hover !== null ? (props.hover as Record<string, unknown>) : undefined;
}

function mergeStyle(base: TextStyle, props: Record<string, unknown>): TextStyle {
	const pressable = typeof props.onPress === "function";
	return {
		color: typeof props.color === "string" ? props.color : base.color,
		backgroundColor: typeof props.backgroundColor === "string" ? props.backgroundColor : base.backgroundColor,
		bold: props.bold === true ? true : props.bold === false ? false : base.bold,
		italic: props.italic === true ? true : props.italic === false ? false : base.italic,
		underline: props.underline === true ? true : props.underline === false ? false : base.underline,
		strikethrough: props.strikethrough === true ? true : props.strikethrough === false ? false : base.strikethrough,
		dimColor:
			props.dimColor === true || props.dim === true
				? true
				: props.dimColor === false || props.dim === false
					? false
					: base.dimColor,
		inverse: props.inverse === true ? true : props.inverse === false ? false : base.inverse,
		href: typeof props.href === "string" ? props.href : base.href,
		onPress: pressable ? () => (props.onPress as () => void)() : base.onPress,
		pressKey: pressable ? props.onPress : base.pressKey,
		hover: hoverProps(props) ?? (pressable ? undefined : base.hover),
	};
}

function collectInlineSpans(node: RenderNode, style: TextStyle, out: InlineSpan[] = []): InlineSpan[] {
	if (node === null || node === undefined || typeof node === "boolean") return out;
	if (Array.isArray(node)) {
		for (const child of node) collectInlineSpans(child, style, out);
		return out;
	}
	if (typeof node === "string" || typeof node === "number") {
		const text = String(node);
		if (text !== "") out.push({ text, style });
		return out;
	}
	if (!isRenderElement(node)) return out;
	if (node.props.display === "none") return out;

	if (node.type === "Link") {
		const href = typeof node.props.href === "string" ? node.props.href : undefined;
		const nextStyle = mergeStyle(style, { ...node.props, href });
		if (node.children.length > 0) {
			collectInlineSpans(node.children, nextStyle, out);
		} else {
			const label = typeof node.props.label === "string" ? node.props.label : (href ?? "");
			if (label !== "") out.push({ text: label, style: nextStyle });
		}
		return out;
	}

	if (node.type === "Button") {
		const onPress =
			typeof node.props.onPress === "function"
				? () => (node.props.onPress as () => void)()
				: style.onPress;
		const pressable = typeof node.props.onPress === "function";
		const press = {
			onPress,
			pressKey: pressable ? node.props.onPress : style.pressKey,
			hover: hoverProps(node.props) ?? (pressable ? undefined : style.hover),
		};
		if (node.props.plain === true && node.children.length > 0) {
			collectInlineSpans(node.children, { ...style, ...press }, out);
			return out;
		}
		const label = typeof node.props.label === "string" ? node.props.label : "";
		const isPrimary = node.props.variant === "primary";
		const btnStyle: TextStyle = {
			...style,
			bold: isPrimary ? true : style.bold,
			dimColor: !isPrimary ? true : style.dimColor,
			...press,
		};
		out.push({ text: `[ ${label} ]`, style: btnStyle });
		return out;
	}

	const nextStyle = mergeStyle(style, node.props);
	collectInlineSpans(node.children, nextStyle, out);
	return out;
}

function splitSpansByNewline(spans: InlineSpan[]): InlineSpan[][] {
	const lines: InlineSpan[][] = [[]];
	for (const span of spans) {
		const parts = span.text.split("\n");
		for (let i = 0; i < parts.length; i++) {
			if (i > 0) lines.push([]);
			const part = parts[i]!;
			if (part !== "") {
				lines[lines.length - 1]!.push({ text: part, style: span.style });
			}
		}
	}
	return lines;
}

function spansWidth(spans: InlineSpan[]): number {
	let total = 0;
	for (const span of spans) total += measureTextWidth(span.text);
	return total;
}

function sliceSpansByColumns(spans: InlineSpan[], startCol: number, endCol: number): InlineSpan[] {
	const out: InlineSpan[] = [];
	let col = 0;
	for (const span of spans) {
		let piece = "";
		for (const g of graphemes(span.text)) {
			const w = measureTextWidth(g);
			if (col + w > startCol && col < endCol) {
				piece += g;
			}
			col += w;
		}
		if (piece !== "") out.push({ text: piece, style: span.style });
	}
	return out;
}

function wrapSpanLine(spans: InlineSpan[], maxWidth: number, mode: unknown): InlineSpan[][] {
	const totalW = spansWidth(spans);
	if (totalW <= maxWidth || maxWidth <= 0) return [spans];

	if (mode === "truncate-end") {
		if (maxWidth <= 1) return [sliceSpansByColumns(spans, 0, maxWidth)];
		const head = sliceSpansByColumns(spans, 0, maxWidth - 1);
		const lastStyle = head[head.length - 1]?.style ?? spans[0]?.style ?? {};
		return [[...head, { text: "…", style: lastStyle }]];
	}

	if (mode === "truncate-middle") {
		if (maxWidth <= 1) return [sliceSpansByColumns(spans, 0, maxWidth)];
		const leftW = Math.ceil((maxWidth - 1) / 2);
		const rightW = Math.floor((maxWidth - 1) / 2);
		const left = sliceSpansByColumns(spans, 0, leftW);
		const right = sliceSpansByColumns(spans, totalW - rightW, totalW);
		const midStyle = left[left.length - 1]?.style ?? spans[0]?.style ?? {};
		return [[...left, { text: "…", style: midStyle }, ...right]];
	}

	const fullText = spans.map((s) => s.text).join("");
	const stylesAt: TextStyle[] = [];
	for (const span of spans) {
		for (let i = 0; i < span.text.length; i++) stylesAt.push(span.style);
	}

	const ranges: [number, number][] = [];
	let lineStart = 0;
	let lineEnd = 0;
	let used = 0;
	let lastSpace = -1;
	let idx = 0;
	for (const g of graphemes(fullText)) {
		const w = measureTextWidth(g);
		const isSpace = /\s/.test(g);
		if (used + w > maxWidth && idx > lineStart) {
			const cut = !isSpace && lastSpace > lineStart ? lastSpace : idx;
			ranges.push([lineStart, cut]);
			lineStart = cut;
			while (lineStart < idx && /\s/.test(fullText[lineStart]!)) lineStart++;
			used = measureTextWidth(fullText.slice(lineStart, idx));
			lastSpace = -1;
		}
		idx += g.length;
		lineEnd = idx;
		used += w;
		if (isSpace) lastSpace = idx;
	}
	if (lineEnd > lineStart || ranges.length === 0) {
		ranges.push([lineStart, lineEnd]);
	}

	return ranges.map(([a, b]) => {
		const rowSpans: InlineSpan[] = [];
		for (let i = a; i < b; i++) {
			const ch = fullText[i]!;
			const st = stylesAt[i]!;
			const prev = rowSpans[rowSpans.length - 1];
			if (prev && prev.style === st) prev.text += ch;
			else rowSpans.push({ text: ch, style: st });
		}
		return rowSpans;
	});
}

function renderSpanRows(rows: InlineSpan[][]): RenderedBox {
	const lines: string[] = [];
	const hits: MouseHit[] = [];
	let maxW = 0;

	for (let r = 0; r < rows.length; r++) {
		const row = rows[r]!;
		let line = "";
		let col = 0;
		for (const span of row) {
			const w = measureTextWidth(span.text);
			if (span.style.onPress && w > 0) {
				const prev = hits[hits.length - 1];
				if (prev && prev.row === r && prev.to === col && prev.onPress === span.style.onPress) {
					prev.to = col + w;
				} else {
					hits.push({ row: r, from: col, to: col + w, onPress: span.style.onPress, key: span.style.pressKey });
				}
			}
			line += formatSpan(span);
			col += w;
		}
		lines.push(line);
		if (col > maxW) maxW = col;
	}

	return { lines, width: maxW, intrinsicWidth: maxW, hits };
}

function renderTextElement(node: RenderElement, maxWidth: number): RenderedBox {
	const baseStyle = mergeStyle({}, node.props);
	const spans = collectInlineSpans(node.children, baseStyle);
	const logicalLines = splitSpansByNewline(spans);
	const intrinsicWidth = Math.max(0, ...logicalLines.map(spansWidth));
	const wrappedRows = logicalLines.flatMap((line) => wrapSpanLine(line, maxWidth, node.props.wrap));
	const box = renderSpanRows(wrappedRows);
	return { ...box, intrinsicWidth };
}

function renderButtonElement(node: RenderElement, maxWidth: number): RenderedBox {
	const onPress =
		typeof node.props.onPress === "function"
			? () => (node.props.onPress as () => void)()
			: undefined;

	if (node.props.plain === true && node.children.length > 0) {
		const hasBlockChild = node.children.some((c) => isRenderElement(c) && (c.type === "Box" || c.type === "Text"));
		if (hasBlockChild) {
			const inner = renderBoxElement({ type: "Box", props: { flexDirection: "column" }, children: node.children }, maxWidth);
			const hits: MouseHit[] = [...inner.hits];
			if (onPress) {
				for (let r = 0; r < inner.lines.length; r++) {
					const w = Math.max(inner.width, visibleWidth(inner.lines[r]!));
					hits.push({ row: r, from: 0, to: w, onPress, key: node.props.onPress });
				}
			}
			return { ...inner, hits };
		}
	}

	const spans = collectInlineSpans(node, {});
	const box = renderSpanRows([spans]);
	return box;
}

function renderImageElement(node: RenderElement, maxWidth: number): RenderedBox {
	const source = node.props.source as { png?: string } | undefined;
	const png = source?.png;
	const cols = Math.min(maxWidth, Math.max(1, Number(node.props.columns ?? 20)));
	const rows = Math.max(1, Number(node.props.rows ?? 4));
	const alt = typeof node.props.alt === "string" ? node.props.alt : "image";

	if (png && getCapabilities().images) {
		const rendered = renderImage(
			png,
			{ widthPx: cols * 10, heightPx: rows * 20 },
			{ maxWidthCells: cols, maxHeightCells: rows, preserveAspectRatio: true },
		);
		if (rendered?.sequence) {
			return {
				lines: [rendered.sequence],
				width: rendered.columns,
				intrinsicWidth: rendered.columns,
				hits: [],
			};
		}
	}

	const fallback = `${fgSgr("#89b4fa")}[${alt}]\x1b[0m`;
	const w = visibleWidth(fallback);
	return { lines: [fallback], width: w, intrinsicWidth: w, hits: [] };
}

function padLineRight(line: string, targetWidth: number, bgAnsi = ""): string {
	const vis = visibleWidth(line);
	const pad = Math.max(0, targetWidth - vis);
	const body = pad > 0 ? line + " ".repeat(pad) : line;
	if (!bgAnsi) return body;
	return `${bgAnsi}${body.replace(/\x1b\[0m/g, `\x1b[0m${bgAnsi}`).replace(/\x1b\[49m/g, bgAnsi)}\x1b[0m`;
}

const BORDERS: Record<string, [string, string, string, string, string, string]> = {
	round: ["╭", "─", "╮", "│", "╰", "╯"],
	bold: ["┏", "━", "┓", "┃", "┗", "┛"],
	double: ["╔", "═", "╗", "║", "╚", "╝"],
	single: ["┌", "─", "┐", "│", "└", "┘"],
};

function isClipBox(node: RenderNode): node is RenderElement {
	if (!isRenderElement(node) || node.type !== "Box") return false;
	if (node.props.height === 0 && node.props.overflow === "hidden") return true;
	return node.children.length === 1 && isClipBox(node.children[0]!);
}

function unwrapClipContent(node: RenderElement): RenderNode[] {
	if (node.props.height === 0 && node.props.overflow === "hidden") {
		return node.children;
	}
	if (node.children.length === 1 && isRenderElement(node.children[0]!)) {
		return unwrapClipContent(node.children[0]!);
	}
	return node.children;
}

function isInlineWordWrapBox(node: RenderElement): boolean {
	return (
		node.props.flexDirection === "row" &&
		node.props.flexWrap === "wrap" &&
		node.props.columnGap === undefined &&
		node.children.every(
			(c) =>
				!isRenderElement(c) ||
				c.type === "Text" ||
				c.type === "Button" ||
				c.type === "Link" ||
				(c.type === "Box" && c.props.flexDirection === "row" && c.props.columnGap === undefined),
		)
	);
}

function joinHorizontalRun(
	items: { box: RenderedBox; gapBefore: number }[],
	rowHeight: number,
): { lines: string[]; width: number; hits: MouseHit[] } {
	const lines: string[] = Array.from({ length: rowHeight }, () => "");
	const hits: MouseHit[] = [];
	let col = 0;

	for (let idx = 0; idx < items.length; idx++) {
		const { box, gapBefore } = items[idx]!;
		const isLast = idx === items.length - 1;
		if (gapBefore > 0) {
			const gapStr = " ".repeat(gapBefore);
			for (let r = 0; r < rowHeight; r++) lines[r] += gapStr;
			col += gapBefore;
		}
		for (const hit of box.hits) {
			hits.push({
				row: hit.row,
				from: hit.from + col,
				to: hit.to + col,
				onPress: hit.onPress,
				key: hit.key,
			});
		}
		for (let r = 0; r < rowHeight; r++) {
			const raw = box.lines[r] ?? "";
			lines[r] += isLast ? raw : padLineRight(raw, box.width);
		}
		col += box.width;
	}

	return { lines, width: col, hits };
}

function renderRowBox(node: RenderElement, innerMaxWidth: number, fixedInnerWidth?: number): RenderedBox {
	const children = node.children.filter((c) => c !== null && c !== undefined && typeof c !== "boolean");
	if (children.length === 0) return { lines: [], width: 0, intrinsicWidth: 0, hits: [] };

	if (isInlineWordWrapBox(node)) {
		const spans = collectInlineSpans(children, {});
		const logicalLines = splitSpansByNewline(spans);
		const intrinsicWidth = Math.max(0, ...logicalLines.map(spansWidth));
		const wrappedRows = logicalLines.flatMap((line) => wrapSpanLine(line, innerMaxWidth, "wrap"));
		const rendered = renderSpanRows(wrappedRows);
		const justify = node.props.justifyContent;
		if (justify === "flex-end" || justify === "center") {
			const targetW = fixedInnerWidth ?? rendered.width;
			const alignedLines = rendered.lines.map((line) => {
				const w = visibleWidth(line);
				const spare = Math.max(0, targetW - w);
				const left = justify === "flex-end" ? spare : Math.floor(spare / 2);
				return " ".repeat(left) + line;
			});
			return { ...rendered, lines: alignedLines, width: targetW, intrinsicWidth };
		}
		return { ...rendered, intrinsicWidth };
	}

	const columnGap = Number(node.props.columnGap ?? 0);
	const rowGap = Number(node.props.rowGap ?? 0);

	if (node.props.flexWrap === "wrap") {
		const renderedChildren = children
			.map((child) => renderNode(child, innerMaxWidth))
			.filter((b) => b.lines.length > 0);
		if (renderedChildren.length === 0) return { lines: [], width: 0, intrinsicWidth: 0, hits: [] };

		const rows: RenderedBox[][] = [[]];
		let currentWidth = 0;
		for (const child of renderedChildren) {
			const current = rows[rows.length - 1]!;
			const needed = current.length === 0 ? child.width : currentWidth + columnGap + child.width;
			if (current.length > 0 && needed > innerMaxWidth) {
				rows.push([child]);
				currentWidth = child.width;
			} else {
				current.push(child);
				currentWidth = needed;
			}
		}

		const allLines: string[] = [];
		const allHits: MouseHit[] = [];
		let maxRowW = 0;
		for (let rIdx = 0; rIdx < rows.length; rIdx++) {
			if (rIdx > 0 && rowGap > 0) {
				for (let g = 0; g < rowGap; g++) allLines.push("");
			}
			const rowItems = rows[rIdx]!.map((box, i) => ({ box, gapBefore: i === 0 ? 0 : columnGap }));
			const h = Math.max(1, ...rowItems.map((it) => it.box.lines.length));
			const joined = joinHorizontalRun(rowItems, h);
			const yOffset = allLines.length;
			for (const hit of joined.hits) {
				allHits.push({ ...hit, row: hit.row + yOffset });
			}
			allLines.push(...joined.lines);
			if (joined.width > maxRowW) maxRowW = joined.width;
		}
		const intrinsicWidth =
			renderedChildren.reduce((sum, c) => sum + c.intrinsicWidth, 0) +
			Math.max(0, renderedChildren.length - 1) * columnGap;
		return { lines: allLines, width: maxRowW, intrinsicWidth, hits: allHits };
	}

	type Slot = {
		child: RenderNode;
		isClip: boolean;
		grow: number;
		fixedW?: number;
		box?: RenderedBox;
	};

	const slots: Slot[] = children.map((child) => {
		const el = isRenderElement(child) ? child : undefined;
		return {
			child,
			isClip: isClipBox(child),
			grow: Number(el?.props.flexGrow ?? 0),
			fixedW: typeof el?.props.width === "number" ? el.props.width : undefined,
		};
	});

	let usedWidth = 0;
	let nonEmptyCount = 0;
	const flexibleIndices: number[] = [];

	for (let i = 0; i < slots.length; i++) {
		const slot = slots[i]!;
		if (slot.isClip) {
			const clipEl = slot.child as RenderElement;
			const minW = typeof clipEl.props.minWidth === "number" ? clipEl.props.minWidth : 2;
			slot.fixedW = minW;
			usedWidth += minW;
			nonEmptyCount++;
			continue;
		}
		if (slot.grow === 0) {
			const budget = slot.fixedW ?? innerMaxWidth;
			slot.box = renderNode(slot.child, budget);
			if (slot.box.lines.length > 0 || slot.fixedW !== undefined) {
				usedWidth += slot.fixedW ?? slot.box.width;
				nonEmptyCount++;
				if (slot.fixedW === undefined) {
					flexibleIndices.push(i);
				}
			}
		}
	}

	const growSlots = slots.filter((s) => !s.isClip && s.grow > 0);
	const totalGaps = Math.max(0, nonEmptyCount + growSlots.length - 1) * columnGap;
	const remainingForGrow = Math.max(1, innerMaxWidth - usedWidth - totalGaps);
	const totalGrow = growSlots.reduce((sum, s) => sum + s.grow, 0);
	for (const slot of growSlots) {
		const share = Math.max(1, Math.floor((remainingForGrow * slot.grow) / (totalGrow || 1)));
		slot.box = renderNode(slot.child, share);
	}

	if (growSlots.length === 0 && flexibleIndices.length >= 2 && usedWidth + totalGaps > innerMaxWidth) {
		let widestIdx = flexibleIndices[0]!;
		for (const idx of flexibleIndices) {
			if ((slots[idx]!.box?.width ?? 0) > (slots[widestIdx]!.box?.width ?? 0)) {
				widestIdx = idx;
			}
		}
		const otherWidth = slots.reduce(
			(sum, s, idx) => (idx === widestIdx || s.isClip && s.fixedW === undefined ? sum : sum + (s.fixedW ?? s.box?.width ?? 0)),
			0,
		);
		const clampedBudget = Math.max(1, innerMaxWidth - otherWidth - totalGaps);
		if (clampedBudget < (slots[widestIdx]!.box?.width ?? 0)) {
			slots[widestIdx]!.box = renderNode(slots[widestIdx]!.child, clampedBudget);
		}
	}

	const rowHeight = Math.max(
		1,
		...slots.filter((s) => !s.isClip && s.box).map((s) => s.box!.lines.length),
	);

	for (const slot of slots) {
		if (slot.isClip) {
			const content = unwrapClipContent(slot.child as RenderElement);
			const rendered = renderNode(
				{ type: "Box", props: { flexDirection: "column" }, children: content },
				slot.fixedW ?? innerMaxWidth,
			);
			slot.box = {
				lines: rendered.lines.slice(0, rowHeight),
				width: slot.fixedW ?? rendered.width,
				intrinsicWidth: slot.fixedW ?? rendered.intrinsicWidth,
				hits: rendered.hits.filter((h) => h.row < rowHeight),
			};
		}
	}

	const activeBoxes = slots
		.map((s) => {
			if (!s.box) return undefined;
			if (s.fixedW !== undefined && s.box.lines.length === 0) {
				return { lines: [" ".repeat(s.fixedW)], width: s.fixedW, intrinsicWidth: s.fixedW, hits: [] };
			}
			if (s.box.lines.length === 0) return undefined;
			if (s.fixedW !== undefined && s.box.width < s.fixedW) {
				const justify = isRenderElement(s.child) ? s.child.props.justifyContent : undefined;
				const paddedLines = s.box.lines.map((line) => {
					const vis = visibleWidth(line);
					const spare = Math.max(0, s.fixedW! - vis);
					const left = justify === "flex-end" ? spare : justify === "center" ? Math.floor(spare / 2) : 0;
					return " ".repeat(left) + line + " ".repeat(spare - left);
				});
				const shiftedHits = s.box.hits.map((hit) => {
					const lineVis = visibleWidth(s.box!.lines[hit.row] ?? "");
					const spare = Math.max(0, s.fixedW! - lineVis);
					const left = justify === "flex-end" ? spare : justify === "center" ? Math.floor(spare / 2) : 0;
					return { ...hit, from: hit.from + left, to: hit.to + left };
				});
				return {
					lines: paddedLines,
					width: s.fixedW,
					intrinsicWidth: s.fixedW,
					hits: shiftedHits,
				};
			}
			return s.box;
		})
		.filter((b): b is RenderedBox => b !== undefined);

	if (activeBoxes.length === 0) return { lines: [], width: 0, intrinsicWidth: 0, hits: [] };

	const naturalWidth =
		activeBoxes.reduce((sum, b) => sum + b.width, 0) + Math.max(0, activeBoxes.length - 1) * columnGap;
	const intrinsicWidth =
		activeBoxes.reduce((sum, b) => sum + b.intrinsicWidth, 0) + Math.max(0, activeBoxes.length - 1) * columnGap;
	const targetWidth = fixedInnerWidth ?? naturalWidth;
	const justify = node.props.justifyContent;

	if (justify === "space-between" && activeBoxes.length >= 2 && targetWidth > naturalWidth) {
		const totalBoxW = activeBoxes.reduce((sum, b) => sum + b.width, 0);
		const totalSpace = Math.max(columnGap * (activeBoxes.length - 1), targetWidth - totalBoxW);
		const baseGap = Math.floor(totalSpace / (activeBoxes.length - 1));
		const rem = totalSpace % (activeBoxes.length - 1);
		const items = activeBoxes.map((box, i) => ({
			box,
			gapBefore: i === 0 ? 0 : baseGap + (i <= rem ? 1 : 0),
		}));
		const joined = joinHorizontalRun(items, rowHeight);
		return { ...joined, intrinsicWidth };
	}

	const items = activeBoxes.map((box, i) => ({ box, gapBefore: i === 0 ? 0 : columnGap }));
	const joined = joinHorizontalRun(items, rowHeight);

	if ((justify === "flex-end" || justify === "center") && targetWidth > joined.width) {
		const spare = targetWidth - joined.width;
		const lead = justify === "flex-end" ? spare : Math.floor(spare / 2);
		const pad = " ".repeat(lead);
		return {
			lines: joined.lines.map((l) => pad + l),
			width: joined.width + lead,
			intrinsicWidth,
			hits: joined.hits.map((h) => ({ ...h, from: h.from + lead, to: h.to + lead })),
		};
	}

	return { ...joined, intrinsicWidth };
}

function renderColumnBox(node: RenderElement, innerMaxWidth: number, fixedInnerWidth?: number): RenderedBox {
	const children = node.children.filter((c) => c !== null && c !== undefined && typeof c !== "boolean");
	if (children.length === 0) return { lines: [], width: 0, intrinsicWidth: 0, hits: [] };

	const rowGap = Number(node.props.rowGap ?? 0);
	const firstPass = children.map((child) => ({
		child,
		box: renderNode(child, innerMaxWidth),
	}));

	const nonEmpty = firstPass.filter((entry) => entry.box.lines.length > 0);
	if (nonEmpty.length === 0) return { lines: [], width: 0, intrinsicWidth: 0, hits: [] };

	const intrinsicWidth = Math.min(innerMaxWidth, Math.max(0, ...nonEmpty.map((e) => e.box.intrinsicWidth)));
	const maxChildWidth = Math.min(innerMaxWidth, Math.max(0, ...nonEmpty.map((e) => e.box.width)));
	const targetInnerW = fixedInnerWidth ?? maxChildWidth;

	const allLines: string[] = [];
	const allHits: MouseHit[] = [];
	let finalWidth = targetInnerW;

	for (let i = 0; i < nonEmpty.length; i++) {
		if (i > 0 && rowGap > 0) {
			for (let g = 0; g < rowGap; g++) allLines.push("");
		}
		const { child, box: initialBox } = nonEmpty[i]!;
		let box = initialBox;
		const childEl = isRenderElement(child) ? child : undefined;

		if (
			childEl?.type === "Box" &&
			(childEl.props.flexDirection ?? "row") === "row" &&
			(childEl.props.justifyContent === "space-between" ||
				childEl.props.justifyContent === "flex-end" ||
				childEl.props.justifyContent === "center") &&
			childEl.props.width === undefined &&
			targetInnerW > box.width
		) {
			box = renderBoxElement(childEl, targetInnerW, targetInnerW);
		}

		const align =
			(typeof childEl?.props.alignSelf === "string" ? childEl.props.alignSelf : undefined) ??
			(typeof node.props.alignItems === "string" ? node.props.alignItems : undefined);
		const offsetX =
			align === "flex-end"
				? Math.max(0, targetInnerW - box.width)
				: align === "center"
					? Math.floor(Math.max(0, targetInnerW - box.width) / 2)
					: 0;
		const lead = offsetX > 0 ? " ".repeat(offsetX) : "";
		const yOffset = allLines.length;

		for (const hit of box.hits) {
			allHits.push({
				row: hit.row + yOffset,
				from: hit.from + offsetX,
				to: hit.to + offsetX,
				onPress: hit.onPress,
				key: hit.key,
			});
		}
		for (const line of box.lines) {
			allLines.push(lead + line);
		}
		if (box.width + offsetX > finalWidth) finalWidth = box.width + offsetX;
	}

	return {
		lines: allLines,
		width: finalWidth,
		intrinsicWidth,
		hits: allHits,
	};
}

function renderBoxElement(node: RenderElement, maxWidth: number, forcedOuterWidth?: number): RenderedBox {
	if (node.props.display === "none") return { lines: [], width: 0, intrinsicWidth: 0, hits: [] };

	const borderStyle = typeof node.props.borderStyle === "string" ? BORDERS[node.props.borderStyle] : undefined;
	const borderCols = borderStyle ? 2 : 0;
	const padLeft = Number(node.props.paddingLeft ?? node.props.paddingX ?? 0);
	const padRight = Number(node.props.paddingRight ?? node.props.paddingX ?? 0);
	const chromeCols = borderCols + padLeft + padRight;

	const explicitOuterW =
		forcedOuterWidth ??
		(node.props.width === "100%"
			? maxWidth
			: typeof node.props.width === "number"
				? Math.min(maxWidth, node.props.width)
				: undefined);
	const minOuterW = typeof node.props.minWidth === "number" ? Math.min(maxWidth, node.props.minWidth) : 0;

	const innerMaxW = Math.max(1, (explicitOuterW ?? maxWidth) - chromeCols);
	const fixedInnerW =
		explicitOuterW !== undefined
			? Math.max(0, explicitOuterW - chromeCols)
			: minOuterW > chromeCols
				? minOuterW - chromeCols
				: undefined;

	const dir = node.props.flexDirection === "column" ? "column" : "row";
	const inner =
		dir === "column"
			? renderColumnBox(node, innerMaxW, fixedInnerW)
			: renderRowBox(node, innerMaxW, fixedInnerW);

	if (inner.lines.length === 0 && !borderStyle && explicitOuterW === undefined) {
		return { lines: [], width: 0, intrinsicWidth: 0, hits: [] };
	}

	const contentW = Math.max(inner.width, fixedInnerW ?? 0);
	const bgColor = typeof node.props.backgroundColor === "string" ? node.props.backgroundColor : undefined;
	const bgAnsi = bgSgr(bgColor);
	const leftPadStr = " ".repeat(padLeft);
	const rightPadStr = " ".repeat(padRight);

	const bodyWidth = contentW + padLeft + padRight;
	const paddedLines = inner.lines.map((line) => {
		const withLeft = leftPadStr + line;
		if (borderStyle || bgAnsi) {
			return padLineRight(withLeft, contentW + padLeft, bgAnsi) + (bgAnsi ? `${bgAnsi}${rightPadStr}\x1b[0m` : rightPadStr);
		}
		return rightPadStr ? withLeft + rightPadStr : withLeft;
	});

	const shiftedHits = inner.hits.map((hit) => ({
		row: hit.row + (borderStyle ? 1 : 0),
		from: hit.from + padLeft + (borderStyle ? 1 : 0),
		to: hit.to + padLeft + (borderStyle ? 1 : 0),
		onPress: hit.onPress,
		key: hit.key,
	}));

	if (!borderStyle) {
		return {
			lines: paddedLines,
			width: bodyWidth,
			intrinsicWidth: inner.intrinsicWidth + chromeCols,
			hits: shiftedHits,
		};
	}

	const [tl, hBar, tr, vBar, bl, br] = borderStyle;
	const bColor = typeof node.props.borderColor === "string" ? node.props.borderColor : undefined;
	const paintBorder = (s: string) => (bColor ? `${fgSgr(bColor)}${s}\x1b[0m` : s);

	const topEdge = paintBorder(`${tl}${hBar.repeat(bodyWidth)}${tr}`);
	const botEdge = paintBorder(`${bl}${hBar.repeat(bodyWidth)}${br}`);
	const sideL = paintBorder(vBar);
	const sideR = paintBorder(vBar);

	const framedLines = [
		topEdge,
		...paddedLines.map((line) => `${sideL}${line}${sideR}`),
		botEdge,
	];

	return {
		lines: framedLines,
		width: bodyWidth + 2,
		intrinsicWidth: inner.intrinsicWidth + chromeCols,
		hits: shiftedHits,
	};
}

export function renderNode(node: RenderNode, maxWidth: number): RenderedBox {
	if (node === null || node === undefined || typeof node === "boolean") {
		return { lines: [], width: 0, intrinsicWidth: 0, hits: [] };
	}
	if (Array.isArray(node)) {
		return renderBoxElement({ type: "Box", props: { flexDirection: "column" }, children: node }, maxWidth);
	}
	if (typeof node === "string" || typeof node === "number") {
		return renderTextElement({ type: "Text", props: {}, children: [String(node)] }, maxWidth);
	}
	switch (node.type) {
		case "Box":
		case "Fragment":
			return renderBoxElement(node, maxWidth);
		case "Text":
			return renderTextElement(node, maxWidth);
		case "Button":
			return renderButtonElement(node, maxWidth);
		case "Link":
			return renderTextElement({ type: "Text", props: {}, children: [node] }, maxWidth);
		case "Image":
			return renderImageElement(node, maxWidth);
		default:
			return renderBoxElement(node, maxWidth);
	}
}

const PI_THEME_SYMBOL = Symbol.for("@earendil-works/pi-coding-agent:theme");

function currentPiThemeColors(): unknown {
	return (globalThis as Record<symbol, { colors?: unknown } | undefined>)[PI_THEME_SYMBOL]?.colors;
}

export class PrismantisComponent implements Component {
	private readonly buildTree: (width: number) => RenderNode;
	private readonly paddingX: number;
	private cachedWidth?: number;
	private cachedThemeColors?: unknown;
	private cachedLines?: string[];
	private cachedHits: MouseHit[] = [];
	private tree?: { width: number; node: RenderNode };

	constructor(buildTree: (width: number) => RenderNode, paddingX = 0) {
		this.buildTree = buildTree;
		this.paddingX = paddingX;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
		this.cachedHits = [];
		this.tree = undefined;
	}

	repaintHover(): void {
		this.cachedLines = undefined;
	}

	render(width: number): string[] {
		const themeColors = currentPiThemeColors();
		if (themeColors !== this.cachedThemeColors) {
			this.invalidate();
			this.cachedThemeColors = themeColors;
		}
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}
		const contentWidth = Math.max(20, width - this.paddingX * 2);
		if (this.tree?.width !== contentWidth) {
			this.tree = { width: contentWidth, node: this.buildTree(contentWidth) };
		}
		litKey = hoveredKey(this);
		let rendered: RenderedBox;
		try {
			rendered = renderNode(this.tree.node, contentWidth);
		} finally {
			litKey = undefined;
		}
		const pad = this.paddingX > 0 ? " ".repeat(this.paddingX) : "";
		this.cachedWidth = width;
		this.cachedHits = rendered.hits.map((h) => ({
			...h,
			from: h.from + this.paddingX,
			to: h.to + this.paddingX,
		}));
		this.cachedLines = rendered.lines.map((line) =>
			visibleWidth(pad + line) > width ? truncateToWidth(pad + line, width) : pad + line,
		);
		return this.cachedLines;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "move") {
			return pointerMoved(this, this.hitAt(event)?.key);
		}
		if (event.button !== "left") return undefined;
		const hit = this.hitAt(event);
		if (!hit) return undefined;
		if (event.type === "click") {
			hit.onPress();
		}
		return event.type === "press" || event.type === "click" ? { handled: true } : undefined;
	}

	private hitAt(event: TuiMouseEvent): MouseHit | undefined {
		return this.cachedHits.find((h) => h.row === event.y && event.x >= h.from && event.x < h.to);
	}
}
