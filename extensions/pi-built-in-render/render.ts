import { getMarkdownTheme, renderDiff, type Theme as PiTheme } from "@earendil-works/pi-coding-agent";
import { Image, Markdown, Text, type Component } from "@earendil-works/pi-tui";
import { transformBuiltInMermaid } from "./mermaid.ts";

export const ENTRY_TYPE = "pi-built-in-render" as const;

export type SectionBlock =
	| { readonly kind: "markdown"; readonly source: string }
	| { readonly kind: "diff"; readonly numberedDiff: string }
	| {
		readonly kind: "image";
		readonly mimeType: "image/png";
		readonly base64: string;
		readonly filename: string;
	};

export type DemoDocument = {
	readonly version: 1;
	readonly blocks: readonly [SectionBlock, ...SectionBlock[]];
};

export type DecodedDocument =
	| { readonly kind: "valid"; readonly document: DemoDocument }
	| { readonly kind: "invalid"; readonly explanation: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isSafeText(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 1_048_576
		&& !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(value);
}

function isPngBase64(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0 || value.length > 4 * Math.ceil(262_144 / 3)) return false;
	if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
	const bytes = Buffer.from(value, "base64");
	return bytes.length <= 262_144 && bytes.toString("base64") === value
		&& bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function isSectionBlock(value: unknown): value is SectionBlock {
	if (!isPlainObject(value)) return false;
	switch (value.kind) {
		case "markdown": return isSafeText(value.source);
		case "diff": return isSafeText(value.numberedDiff);
		case "image": return value.mimeType === "image/png" && isSafeText(value.filename) && isPngBase64(value.base64);
		default: return false;
	}
}

export function decodeDocument(value: unknown): DecodedDocument {
	if (!isPlainObject(value) || value.version !== 1 || !Array.isArray(value.blocks)
		|| value.blocks.length === 0 || value.blocks.length > 64) {
		return { kind: "invalid", explanation: "Cannot render built-in demo. Invalid document or unsupported version." };
	}
	const blocks: SectionBlock[] = [];
	for (const block of value.blocks) {
		if (!isSectionBlock(block)) {
			return { kind: "invalid", explanation: "Cannot render built-in demo. Invalid block data." };
		}
		blocks.push(block);
	}
	const [first, ...rest] = blocks;
	if (!first) return { kind: "invalid", explanation: "Cannot render built-in demo. Empty document." };
	return { kind: "valid", document: { version: 1, blocks: [first, ...rest] } };
}

export class BuiltInDocumentComponent implements Component {
	private children: (Component | undefined)[] = [];

	private readonly document: DemoDocument;
	private readonly piTheme?: PiTheme;
	private readonly outputPad: number;

	constructor(document: DemoDocument, piTheme?: PiTheme, outputPad = 1) {
		this.document = document;
		this.piTheme = piTheme;
		this.outputPad = outputPad;
	}

	private makeChild(block: SectionBlock): Component {
		switch (block.kind) {
			case "markdown":
				return new Markdown(block.source, this.outputPad, 0, getMarkdownTheme(), undefined, {
					renderLatex: true,
					transform: (md, width) => transformBuiltInMermaid(md, width, this.piTheme),
				});
			case "diff":
				return new Text(renderDiff(block.numberedDiff), this.outputPad, 0);
			case "image":
				return new Image(block.base64, block.mimeType, { fallbackColor: (s) => getMarkdownTheme().code(s) }, {
					filename: block.filename,
					maxWidthCells: 32,
					maxHeightCells: 10,
				});
			default: {
				const _exhaustive: never = block;
				return _exhaustive;
			}
		}
	}

	render(width: number): string[] {
		const lines: string[] = [];
		this.document.blocks.forEach((block, index) => {
			const child = this.children[index] ?? this.makeChild(block);
			this.children[index] = child;
			if (index > 0) lines.push("");
			lines.push(...child.render(width));
		});
		return lines;
	}

	invalidate(): void {
		this.children = this.children.map((child) => {
			child?.invalidate();
			return child instanceof Image ? child : undefined;
		});
	}
}
