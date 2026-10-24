import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme as PiTheme } from "@earendil-works/pi-coding-agent";
import {
	AssistantMessageComponent,
	copyToClipboard,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	getCapabilities,
	Markdown,
	matchesKey,
	Spacer,
	Text,
	type Component,
	type OverlayOptions,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

import { clipboardCommand, type ClipboardBackend } from "./core/clipboard.ts";
import { FIGURE_HINT } from "./core/figure.ts";
import {
	helpText,
	HINT,
	languageShowcase,
	rtlShowcaseText,
	SETUP_DONE,
	SETUP_PANE_KEYS,
	SETUP_PANE_OPENED,
	setupSteps,
	setupText,
	showcaseText,
	THEME_PREVIEW,
	type SetupParts,
	type SetupStep,
} from "./core/help.ts";
import { EL, h, type RenderElement } from "./core/jsx.ts";
import {
	fitImage,
	fitsImage,
	imageFile,
	imageOf,
	keepFormulas,
	LATEX_DPR,
	LATEX_FONT_PX,
	mathOf,
	MAX_IMAGE_BYTES,
	padFor,
	pickFormula,
	pngSize,
	ratexColor,
	renderedOf,
	type Formula,
} from "./core/latex.ts";
import { nestedBlocks, parse, type Block } from "./core/markdown.ts";
import { drawDiagrams } from "./core/mermaid.ts";
import { PRESET_NAMES } from "./core/presets.ts";
import {
	 drawMath,
	drawsHyperlinks,
	fileRoot,
	instanceKey,
	MARK,
	markerRoom,
	mirrored,
	noteTip,
	pathsToProbe,
	remember,
	renderBlocks,
	type CopyButton,
	type Fold,
	type TerminalEnv,
} from "./core/render.ts";
import { hasRtl, opensLatin, ROW_MARK_TEXT, TERMINALS, type Terminal } from "./core/rtl.ts";
import { pickTheme, RANDOM_THEMES, resolveStyle, type Style } from "./core/theme.ts";
import { clearHover, watchPointerLeave } from "../lib/pointer-hover.ts";
import { PrismantisComponent, renderNode } from "./renderer.ts";

const CUSTOM_MESSAGE_TYPE = "prismantis-output";
const THEME_ARGS = [...PRESET_NAMES, "random"];
const LATEX_HINT =
	"This terminal typesets LaTeX math: a formula in $$…$$ on lines of its own, or in a ```math block, renders as an image (KaTeX syntax). Inline $…$ does not render, so write inline math as plain text or Unicode.";

export type PrismantisOptions = Record<string, unknown> & {
	enabled?: boolean;
	theme?: string;
	syncPiTheme?: boolean;
};

const DEFAULT_OPTIONS: PrismantisOptions = {
	enabled: true,
	theme: "catppuccin-mocha",
	headingStyle: "banner",
	tableStyle: "box",
	taskStyle: "checks",
	pieStyle: "round",
	rtl: "auto",
	highlightNumbers: true,
	highlightPaths: true,
	mermaid: true,
	mermaidAscii: false,
	copyButtons: true,
	copyButtonStyle: "inline",
	diagramHints: true,
	latex: false,
	syncPiTheme: true,
};

export const storePath = () => join(getAgentDir(), "prismantis.json");

export function loadOptions(): PrismantisOptions {
	try {
		const raw = JSON.parse(readFileSync(storePath(), "utf8"));
		if (raw && typeof raw === "object" && !Array.isArray(raw)) {
			return { ...DEFAULT_OPTIONS, ...(raw as Record<string, unknown>) };
		}
	} catch {
	}
	return { ...DEFAULT_OPTIONS };
}

export function saveOptions(options: PrismantisOptions): boolean {
	try {
		mkdirSync(getAgentDir(), { recursive: true });
		writeFileSync(storePath(), `${JSON.stringify(options, null, 2)}\n`);
		return true;
	} catch {
		return false;
	}
}

function detectTerminalFromEnv(env: NodeJS.ProcessEnv = process.env): Terminal | null {
	const program = env.TERM_PROGRAM;
	const term = env.TERM;
	if (env.KITTY_WINDOW_ID || term === "xterm-kitty") return "kitty";
	if (program === "Apple_Terminal") return "apple-terminal";
	if (program === "WarpTerminal") return "warp";
	if (program === "ghostty") return "ghostty";
	if (program === "WezTerm") return "wezterm";
	if (program === "vscode") return "vscode";
	if (program === "iTerm.app") return "iterm";
	if (term === "alacritty" || env.ALACRITTY_WINDOW_ID) return "alacritty";
	if (env.WT_SESSION) return "windows-terminal";
	if (env.VTE_VERSION) return "gnome";
	if (env.KONSOLE_VERSION) return "konsole";
	return null;
}

function detectHtmlClipboardBackend(env: NodeJS.ProcessEnv = process.env): ClipboardBackend | null {
	if (env.SSH_CONNECTION || env.SSH_TTY) return null;
	if (env.OS === "Windows_NT" || process.platform === "win32") return "windows";
	if (process.platform === "darwin" && existsSync("/usr/bin/osascript")) return "macos";
	if (env.WAYLAND_DISPLAY || env.DISPLAY) return "linux";
	return null;
}

function detectTerminalEnv(env: NodeJS.ProcessEnv = process.env): TerminalEnv {
	return {
		FORCE_HYPERLINK: env.FORCE_HYPERLINK,
		TERM_PROGRAM: env.TERM_PROGRAM,
		TERM_PROGRAM_VERSION: env.TERM_PROGRAM_VERSION,
		TERM: env.TERM,
		WT_SESSION: env.WT_SESSION,
		LC_TERMINAL: env.LC_TERMINAL,
		VTE_VERSION: env.VTE_VERSION,
		TERMINAL_EMULATOR: env.TERMINAL_EMULATOR,
	};
}

function applyTerminalCapabilities(style: Style, cwd: string): Terminal | null {
	style.cwd = cwd || process.cwd();
	style.home = homedir();
	style.htmlCopy = detectHtmlClipboardBackend();

	const overSsh = Boolean(process.env.SSH_CONNECTION || process.env.SSH_TTY);
	const hyperlinks = getCapabilities().hyperlinks || drawsHyperlinks(detectTerminalEnv());
	style.httpLinks = hyperlinks;
	style.editorLinks = hyperlinks;
	if (hyperlinks && !overSsh) {
		const distro = process.env.WSL_DISTRO_NAME;
		const linuxTerm =
			distro !== undefined &&
			Boolean(process.env.VTE_VERSION || process.env.KONSOLE_VERSION || process.env.KITTY_WINDOW_ID);
		style.fileLinks = fileRoot(linuxTerm ? undefined : distro);
		style.pathLinks = true;
	} else {
		style.fileLinks = null;
		style.pathLinks = false;
	}

	if (style.rtl === "off") return null;
	if (style.rtl !== "auto") return style.rtl;
	const terminal = detectTerminalFromEnv();
	style.reorder = terminal !== null;
	if (terminal) style.shape = TERMINALS[terminal];
	return terminal;
}

function copyHtmlTableSync(backend: ClipboardBackend, html: string, text: string): string | null {
	const systemRoot = backend === "windows" ? process.env.SystemRoot : undefined;
	const command = clipboardCommand(backend, html, text, systemRoot);
	if (backend === "windows" && !systemRoot) return command.failure;
	const [bin, ...args] = command.argv;
	if (!bin) return command.failure;
	try {
		const res = spawnSync(bin, args, {
			input: command.stdin,
			encoding: "utf8",
			timeout: 5000,
		});
		if (res.error) return command.failure;
		return res.status === 0 ? null : (res.stderr || "").trim() || command.failure;
	} catch {
		return command.failure;
	}
}

function codeSpan(line: string): string {
	const content = line || "\u00a0";
	const longestBacktickRun = Math.max(0, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length));
	const fence = "`".repeat(longestBacktickRun + 1);
	const padding = content.startsWith("`") || content.endsWith("`") ? " " : "";
	return `${fence}${padding}\x1b[39m${content}${padding}${fence}`;
}

type ActiveMessageHooks = {
	isEnabled: () => boolean;
	renderAssistantText: (text: string, isFirstOfReply: boolean, messageId: string, outputPad: number) => Component;
};

let activeHooks: ActiveMessageHooks | null = null;
const WRAPPED_MARK = Symbol.for("pi-stuff:prismantis-wrapped");

function ensureMessagePrototypesPatched() {
	const proto = AssistantMessageComponent.prototype as any;
	if (!proto.updateContent?.[WRAPPED_MARK]) {
		const prevUpdate = proto.updateContent;
		const wrappedUpdate = function (this: any, message: any, isStreaming = this.isStreaming) {
			prevUpdate.call(this, message, isStreaming);
			if (!activeHooks?.isEnabled() || !message || !Array.isArray(message.content) || !this.contentContainer?.children) {
				return;
			}
			const textBlocks = message.content.filter((c: any) => c?.type === "text" && c.text?.trim());
			if (textBlocks.length === 0) return;

			const baseId = String(message.timestamp ?? "msg");
			let textIdx = 0;
			const children: Component[] = this.contentContainer.children;
			for (let i = 0; i < children.length && textIdx < textBlocks.length; i++) {
				if (children[i] instanceof Markdown) {
					const text = textBlocks[textIdx]!.text.trim();
					children[i] = activeHooks.renderAssistantText(text, textIdx === 0, `${baseId}:${textIdx}`, this.outputPad ?? 1);
					textIdx++;
				}
			}
		};
		(wrappedUpdate as any)[WRAPPED_MARK] = true;
		proto.updateContent = wrappedUpdate;
	}
}

const SETUP_LIST_COLUMNS = 28;
const SETUP_HEAD_ROWS = 8;

const KEPT_SETUP_KEYS: ReadonlySet<SetupStep["key"]> = new Set(["theme", "tableStyle", "taskStyle", "headingStyle", "copyButtonStyle", "pieStyle"]);
const SETUP_STEPS = setupSteps(PRESET_NAMES).filter((step) => KEPT_SETUP_KEYS.has(step.key));

function setupPartsAt(at: number): SetupParts {
	const step = SETUP_STEPS[at]!;
	const next = SETUP_STEPS[at + 1];
	return {
		head: `## Setup ${at + 1}/${SETUP_STEPS.length}: ${step.title}\n\n${step.note}`,
		options: step.options.map((value, i) => ({
			value,
			text: `### ${i + 1}. ${value}${step.key === "theme" && value !== "mono" && !RANDOM_THEMES.includes(value) ? " (for a light terminal)" : ""}${step.sample ? `\n\n${step.sample}` : ""}`,
		})),
		tail: `Pick with \`/prismantis setup ${step.name} <number or name>\`${step.key === "theme" ? " or `random`" : ""}.${next ? ` Skip with \`/prismantis setup ${next.name}\`.` : ""} Stop any time, \`/prismantis setup\` starts over.`,
	};
}

type FoundSetup = { at: number; before: string; parts: SetupParts };

function findSetupIn(text: string): FoundSetup | undefined {
	for (let at = 0; at < SETUP_STEPS.length; at++) {
		const parts = setupPartsAt(at);
		const whole = setupText(parts);
		if (text.endsWith(whole)) return { at, before: text.slice(0, -whole.length).trim(), parts };
	}
	return undefined;
}

const SETUP_TABLE = "| Item | Qty |\n|:-----|----:|\n| Apples | 3 |\n| Pears | 5 |";
function copySample(style: Style, value: string, id: string, columns: number): RenderElement[] {
	const label: CopyButton = (_text, key, name = "⧉ copy", html) =>
		html && !style.htmlCopy ? null : h(EL.Text, { key, bold: true }, `[ ${name} ]`);
	const table = renderBlocks(
		EL,
		style,
		parse(SETUP_TABLE, { numbers: style.highlightNumbers, paths: style.highlightPaths }),
		columns,
		new Map(),
		label,
	);
	return [
		h(EL.Box, { key: `${id}t`, flexDirection: "column" }, ...table),
		...(value === "hover" ? [h(EL.Text, { key: `${id}h`, dimColor: true }, "Its buttons show only while the pointer is on its ⧉.")] : []),
	];
}

export function drawSetupElements(
	base: Style,
	options: PrismantisOptions,
	found: FoundSetup,
	columns: number,
	drawMd: (style: Style, blocks: Block[], cols: number) => RenderElement[],
): RenderElement[] {
	const key = SETUP_STEPS[found.at]!.key;
	const md = (style: Style, text: string, id: string) =>
		h(
			EL.Box,
			{ key: id, flexDirection: "column", rowGap: 1 },
			...drawMd(style, parse(text, { numbers: style.highlightNumbers, paths: style.highlightPaths }), columns),
		);
	const sample = (style: Style, value: string, id: string): RenderElement[] =>
		key === "copyButtonStyle" ? copySample(style, value, id, columns) : [];
	const picks = found.parts.options.map(({ value, text }, i) => {
		const style = key === "theme" ? { ...base, theme: resolveStyle({ ...options, theme: value }).theme } : { ...base, [key]: value };
		return h(EL.Box, { key: `o${i}`, flexDirection: "column" }, md(style, text, "m"), ...sample(style, value, "x"));
	});
	return [
		...(found.before ? [md(base, found.before, "before")] : []),
		md(base, found.parts.head, "head"),
		...picks,
		md(base, found.parts.tail, "tail"),
	];
}

class SetupPaneComponent implements Component {
	private stepIndex = 0;
	private focusedValue = "";
	private lastHits: { row: number; from: number; to: number; onPress: () => void }[] = [];
	private readonly tui: TUI;
	private readonly piTheme: PiTheme;
	private readonly getState: () => { style: Style; options: PrismantisOptions; pickedTheme: string };
	private readonly onPick: (step: SetupStep, value: string) => void;
	private readonly drawMd: (style: Style, blocks: Block[], cols: number) => RenderElement[];
	private readonly close: () => void;

	constructor(
		tui: TUI,
		piTheme: PiTheme,
		getState: () => { style: Style; options: PrismantisOptions; pickedTheme: string },
		onPick: (step: SetupStep, value: string) => void,
		drawMd: (style: Style, blocks: Block[], cols: number) => RenderElement[],
		close: () => void,
	) {
		this.tui = tui;
		this.piTheme = piTheme;
		this.getState = getState;
		this.onPick = onPick;
		this.drawMd = drawMd;
		this.close = close;
		this.syncFocusToCurrentStep();
	}

	private currentStep(): SetupStep {
		return SETUP_STEPS[Math.min(this.stepIndex, SETUP_STEPS.length - 1)]!;
	}

	private choicesFor(step: SetupStep): readonly string[] {
		return step.key === "theme" ? THEME_ARGS : step.options;
	}

	private currentValueOf(step: SetupStep): string {
		const { style, options, pickedTheme } = this.getState();
		if (step.key === "theme") {
			return options.theme === "random" ? "random" : pickedTheme;
		}
		return String(style[step.key]);
	}

	private syncFocusToCurrentStep(): void {
		const step = this.currentStep();
		this.focusedValue = this.currentValueOf(step);
	}

	private moveFocus(delta: number): void {
		const step = this.currentStep();
		const choices = this.choicesFor(step);
		const currentIdx = Math.max(0, choices.indexOf(this.focusedValue));
		const nextIdx = (currentIdx + delta + choices.length) % choices.length;
		this.focusedValue = choices[nextIdx]!;
		this.tui.requestRender();
	}

	private confirmCurrent(): void {
		const step = this.currentStep();
		const value = this.focusedValue || this.currentValueOf(step);
		this.onPick(step, value);
		if (this.stepIndex + 1 < SETUP_STEPS.length) {
			this.stepIndex++;
			this.syncFocusToCurrentStep();
			this.tui.requestRender();
		} else {
			this.close();
		}
	}

	render(width: number): string[] {
		const innerWidth = Math.max(40, width - 4);
		const { style, options, pickedTheme } = this.getState();
		const step = this.currentStep();
		const choices = this.choicesFor(step);
		const currentVal = this.currentValueOf(step);
		const shown = choices.includes(this.focusedValue) ? this.focusedValue : currentVal;
		const sampled = shown === "random" ? pickedTheme : shown;
		const parts = setupPartsAt(this.stepIndex);
		const previewOptions = parts.options
			.filter((o) => o.value === sampled)
			.map((o) => (step.key === "theme" ? { ...o, text: `${o.text.split("\n\n")[0]}\n\n${THEME_PREVIEW}` } : o));

		const baseStyle: Style = { ...style, copyButtons: false, pathLinks: false };
		const previewCols = Math.max(36, innerWidth - SETUP_LIST_COLUMNS - 4);
		const drawn = drawSetupElements(
			baseStyle,
			options,
			{ at: this.stepIndex, before: "", parts: { ...parts, options: previewOptions, tail: "" } },
			previewCols,
			this.drawMd,
		);

		const buttons = choices.map((value) =>
			h(EL.Button, {
				key: `pick:${step.name}:${value}`,
				label: value === currentVal ? `${value} (now)` : value,
				variant: value === shown ? "primary" : "secondary",
				onPress: () => {
					this.focusedValue = value;
					this.confirmCurrent();
				},
			}),
		);

		const tree = h(
			EL.Box,
			{ flexDirection: "column", rowGap: 1 },
			h(EL.Box, { flexDirection: "column" }, drawn[0]),
			h(EL.Box, {}, h(EL.Text, { dimColor: true }, SETUP_PANE_KEYS)),
			h(
				EL.Box,
				{ flexDirection: "row", columnGap: 4 },
				h(EL.Box, { flexDirection: "column", width: SETUP_LIST_COLUMNS }, ...buttons),
				h(EL.Box, { flexDirection: "column", flexGrow: 1 }, ...drawn.slice(1, -1)),
			),
		);

		const rendered = renderNode(tree, innerWidth);
		const maxRows = Math.max(12, (this.tui.terminal.rows ?? 40) - SETUP_HEAD_ROWS);
		const bodyLines = rendered.lines.slice(0, maxRows);
		this.lastHits = rendered.hits
			.filter((hit) => hit.row < maxRows)
			.map((hit) => ({
				row: hit.row + 1,
				from: hit.from + 2,
				to: hit.to + 2,
				onPress: hit.onPress,
			}));

		const edge = (left: string, label: string, right: string) => {
			const text = label ? ` ${label} ` : "";
			const fill = Math.max(0, width - 2 - visibleWidth(text) - 1);
			return this.piTheme.fg("border", `${left}─${text}${"─".repeat(fill)}${right}`);
		};

		return [
			edge("╭", this.piTheme.bold("prismantis setup"), "╮"),
			...bodyLines.map((l) => {
				const cut = truncateToWidth(l, innerWidth);
				const pad = Math.max(0, innerWidth - visibleWidth(cut));
				return `${this.piTheme.fg("border", "│")} ${cut}${" ".repeat(pad)} ${this.piTheme.fg("border", "│")}`;
			}),
			edge("╰", this.piTheme.fg("dim", `Step ${this.stepIndex + 1}/${SETUP_STEPS.length} · Esc close`), "╯"),
		].map((l) => truncateToWidth(l, width));
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.close();
		} else if (matchesKey(data, "up") || matchesKey(data, "shift+tab")) {
			this.moveFocus(-1);
		} else if (matchesKey(data, "down") || matchesKey(data, "tab")) {
			this.moveFocus(1);
		} else if (matchesKey(data, "enter")) {
			this.confirmCurrent();
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.button !== "left") return undefined;
		const hit = this.lastHits.find((h) => h.row === event.y && event.x >= h.from && event.x < h.to);
		if (!hit) return undefined;
		if (event.type === "click") hit.onPress();
		return event.type === "press" || event.type === "click" ? { handled: true } : undefined;
	}

	invalidate(): void {}
}

type TypesetFormula = Exclude<Formula, { error: true }> & { tex: string };
type LoadedPicture = { png: string; width: number; height: number; alt: string };
type PathChecks = { asked: Set<string>; found: Set<string> };
const MAX_FOUND_PATHS = 2000;

export default function prismantisExtension(pi: ExtensionAPI) {
	ensureMessagePrototypesPatched();

	let options = loadOptions();
	let pickedTheme = pickTheme(options.theme);
	let style = resolveStyle({ ...options, theme: pickedTheme });
	let uiCtx: ExtensionContext | undefined;
	let tuiInstance: TUI | undefined;
	let screenTui: TUI | undefined;

	const parsedCache = new Map<string, ReturnType<typeof parse>>();
	const unfolded = new Set<string>();
	const pathChecks: PathChecks = { asked: new Set<string>(), found: new Set<string>() };
	let formulasStore: Record<string, Formula> = {};
	const pictureCache = new Map<string, LoadedPicture | null>();
	const latexSuffix = randomUUID();

	const parseCached = (text: string, limit = 200) =>
		remember(
			parsedCache,
			`${+style.highlightNumbers}:${+style.highlightPaths}:${text}`,
			() => parse(text, { numbers: style.highlightNumbers, paths: style.highlightPaths }),
			limit,
		);

	function refreshFromDisk(cwd?: string): void {
		options = loadOptions();
		if (options.theme !== "random" || !RANDOM_THEMES.includes(pickedTheme)) {
			pickedTheme = pickTheme(options.theme);
		}
		style = resolveStyle({ ...options, theme: pickedTheme });
		applyTerminalCapabilities(style, cwd ?? uiCtx?.cwd ?? process.cwd());
	}

	function syncPiUiTheme(ctx: ExtensionContext | undefined): void {
		if (!ctx || ctx.mode !== "tui" || options.enabled === false || options.syncPiTheme === false) return;
		const targetTheme = `prismantis-${pickedTheme}`;
		const all = ctx.ui.getAllThemes?.() ?? [];
		if (all.some((t) => t.name === targetTheme)) {
			ctx.ui.setTheme(targetTheme);
		}
	}

	function notify(text: string, level: "info" | "warning" | "error" = "info"): void {
		uiCtx?.ui.notify(text, level);
	}

	// A transcript notice would push the pressed button out from under the pointer, so copy results float as a flash.
	function toast(text: string, level: "info" | "warning" | "error" = "info"): void {
		const flash = (screenTui as unknown as { flash?: (message: string, durationMs?: number) => void } | undefined)?.flash;
		if (typeof flash === "function") flash.call(screenTui, text, level === "info" ? undefined : 4000);
		else notify(text, level);
	}

	function requestRender(): void {
		tuiInstance?.requestRender();
	}

	function makeFolder(onInvalidate?: () => void): Fold {
		return (id, hidden, key, look) => {
			const folded = !unfolded.has(id);
			const label = folded ? (look?.label ?? `+${hidden} more lines`) : "show less";
			const toggle = () => {
				if (folded) {
					unfolded.add(id);
					if (unfolded.size > 500) {
						const first = unfolded.values().next().value;
						if (first !== undefined) unfolded.delete(first);
					}
				} else {
					unfolded.delete(id);
				}
				onInvalidate?.();
				requestRender();
			};
			return {
				folded,
				faced: false,
				element: h(EL.Button, { key, variant: "secondary", label, onPress: toggle }),
			};
		};
	}

	function makeCopyButton(): CopyButton {
		return (text, key, label = "⧉ copy", html) => {
			if (!style.copyButtons || (html && !style.htmlCopy)) return null;
			return h(EL.Button, {
				key,
				variant: "primary",
				label,
				onPress: () => {
					const content = typeof text === "function" ? text() : text;
					if (html && style.htmlCopy) {
						const failure = copyHtmlTableSync(style.htmlCopy, html(), content);
						if (failure === null) {
							toast("Copied formatted table", "info");
							return;
						}
						try {
							copyToClipboard(content);
							toast(`Copied as plain text (${failure})`, "warning");
						} catch {
							toast("Copy failed", "error");
						}
						return;
					}
					try {
						copyToClipboard(content);
						toast("Copied", "info");
					} catch {
						toast("Copy failed", "error");
					}
				},
			});
		};
	}

	function typesetFormulasSync(blocks: Block[]): Map<number, TypesetFormula> {
		if (!style.latex || !getCapabilities().images) return new Map();
		const color = ratexColor(style.theme.diagramText ?? style.theme.codeText ?? "#808080");
		const maths = [...blocks.entries()].flatMap(([i, block]) => {
			const tex = mathOf(block);
			return tex === null ? [] : [{ i, tex, key: `${color}\0${tex}` }];
		});
		if (maths.length === 0) return new Map();

		const missing = maths.filter(({ key }) => !formulasStore[key]);
		if (missing.length > 0) {
			const dir = join(tmpdir(), `prismantis-latex-${latexSuffix}`);
			try {
				mkdirSync(dir, { recursive: true });
				const texs = missing.map((m) => m.tex);
				const runRatex = (inputs: string[], fontSize = LATEX_FONT_PX, dpr = LATEX_DPR): Formula[] => {
					const res = spawnSync(
						"ratex-render",
						["--output-dir", dir, "--color", color, "--background-color", "transparent", "--font-size", String(fontSize), "--dpr", String(dpr)],
						{ input: `${inputs.join("\n")}\n`, encoding: "utf8", timeout: 2000 },
					);
					if (res.error || res.status !== 0) return inputs.map(() => ({ error: true }));
					const rendered = renderedOf(res.stdout || "");
					return inputs.map((_, idx): Formula => {
						if (!rendered.has(idx + 1)) return { error: true };
						const file = join(dir, `${String(idx + 1).padStart(4, "0")}.png`);
						try {
							const png = readFileSync(file).toString("base64");
							const size = png ? pngSize(png) : null;
							return size && fitsImage(png) ? { png, ...size } : { error: true };
						} catch {
							return { error: true };
						}
					});
				};
				const initial = runRatex(texs);
				const padded = initial.map((result, idx): Formula => {
					const pad = "png" in result ? padFor(result) : null;
					const [again] = pad ? runRatex([texs[idx]!], pad.fontSize, pad.dpr) : [];
					return again && "png" in again && "png" in result ? { ...result, padded: again } : result;
				});
				const fresh = missing.map((m, idx) => [m.key, padded[idx]!] as const);
				const wanted = new Set(maths.map((m) => m.key));
				formulasStore = keepFormulas(formulasStore, fresh, wanted);
			} catch {
			}
		}

		return new Map(
			maths.flatMap(({ i, tex, key }) => {
				const formula = formulasStore[key];
				return formula && "png" in formula ? [[i, { tex, ...formula }] as const] : [];
			}),
		);
	}

	function loadPicturesSync(blocks: Block[]): Map<number, LoadedPicture> {
		if (!getCapabilities().images) return new Map();
		const images = [...blocks.entries()].flatMap(([i, block]) => {
			const img = imageOf(block);
			return img ? [{ i, ...img }] : [];
		});
		if (images.length === 0) return new Map();

		const out = new Map<number, LoadedPicture>();
		for (const { i, alt, src } of images) {
			const cached = remember(
				pictureCache,
				src,
				() => {
					const file = imageFile(src, style.home);
					if (!file) return null;
					if ("path" in file) {
						try {
							const st = statSync(file.path);
							if (!st.isFile() || st.size > MAX_IMAGE_BYTES) return null;
							const png = readFileSync(file.path).toString("base64");
							const size = png ? pngSize(png) : null;
							return size && size.width > 0 && size.height > 0 && fitsImage(png) ? { png, ...size, alt } : null;
						} catch {
							return null;
						}
					}
					const size = file.png ? pngSize(file.png) : null;
					return size && size.width > 0 && size.height > 0 && fitsImage(file.png) ? { png: file.png, ...size, alt } : null;
				},
				50,
			);
			if (cached) out.set(i, { ...cached, alt });
		}
		return out;
	}

	function withFoundPaths(activeStyle: Style, blocks: Block[]): Style {
		for (const candidate of pathsToProbe(blocks, activeStyle)) {
			if (pathChecks.asked.has(candidate)) continue;
			pathChecks.asked.add(candidate);
			try {
				const st = statSync(candidate);
				if (st.isFile() || st.isDirectory()) {
					pathChecks.found.add(candidate);
					if (pathChecks.found.size > MAX_FOUND_PATHS) {
						const oldest = pathChecks.found.values().next().value;
						if (oldest !== undefined) pathChecks.found.delete(oldest);
					}
				}
			} catch {
			}
		}
		return pathChecks.found.size > 0 ? { ...activeStyle, found: pathChecks.found } : activeStyle;
	}

	function drawMarkdownElements(
		activeStyle: Style,
		blocks: Block[],
		columns: number,
		options?: {
			replyText?: string;
			noteId?: string;
			onInvalidate?: () => void;
		},
	): RenderElement[] {
		const copy = makeCopyButton();
		const fold = makeFolder(options?.onInvalidate);
		const drawn = drawDiagrams(EL, activeStyle, blocks, columns - markerRoom(activeStyle));
		const math = typesetFormulasSync(blocks);
		const pictures = loadPicturesSync(blocks);

		for (const [i, formula] of math) {
			const picked = pickFormula(formula, columns);
			if (picked) {
				drawn.set(i, {
					element: h(EL.Image!, {
						key: `b${i}`,
						source: { png: picked.picture.png },
						columns: picked.fit.columns,
						rows: picked.fit.rows,
						alt: formula.tex,
					}),
				});
			}
		}
		for (const [i, picture] of pictures) {
			const fit = fitImage(picture, columns);
			drawn.set(i, {
				element: h(EL.Image!, {
					key: `b${i}`,
					source: { png: picture.png },
					columns: fit.columns,
					rows: fit.rows,
					alt: picture.alt,
				}),
			});
		}

		const tip = options?.noteId ? noteTip(blocks, (text) => notify(text, "info")) : undefined;
		const probedStyle = withFoundPaths(activeStyle, blocks);
		const effectiveStyle = options?.noteId ? { ...probedStyle, noteKey: instanceKey(options.noteId) } : probedStyle;
		const elements = renderBlocks(
			EL,
			effectiveStyle,
			blocks,
			columns,
			drawMath(EL, effectiveStyle, blocks, drawn),
			copy,
			fold,
			tip,
		);
		const replyBtn = options?.replyText === undefined ? null : copy(options.replyText, "reply", "⧉ copy reply");
		if (!replyBtn) return elements;
		return [...elements, h(EL.Box, { key: "reply", alignSelf: "flex-end" }, replyBtn)];
	}

	activeHooks = {
		isEnabled: () => options.enabled !== false,
		renderAssistantText: (text, isFirstOfReply, messageId, outputPad) => {
			let comp: PrismantisComponent | undefined;
			comp = new PrismantisComponent((columns) => {
				const blocks = parseCached(text);
				if (blocks.length === 0) return h(EL.Text, {}, text);
				const replyText = blocks.length > 1 || hasRtl(text) ? text : undefined;
				const corner = replyText !== undefined && markerRoom(style) > 0;
				const elements = drawMarkdownElements(style, blocks, columns - 2, {
					replyText,
					noteId: messageId,
					onInvalidate: () => comp?.invalidate(),
				});
				return h(
					EL.Box,
					{ key: "msg", flexDirection: "row" },
					h(EL.Box, { width: 2, flexShrink: 0 }, h(EL.Text, { color: style.theme.accent }, isFirstOfReply ? "●" : " ")),
					h(EL.Box, { flexDirection: "column", rowGap: 1, flexGrow: 1 }, ...elements),
					corner ? h(EL.Box, { width: MARK, flexShrink: 0 }) : null,
				);
			}, outputPad);
			return comp;
		},
	};

	pi.registerMarkdownTransformer((markdown, context) => {
		if (options.enabled === false || context.messageType === "assistant-thinking") {
			return markdown;
		}
		if (!/```(figure|mermaid)/i.test(markdown)) {
			return markdown;
		}
		const blocks = parseCached(markdown);
		const drawn = drawDiagrams(EL, style, blocks, Math.max(20, context.availableWidth));
		if (drawn.size === 0) return markdown;

		let out = markdown;
		for (const [i, item] of drawn.entries()) {
			const block = blocks[i];
			if (!block || block.kind !== "code") continue;
			if (item.element) {
				const rendered = renderNode(item.element, Math.max(20, context.availableWidth));
				if (rendered.lines.length > 0) {
					const replacement = `${rendered.lines.map(codeSpan).join("  \n")}\n`;
					out = out.replace(block.raw, replacement);
				}
			} else if (item.note && !context.isStreaming) {
				out = out.replace(block.raw, `${block.raw}\n${codeSpan(item.note)}  \n`);
			}
		}
		return out;
	});

	pi.registerMessageRenderer<{ text: string }>(CUSTOM_MESSAGE_TYPE, (message, renderOptions) => {
		const rawText =
			typeof message.details?.text === "string"
				? message.details.text
				: typeof message.content === "string"
					? message.content
					: "";
		let comp: PrismantisComponent | undefined;
		comp = new PrismantisComponent((columns) => {
			const found = findSetupIn(rawText);
			if (found) {
				const base = { ...style, copyButtons: false, pathLinks: false };
				const elements = drawSetupElements(base, options, found, columns, (s, b, cols) =>
					drawMarkdownElements(s, b, cols, { onInvalidate: () => comp?.invalidate() }),
				);
				return h(EL.Box, { flexDirection: "column", rowGap: 1 }, ...elements);
			}
			const blocks = parseCached(rawText);
			const elements = drawMarkdownElements(style, blocks, columns, {
				noteId: "cmd",
				onInvalidate: () => comp?.invalidate(),
			});
			return h(EL.Box, { flexDirection: "column", rowGap: 1 }, ...elements);
		}, renderOptions.outputPad);

		const container = new Container();
		container.addChild(new Spacer(1));
		container.addChild(comp);
		return container;
	});

	pi.on("session_start", (_event, ctx) => {
		uiCtx = ctx;
		pathChecks.asked.clear();
		pathChecks.found.clear();
		ensureMessagePrototypesPatched();
		void Promise.resolve().then(() => ensureMessagePrototypesPatched());
		refreshFromDisk(ctx.cwd);
		syncPiUiTheme(ctx);
		if (ctx.mode === "tui") {
			ctx.ui.setWidget("prismantis-hover", (t) => {
				screenTui = t;
				watchPointerLeave(t);
				return { render: () => [], invalidate: () => {} };
			});
		}
	});

	pi.on("session_shutdown", () => {
		uiCtx = undefined;
		tuiInstance = undefined;
		screenTui = undefined;
		clearHover();
	});

	pi.on("tool_result", () => {
		pathChecks.asked = new Set(pathChecks.found);
	});

	pi.on("tool_execution_end", () => {
		pathChecks.asked = new Set(pathChecks.found);
	});

	pi.on("before_agent_start", (event, ctx) => {
		uiCtx = ctx;
		refreshFromDisk(ctx.cwd);
		if (options.enabled === false || event.messageType !== "user") return;

		const hints: string[] = [
			...(style.diagramHints ? [HINT, FIGURE_HINT, ...(style.latex && getCapabilities().images ? [LATEX_HINT] : [])] : []),
		];
		if (hints.length > 0) {
			event.systemPromptOptions.guidelines = [
				...(event.systemPromptOptions.guidelines ?? []),
				...hints,
			];
		}
	});

	function applyThemeSelection(name: string, ctx: ExtensionContext): string {
		options = { ...loadOptions(), theme: name };
		if (!saveOptions(options)) {
			return `Could not switch theme to ${name}.`;
		}
		if (name === "random") {
			const others = RANDOM_THEMES.filter((t) => t !== pickedTheme);
			pickedTheme = others[Math.floor(Math.random() * others.length)] ?? "catppuccin-mocha";
		} else {
			pickedTheme = name;
		}
		style = resolveStyle({ ...options, theme: pickedTheme });
		applyTerminalCapabilities(style, ctx.cwd);
		syncPiUiTheme(ctx);
		requestRender();
		if (name === "random") {
			return `Theme set to random: ${pickedTheme} for now.\nkeep it: /prismantis theme ${pickedTheme}`;
		}
		return `Theme set to ${name}.`;
	}

	function saveSetupOption(step: SetupStep, value: string, ctx: ExtensionContext): string {
		if (step.key === "theme") {
			return applyThemeSelection(value, ctx);
		}
		options = { ...loadOptions(), [step.key]: value };
		if (!saveOptions(options)) {
			return `Could not save ${step.key}.`;
		}
		style = resolveStyle({ ...options, theme: pickedTheme });
		applyTerminalCapabilities(style, ctx.cwd);
		requestRender();
		return `${step.title} set to ${value}.`;
	}

	function sendPrismantisOutput(text: string): void {
		if (mirrored(style) && hasRtl(text) && opensLatin(text)) {
			text = ROW_MARK_TEXT + text;
		}
		pi.sendMessage({
			customType: CUSTOM_MESSAGE_TYPE,
			content: text,
			display: true,
			details: { text },
		});
	}

	function lastAssistantReplyText(ctx: ExtensionContext): string | undefined {
		const entries = ctx.sessionManager.getBranch();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i] as { type?: string; message?: { role?: string; content?: unknown } };
			if (entry.type === "message" && entry.message?.role === "assistant" && Array.isArray(entry.message.content)) {
				const text = entry.message.content
					.filter((c: any) => c?.type === "text" && typeof c.text === "string")
					.map((c: any) => c.text)
					.join("\n")
					.trim();
				if (text) return text;
			}
		}
		return undefined;
	}

	pi.registerCommand("prismantis", {
		description: "Switch the prismantis theme, pick styles from samples, copy the last reply, or show the demo",
		getArgumentCompletions(prefix: string) {
			const subcommands = ["theme", "setup", "copy", "demo", "demo-rtl", ...THEME_ARGS];
			const trimmed = prefix.trim();
			if (!trimmed.includes(" ")) {
				return subcommands
					.filter((s) => s.startsWith(trimmed))
					.map((value) => ({ value, label: value }));
			}
			const [first, second = ""] = trimmed.split(/\s+/);
			if (first === "theme") {
				return THEME_ARGS.filter((t) => t.startsWith(second)).map((t) => ({
					value: `theme ${t}`,
					label: t,
				}));
			}
			if (first === "copy") {
				return ["code"].filter((c) => c.startsWith(second)).map((c) => ({
					value: `copy ${c}`,
					label: c,
				}));
			}
			if (first === "setup") {
				const steps = SETUP_STEPS.map((s) => s.name);
				return steps.filter((s) => s.startsWith(second)).map((s) => ({
					value: `setup ${s}`,
					label: s,
				}));
			}
			return null;
		},
		handler: async (args, ctx) => {
			uiCtx = ctx;
			refreshFromDisk(ctx.cwd);
			const [first, second, third] = args.trim().split(/\s+/);
			const [sub, name] = THEME_ARGS.includes(first ?? "") ? ["theme", first] : [first, second];

			if (sub === "demo") {
				const locale = name ?? process.env.LC_ALL ?? process.env.LANG ?? "";
				sendPrismantisOutput(showcaseText(PRESET_NAMES) + languageShowcase(locale));
				return;
			}

			if (sub === "demo-rtl") {
				sendPrismantisOutput(rtlShowcaseText());
				return;
			}

			if (sub === "copy") {
				const reply = lastAssistantReplyText(ctx);
				if (!reply) {
					notify("Nothing to copy yet.", "warning");
					return;
				}
				const codeBlock =
					name === "code" ? nestedBlocks(parseCached(reply)).findLast((b) => b.kind === "code") : undefined;
				if (name === "code" && codeBlock?.kind !== "code") {
					notify("The last reply has no code block.", "warning");
					return;
				}
				const targetText = codeBlock?.kind === "code" ? codeBlock.lines.join("\n") : reply;
				try {
					copyToClipboard(targetText);
					toast(`Copied the last ${codeBlock ? "code block" : "reply"}.`, "info");
				} catch {
					toast("Copy failed.", "error");
				}
				return;
			}

			if (sub === "setup") {
				if (!name && ctx.mode === "tui") {
					const overlayOpts = (): OverlayOptions => ({
						anchor: "center",
						width: "85%",
						maxHeight: "85%",
						margin: 1,
					});
					void ctx.ui.custom<void>(
						(t, piTheme, _kb, done) => {
							tuiInstance = t;
							return new SetupPaneComponent(
								t,
								piTheme,
								() => ({ style, options, pickedTheme }),
								(step, value) => {
									const msg = saveSetupOption(step, value, ctx);
									notify(msg, msg.startsWith("Could not") ? "error" : "info");
								},
								(s, b, cols) => drawMarkdownElements(s, b, cols),
								() => done(),
							);
						},
						{ overlay: true, overlayOptions: overlayOpts },
					);
					notify(SETUP_PANE_OPENED, "info");
					return;
				}

				const at = name ? SETUP_STEPS.findIndex((s) => s.name === name) : 0;
				const step = SETUP_STEPS[at];
				if (!step) {
					sendPrismantisOutput(`Unknown setup step "${name}". Steps: ${SETUP_STEPS.map((s) => s.name).join(", ")}`);
					return;
				}
				if (!third) {
					sendPrismantisOutput(setupText(setupPartsAt(at)));
					return;
				}
				const choices = step.key === "theme" ? THEME_ARGS : step.options;
				const value = /^\d+$/.test(third) ? step.options[Number(third) - 1] : third;
				if (!value || !choices.includes(value)) {
					sendPrismantisOutput(
						`Unknown ${step.name} pick "${third}". Pick 1-${step.options.length} or one of: ${choices.join(", ")}`,
					);
					return;
				}
				const saved = saveSetupOption(step, value, ctx);
				if (saved.startsWith("Could not")) {
					sendPrismantisOutput(saved);
					return;
				}
				sendPrismantisOutput(
					`${saved}\n\n${at + 1 < SETUP_STEPS.length ? setupText(setupPartsAt(at + 1)) : SETUP_DONE}`,
				);
				return;
			}

			if (sub !== "theme") {
				sendPrismantisOutput(helpText(PRESET_NAMES));
				return;
			}

			if (!name) {
				const text =
					options.theme === "random"
						? `current: ${pickedTheme} (random)\nkeep it: /prismantis theme ${pickedTheme}`
						: `current: ${pickedTheme}`;
				notify(text, "info");
				return;
			}

			if (!THEME_ARGS.includes(name)) {
				notify(`Unknown theme "${name}". Themes: ${PRESET_NAMES.join(", ")}, random`, "warning");
				return;
			}

			const msg = applyThemeSelection(name, ctx);
			notify(msg, "info");
		},
	});
}
