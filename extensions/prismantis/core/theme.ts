import type { ClipboardBackend } from "./clipboard.ts";
import type { PluginOptions } from "./jsx.ts";
import { TERMINALS, type Shape, type Terminal } from "./rtl.ts";

export const TOKENS = [
	"accent",
	"heading",
	"strong",
	"emphasis",
	"inlineCode",
	"codeText",
	"codeCommand",
	"codeFlag",
	"codeString",
	"codeComment",
	"link",
	"path",
	"number",
	"quote",
	"rule",
	"tableHeader",
	"tableRule",
	"bullet",
	"diagram",
	"diagramText",
	"diffAdded",
	"diffRemoved",
] as const;

export type Theme = Partial<Record<(typeof TOKENS)[number], string>>;

export const DEFAULT_THEME: Theme = {
	accent: "#cba6f7",
	heading: "#f9e2af",
	tableHeader: "#f9e2af",
	strong: "#ffffff",
	emphasis: "#f5c2e7",
	inlineCode: "#89dceb",
	codeText: "#cdd6f4",
	codeCommand: "#89b4fa",
	codeFlag: "#f38ba8",
	codeString: "#a6e3a1",
	codeComment: "#6c7086",
	link: "#89b4fa",
	path: "#89dceb",
	number: "#a6e3a1",
	quote: "#9399b2",
	rule: "#45475a",
	tableRule: "#585b70",
	bullet: "#cba6f7",
	diagram: "#89b4fa",
	diagramText: "#cdd6f4",
	diffAdded: "#a6e3a1",
	diffRemoved: "#f38ba8",
};

export type Clock = "off" | "24h" | "12h";

export type Style = {
	theme: Theme;
	headingStyle: "bold" | "underline" | "uppercase" | "banner";
	tableStyle: "box" | "rules" | "grid" | "minimal";
	taskStyle: "checks" | "ticks" | "box" | "progress";
	promptStyle: "bubble" | "wide" | "bar" | "chevron" | "off";
	clock: Clock;
	inside?: "quote" | "alert";
	noteKey?: string;
	pieStyle: "round" | "bars";
	highlightNumbers: boolean;
	highlightPaths: boolean;
	mermaid: boolean;
	mermaidAscii: boolean;
	copyButtons: boolean;
	copyButtonStyle: "inline" | "hover";
	htmlCopy: ClipboardBackend | null;
	httpLinks: boolean;
	editorLinks: boolean;
	fileLinks: string | null;
	pathLinks: boolean;
	found?: ReadonlySet<string>;
	diagramHints: boolean;
	rtl: "auto" | Terminal | "off";
	reorder: boolean;
	shape: Shape;
	latex: boolean;
	cwd: string;
	home: string;
};

const COLOR =
	/^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|ansi256\(\d{1,3}\)|(black|red|green|yellow|blue|magenta|cyan|white|gray|grey)(Bright)?)$/i;

export const isColor = (value: unknown): value is string => typeof value === "string" && COLOR.test(value.trim());

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
	allowed.includes(value as T) ? (value as T) : fallback;

export const resolveStyle = (options: PluginOptions, baseTheme: Theme = DEFAULT_THEME): Style => {
	const fromFields = Object.fromEntries(
		TOKENS.filter((k) => isColor(options[`${k}Color`])).map((k) => [k, String(options[`${k}Color`]).trim()]),
	);

	const rtl = pick(options.rtl, ["auto", "off", ...(Object.keys(TERMINALS) as Terminal[])], "auto");

	return {
		theme: { ...baseTheme, ...fromFields },
		headingStyle: pick(options.headingStyle, ["bold", "underline", "uppercase", "banner"] as const, "banner"),
		tableStyle: pick(options.tableStyle, ["box", "rules", "grid", "minimal"] as const, "box"),
		taskStyle: pick(options.taskStyle, ["checks", "ticks", "box", "progress"] as const, "checks"),
		promptStyle: pick(options.promptStyle, ["bubble", "wide", "bar", "chevron", "off"] as const, "bubble"),
		clock: pick(options.clock, ["off", "24h", "12h"] as const, "off"),
		pieStyle: pick(options.pieStyle, ["round", "bars"] as const, "round"),
		highlightNumbers: options.highlightNumbers !== false,
		highlightPaths: options.highlightPaths !== false,
		mermaid: options.mermaid !== false,
		mermaidAscii: options.mermaidAscii === true,
		copyButtons: options.copyButtons !== false,
		copyButtonStyle: pick(options.copyButtonStyle, ["inline", "hover"] as const, "inline"),
		htmlCopy: null,
		httpLinks: false,
		editorLinks: false,
		fileLinks: null,
		pathLinks: false,
		diagramHints: options.diagramHints !== false && options.mermaid !== false,
		rtl,
		reorder: rtl !== "auto" && rtl !== "off",
		shape: rtl === "auto" || rtl === "off" ? "visual" : TERMINALS[rtl],
		latex: options.latex === true,
		cwd: "",
		home: "",
	};
};
