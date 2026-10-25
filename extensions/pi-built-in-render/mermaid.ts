import { createRequire } from "node:module";
import { join } from "node:path";
import { getPackageDir, type Theme as PiTheme } from "@earendil-works/pi-coding-agent";
import { Marked } from "@earendil-works/pi-tui";

type Span = {
	readonly cls: "border" | "text" | "edge" | "edgeLabel" | "title" | "none";
	readonly text: string;
};
type MermaidArt = {
	readonly width: number;
	readonly warnings: readonly string[];
	readonly plain: readonly string[];
	readonly styled: readonly (readonly Span[])[];
};

const { render }: { render: (source: string) => MermaidArt | null } =
	createRequire(join(getPackageDir(), "package.json"))("grok-mermaid");
const parser = new Marked();

export function diagramCodeSpan(row: string): string {
	const content = row || "\u00a0";
	const longestRun = Math.max(0, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length));
	const delimiter = "`".repeat(longestRun + 1);
	const padding = content.startsWith("`") || content.endsWith("`") ? " " : "";
	return `${delimiter}${padding}${content}${padding}${delimiter}`;
}

function styleSpan(span: Span, theme: PiTheme): string {
	switch (span.cls) {
		case "border": return theme.fg("borderMuted", span.text);
		case "text": return theme.fg("text", span.text);
		case "edge": return theme.fg("accent", span.text);
		case "edgeLabel": return theme.fg("muted", span.text);
		case "title": return theme.fg("accent", theme.bold(span.text));
		case "none": return span.text;
		default: {
			const _exhaustive: never = span.cls;
			return _exhaustive;
		}
	}
}

export function transformBuiltInMermaid(markdown: string, availableWidth: number, piTheme?: PiTheme): string {
	return parser.lexer(markdown).map((token) => {
		if (token.type !== "code" || token.lang?.trim().split(/\s+/, 1)[0]?.toLowerCase() !== "mermaid") {
			return token.raw;
		}
		const art = render(token.text);
		if (!art || art.width > availableWidth) return token.raw;
		if (art.warnings.length > 0) {
			const suffix = art.warnings.length > 1 ? ` (+${art.warnings.length - 1} more)` : "";
			const warning = `Mermaid diagram not rendered: ${art.warnings[0]}${suffix}`;
			const styledWarning = piTheme ? piTheme.fg("warning", warning) : warning;
			return `${token.raw}\n${diagramCodeSpan(styledWarning)}  \n`;
		}
		const rows = piTheme
			? art.styled.map((row) => row.map((span) => styleSpan(span, piTheme)).join(""))
			: art.plain;
		return `${rows.map(diagramCodeSpan).join("  \n")}\n`;
	}).join("");
}
