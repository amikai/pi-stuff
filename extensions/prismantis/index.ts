import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme as PiTheme, ToolRenderContext, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import {
	AssistantMessageComponent,
	copyToClipboard,
	getAgentDir,
	getMarkdownTheme,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	getCapabilities,
	Markdown,
	matchesKey,
	MouseRegion,
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
import { clockText, endedAt, promptKey, sentAt, withRecord, type Sent, type TurnEnd } from "./core/clock.ts";
import { FIGURE_HINT } from "./core/figure.ts";
import {
	findSetup,
	helpText,
	HINT,
	ISSUE_HINT,
	languageShowcase,
	rtlShowcaseText,
	SETUP_DONE,
	SETUP_PANE_KEYS,
	SETUP_PANE_OPENED,
	setupParts,
	setupSteps,
	setupText,
	showcaseText,
	THEME_PREVIEW,
	type SetupStep,
} from "./core/help.ts";
import { tableHtml, tableText } from "./core/html.ts";
import { EL, h, type RenderElement, type RenderNode } from "./core/jsx.ts";
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
	isReadOnlyCall,
	MARK,
	markerRoom,
	mirrored,
	noteTip,
	pasteLang,
	remember,
	rememberCall,
	renderBlocks,
	renderDiffCard,
	renderExpandedShell,
	renderFailure,
	renderShellResult,
	renderToolRow,
	renderTurnDuration,
	renderUserPrompt,
	type CopyButton,
	type DrawPaste,
	type Fold,
	type TerminalEnv,
	type ToolRow,
} from "./core/render.ts";
import { hasRtl, opensLatin, ROW_MARK_TEXT, TERMINALS, type Terminal } from "./core/rtl.ts";
import { pickTheme, RANDOM_THEMES, resolveStyle, type Style } from "./core/theme.ts";
import { clearHover, watchPointerLeave } from "../lib/pointer-hover.ts";
import { PrismantisComponent, renderNode } from "./renderer.ts";

const CUSTOM_MESSAGE_TYPE = "prismantis-output";
const TURN_ENTRY_TYPE = "prismantis-turn";
const THEME_ARGS = [...PRESET_NAMES, "random"];
const LATEX_HINT =
	"This terminal typesets LaTeX math: a formula in $$…$$ on lines of its own, or in a ```math block, renders as an image (KaTeX syntax). Inline $…$ does not render, so write inline math as plain text or Unicode.";

export type PrismantisOptions = Record<string, unknown> & {
	enabled?: boolean;
	theme?: string;
	toolRows?: boolean;
	syncPiTheme?: boolean;
};

const DEFAULT_OPTIONS: PrismantisOptions = {
	enabled: true,
	theme: "catppuccin-mocha",
	headingStyle: "banner",
	tableStyle: "box",
	promptStyle: "bubble",
	clock: "off",
	toolStyle: "chat",
	toolOutput: "full",
	taskStyle: "checks",
	diffStyle: "card",
	pieStyle: "round",
	rtl: "auto",
	highlightNumbers: true,
	highlightPaths: true,
	mermaid: true,
	mermaidAscii: false,
	copyButtons: true,
	copyButtonStyle: "inline",
	toolRows: true,
	diagramHints: true,
	issueHint: true,
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

export function parseUnifiedPatchToHunks(
	patchText: string,
): { oldStart: number; newStart: number; lines: string[] }[] {
	const hunks: { oldStart: number; newStart: number; lines: string[] }[] = [];
	const rawLines = patchText.replace(/\r\n?/g, "\n").split("\n");
	let current: { oldStart: number; newStart: number; lines: string[] } | undefined;

	for (const line of rawLines) {
		const header = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
		if (header) {
			current = {
				oldStart: Number(header[1]),
				newStart: Number(header[2]),
				lines: [],
			};
			hunks.push(current);
			continue;
		}
		if (!current) continue;
		if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line.startsWith("\\")) {
			current.lines.push(line);
		}
	}
	return hunks;
}

function syntheticHunksFromEdits(
	edits: unknown,
): { oldStart: number; newStart: number; lines: string[] }[] {
	if (!Array.isArray(edits)) return [];
	const hunks: { oldStart: number; newStart: number; lines: string[] }[] = [];
	let lineNo = 1;
	for (const edit of edits) {
		if (!edit || typeof edit !== "object") continue;
		const oldText = typeof (edit as { oldText?: unknown }).oldText === "string" ? (edit as { oldText: string }).oldText : "";
		const newText = typeof (edit as { newText?: unknown }).newText === "string" ? (edit as { newText: string }).newText : "";
		const oldLines = oldText ? oldText.replace(/\r\n?/g, "\n").split("\n").map((l) => `-${l}`) : [];
		const newLines = newText ? newText.replace(/\r\n?/g, "\n").split("\n").map((l) => `+${l}`) : [];
		if (oldLines.length || newLines.length) {
			hunks.push({ oldStart: lineNo, newStart: lineNo, lines: [...oldLines, ...newLines] });
			lineNo += Math.max(oldLines.length, newLines.length) + 2;
		}
	}
	return hunks;
}

export function normalizeToolForPrismantis(
	toolName: string,
	args: unknown,
): { tool: string; input: Record<string, unknown> } {
	const raw = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
	const filePath = typeof raw.path === "string" ? raw.path : typeof raw.file_path === "string" ? raw.file_path : undefined;
	const withPath = filePath !== undefined ? { ...raw, file_path: filePath } : { ...raw };

	switch (toolName) {
		case "bash":
			return { tool: "Bash", input: withPath };
		case "powershell":
			return { tool: "PowerShell", input: withPath };
		case "read":
			return { tool: "Read", input: withPath };
		case "write":
			return { tool: "Write", input: withPath };
		case "edit":
			return { tool: "Edit", input: withPath };
		case "grep":
			return { tool: "Grep", input: withPath };
		case "find":
			return { tool: "Glob", input: withPath };
		case "ls":
			return { tool: "LS", input: withPath };
		case "agent":
			return { tool: "Agent", input: withPath };
		case "web_search":
		case "google_search":
			return { tool: "WebSearch", input: withPath };
		case "fetch_content":
			return { tool: "WebFetch", input: withPath };
		default:
			return { tool: toolName, input: withPath };
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
	renderUserText: (text: string, messageId: string, outputPad: number) => Component | null;
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

	const userProto = UserMessageComponent.prototype as any;
	if (!userProto.rebuild?.[WRAPPED_MARK]) {
		const prevRebuild = userProto.rebuild;
		const wrappedRebuild = function (this: any) {
			if (!activeHooks?.isEnabled()) {
				return prevRebuild.call(this);
			}
			const custom = activeHooks.renderUserText(this.text, `user:${this.text.slice(0, 64)}`, this.outputPad ?? 1);
			if (!custom) {
				return prevRebuild.call(this);
			}
			this.clear();
			this.addChild(new Spacer(1));
			this.addChild(custom);
		};
		(wrappedRebuild as any)[WRAPPED_MARK] = true;
		userProto.rebuild = wrappedRebuild;
	}
}

const SETUP_LIST_COLUMNS = 28;
const SETUP_HEAD_ROWS = 8;

const SETUP_GIT_STATUS = [
	"On branch main",
	"Changes not staged for commit:",
	'  (use "git add <file>..." to update what will be committed)',
	"        modified:   src/app.ts",
	"",
	'no changes added to commit (use "git add" and/or "git commit -a")',
];
const SETUP_BUILD_ERROR = [
	"> app@1.4.0 build",
	"> tsc",
	...[3, 7, 12, 18, 25, 31, 40, 44, 52, 60].map(
		(line) => `src/app.ts(${line},5): error TS2322: Type 'string' is not assignable to type 'number'.`,
	),
	"Found 10 errors in the same file, starting at: src/app.ts:3",
];
const SETUP_TABLE = "| Item | Qty |\n|:-----|----:|\n| Apples | 3 |\n| Pears | 5 |";
const SETUP_SENT = new Date(2026, 0, 15, 14, 32).getTime();
const SETUP_EDIT = {
	filePath: "src/config.ts",
	structuredPatch: [
		{
			oldStart: 12,
			newStart: 12,
			lines: [
				" export const config = {",
				"-  retries: 3,",
				"-  timeout: 5000,",
				"+  retries: 5,",
				"+  timeout: 10_000,",
				"   verbose: false,",
				" }",
			],
		},
	],
};

function toolOutputSample(style: Style, value: string, id: string, columns: number): RenderElement[] {
	const status: ToolRow = { tool: "Bash", input: { command: "git status" }, isRunning: false, isErrored: false, isInterrupted: false };
	const build: ToolRow = {
		tool: "Bash",
		input: { command: "npm run build", description: "Build the app" },
		isRunning: false,
		isErrored: true,
		isInterrupted: false,
	};
	const statusRow = h(EL.Box, { key: `${id}s` }, renderToolRow(EL, style, status, columns));
	const buildRow = h(EL.Box, { key: `${id}r` }, renderToolRow(EL, style, build, columns));
	if (value === "quiet") {
		return [statusRow, buildRow, renderFailure(EL, style, SETUP_BUILD_ERROR.join("\n"), `${id}e`) ?? h(EL.Box, { key: `${id}e` })];
	}
	const folded = (lines: readonly string[], keep: number, color?: string) => [
		...lines.slice(0, keep).map((line, i) => h(EL.Text, { key: `l${i}`, color }, `${i === 0 ? "  ⎿  " : "     "}${line}`)),
		h(EL.Text, { key: "more", dimColor: true }, `     … +${lines.length - keep} lines`),
	];
	return [
		statusRow,
		h(EL.Box, { key: `${id}so`, flexDirection: "column" }, ...folded(SETUP_GIT_STATUS, 3)),
		buildRow,
		h(
			EL.Box,
			{ key: `${id}e`, flexDirection: "column" },
			...folded(["Error: Exit code 2", ...SETUP_BUILD_ERROR], 10, style.theme.codeFlag),
		),
	];
}

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

function clockSample(style: Style, value: string, id: string, columns: number): RenderElement[] {
	const time = value === "24h" || value === "12h" ? clockText(SETUP_SENT, SETUP_SENT, value) : undefined;
	const prompt =
		style.promptStyle === "off"
			? h(EL.Text, { dimColor: true }, `> ${time === undefined ? "" : `[${time}] `}fix the failing test`)
			: renderUserPrompt(EL, style, "fix the failing test", columns, time);
	return [
		h(EL.Box, { key: `${id}p` }, prompt),
		h(EL.Box, { key: `${id}d` }, renderTurnDuration(EL, style, "Baked", 115000, time)),
	];
}

function diffSample(style: Style, id: string, columns: number): RenderElement[] {
	return [
		h(
			EL.Box,
			{ key: `${id}r` },
			renderToolRow(EL, style, { tool: "Edit", input: { file_path: "src/config.ts" }, isRunning: false, isErrored: false, isInterrupted: false }, columns),
		),
		h(EL.Box, { key: `${id}d`, flexDirection: "column" }, renderDiffCard(EL, style, SETUP_EDIT, () => null, id, columns)),
	];
}

export function drawSetupElements(
	base: Style,
	options: PrismantisOptions,
	found: NonNullable<ReturnType<typeof findSetup>>,
	columns: number,
	drawMd: (style: Style, blocks: Block[], cols: number) => RenderElement[],
): RenderElement[] {
	const key = setupSteps(PRESET_NAMES)[found.at]!.key;
	const md = (style: Style, text: string, id: string) =>
		h(
			EL.Box,
			{ key: id, flexDirection: "column", rowGap: 1 },
			...drawMd(style, parse(text, { numbers: style.highlightNumbers, paths: style.highlightPaths }), columns),
		);
	const sample = (style: Style, value: string, id: string): RenderElement[] => {
		if (key === "promptStyle") {
			return [
				value === "off"
					? h(EL.Text, { key: id, dimColor: true }, "> fix the failing test")
					: h(EL.Box, { key: id }, renderUserPrompt(EL, style, "fix the failing test", columns)),
			];
		}
		if (key === "toolStyle") {
			return [
				md({ ...style, narration: style.toolStyle === "tree-bold" }, "Reading the config.", `${id}s`),
				h(
					EL.Box,
					{ key: id },
					renderToolRow(EL, style, { tool: "Read", input: { file_path: "src/config.ts" }, isRunning: false, isErrored: false, isInterrupted: false }, columns),
				),
			];
		}
		if (key === "toolOutput") return toolOutputSample(style, value, id, columns);
		if (key === "diffStyle") return diffSample(style, id, columns);
		if (key === "copyButtonStyle") return copySample(style, value, id, columns);
		if (key === "clock") return clockSample(style, value, id, columns);
		return [];
	};
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

	private steps(): SetupStep[] {
		return setupSteps(PRESET_NAMES);
	}

	private currentStep(): SetupStep {
		const steps = this.steps();
		return steps[Math.min(this.stepIndex, steps.length - 1)]!;
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
		const steps = this.steps();
		const step = this.currentStep();
		const value = this.focusedValue || this.currentValueOf(step);
		this.onPick(step, value);
		if (this.stepIndex + 1 < steps.length) {
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
		const parts = setupParts(PRESET_NAMES, this.stepIndex);
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
			edge("╰", this.piTheme.fg("dim", `Step ${this.stepIndex + 1}/${this.steps().length} · Esc close`), "╯"),
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

export default function prismantisExtension(pi: ExtensionAPI) {
	ensureMessagePrototypesPatched();

	let options = loadOptions();
	let pickedTheme = pickTheme(options.theme);
	let style = resolveStyle({ ...options, theme: pickedTheme });
	let uiCtx: ExtensionContext | undefined;
	let tuiInstance: TUI | undefined;
	let screenTui: TUI | undefined;
	let promptsCount = 0;
	let turnStartedAt = Date.now();

	const parsedCache = new Map<string, ReturnType<typeof parse>>();
	const unfolded = new Set<string>();
	const readOnlyCalls = new Set<string>();
	const firstDrawnMap = new Map<string, number>();
	let sentRecords: Sent[] = [];
	let turnEndsRecords: TurnEnd[] = [];
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

	function firstDrawn(id: string): number {
		const hit = firstDrawnMap.get(id);
		if (hit !== undefined) return hit;
		const now = Date.now();
		firstDrawnMap.set(id, now);
		if (firstDrawnMap.size > 1000) {
			const oldest = firstDrawnMap.keys().next().value;
			if (oldest !== undefined) firstDrawnMap.delete(oldest);
		}
		return now;
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

	function makeFolder(onInvalidate?: () => void, faces = false): Fold {
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
			if (!faces) {
				return {
					folded,
					faced: false,
					element: h(EL.Button, { key, variant: "secondary", label, onPress: toggle }),
				};
			}
			const element = look?.face
				? h(EL.Button, { key, plain: true, label, onPress: toggle }, look.face(folded))
				: h(EL.Button, { key, variant: "secondary", label, onPress: toggle });
			return {
				folded,
				faced: look?.face !== undefined,
				element,
				around: (rows, hover) => h(EL.Button, { key: `${key}.rows`, plain: true, label, hover, onPress: toggle }, rows),
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
		const effectiveStyle = options?.noteId ? { ...activeStyle, noteKey: instanceKey(options.noteId) } : activeStyle;
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
				const narration = style.toolStyle === "tree-bold" && blocks.length === 1 && blocks[0]!.kind === "paragraph";
				const surfaceStyle = narration ? { ...style, narration } : style;
				const replyText = blocks.length > 1 || hasRtl(text) ? text : undefined;
				const corner = replyText !== undefined && markerRoom(surfaceStyle) > 0;
				const elements = drawMarkdownElements(surfaceStyle, blocks, columns - 2, {
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
		renderUserText: (text, messageId, outputPad) => {
			if (style.promptStyle === "off" && style.clock === "off") return null;
			let comp: PrismantisComponent | undefined;
			comp = new PrismantisComponent((columns) => {
				const at = style.clock === "off" ? undefined : sentAt(sentRecords, text, firstDrawn(messageId));
				const time = at === undefined ? undefined : clockText(at, Date.now(), style.clock);
				if (style.promptStyle === "off") {
					return h(EL.Text, { dimColor: true }, `> ${time ? `[${time}] ` : ""}${text}`);
				}
				const fold = makeFolder(() => comp?.invalidate());
				const paste: DrawPaste = (body, key) => {
					const lines = body.split("\n");
					const title = `pasted text · ${lines.length} lines`;
					const toggle = fold(`${messageId}:${key}`, lines.length, key, { label: title });
					const opened = toggle?.folded === false;
					return h(
						EL.Box,
						{
							key,
							borderStyle: "double",
							borderColor: style.theme.codeComment,
							paddingX: 1,
							flexDirection: "column",
							alignSelf: "flex-start",
						},
						opened
							? h(
									EL.Box,
									{ key: "head", flexDirection: "row", justifyContent: "space-between", columnGap: 4 },
									h(EL.Text, { color: style.theme.codeComment }, title),
									toggle.element,
								)
							: (toggle?.element ?? null),
						...(opened
							? drawMarkdownElements(
									style,
									[{ kind: "code", lang: pasteLang(body), lines, raw: body }],
									Math.max(20, columns - 8),
									{ onInvalidate: () => comp?.invalidate() },
								)
							: []),
					);
				};
				return renderUserPrompt(EL, style, text, columns, time, paste);
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
			const found = findSetup(PRESET_NAMES, rawText);
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

	pi.registerEntryRenderer<{ durationMs: number; at: number }>(TURN_ENTRY_TYPE, (entry) => {
		if (options.enabled === false) return undefined;
		const durationMs = entry.data?.durationMs ?? 0;
		const recordedAt = entry.data?.at ?? Date.now();
		return new PrismantisComponent(() => {
			const at = style.clock === "off" ? undefined : endedAt(turnEndsRecords, durationMs, recordedAt) ?? recordedAt;
			const time = at === undefined ? undefined : clockText(at, Date.now(), style.clock);
			return renderTurnDuration(EL, style, "Baked", durationMs, time);
		}, 1);
	});

	pi.registerToolRenderer((toolName, next) => {
		if (options.enabled === false || options.toolRows === false) {
			return next();
		}
		return {
			renderShell: "self",
			renderCall(args: unknown, _theme: PiTheme, context: ToolRenderContext) {
				const mapped = normalizeToolForPrismantis(toolName, args);
				if (style.toolOutput === "quiet" && isReadOnlyCall(mapped.tool, mapped.input)) {
					rememberCall(readOnlyCalls, context.toolCallId);
				}
				return new PrismantisComponent((columns) => {
					const row: ToolRow = {
						tool: mapped.tool,
						input: mapped.input,
						isRunning: context.isPartial,
						isErrored: context.isError,
						isInterrupted: false,
					};
					if (context.expanded && (mapped.tool === "Bash" || mapped.tool === "PowerShell")) {
						return renderExpandedShell(EL, style, row);
					}
					return renderToolRow(EL, style, row, columns);
				}, context.outputPad);
			},
			renderResult(
				result: { content: { type: string; text?: string }[]; details?: unknown },
				renderOpts: ToolRenderResultOptions,
				_theme: PiTheme,
				context: ToolRenderContext,
			) {
				const mapped = normalizeToolForPrismantis(toolName, context.args);
				const textOutput = (result.content ?? [])
					.filter((c) => c.type === "text" && typeof c.text === "string")
					.map((c) => c.text!)
					.join("\n");

				let comp: PrismantisComponent | undefined;
				comp = new PrismantisComponent((columns) => {
					const fold = makeFolder(() => {
						comp?.invalidate();
						context.invalidate();
					}, true);

					if (!context.isError && mapped.tool === "Edit") {
						const details = result.details as { patch?: string } | undefined;
						const hunks =
							typeof details?.patch === "string"
								? parseUnifiedPatchToHunks(details.patch)
								: syntheticHunksFromEdits(mapped.input.edits);
						if (hunks.length > 0) {
							const card = renderDiffCard(
								EL,
								{ ...style, pressPreview: true },
								{ filePath: mapped.input.file_path, structuredPatch: hunks },
								fold,
								context.toolCallId,
								columns,
							);
							if (card) return card;
						}
					}

					if (!context.isError && mapped.tool === "Write") {
						const content = typeof mapped.input.content === "string" ? mapped.input.content : textOutput;
						if (typeof mapped.input.file_path === "string") {
							const card = renderDiffCard(
								EL,
								{ ...style, pressPreview: true },
								{ type: "create", filePath: mapped.input.file_path, content },
								fold,
								context.toolCallId,
								columns,
							);
							if (card) return card;
						}
					}

					if (context.isError) {
						if (style.toolOutput === "quiet" && !renderOpts.expanded) {
							return renderFailure(EL, style, textOutput) ?? h(EL.Box, {});
						}
						const lines = textOutput.split("\n").filter(Boolean);
						const shown = renderOpts.expanded ? lines : lines.slice(0, 10);
						return h(
							EL.Box,
							{ flexDirection: "column" },
							...shown.map((line, i) =>
								h(EL.Text, { key: `e${i}`, color: style.theme.codeFlag }, `${i === 0 ? "  ⎿  " : "     "}${line}`),
							),
							...(lines.length > shown.length
								? [h(EL.Text, { key: "more", dimColor: true }, `     … +${lines.length - shown.length} lines`)]
								: []),
						);
					}

					if (style.toolOutput === "quiet" && !renderOpts.expanded) {
						if (readOnlyCalls.has(context.toolCallId) || isReadOnlyCall(mapped.tool, mapped.input)) {
							return null;
						}
						if (mapped.tool === "Bash" || mapped.tool === "PowerShell") {
							return renderShellResult(EL, style, { stdout: textOutput, stderr: "" });
						}
						return null;
					}

					if (!textOutput.trim()) return null;
					const lines = textOutput.split("\n");
					const keep = renderOpts.expanded ? lines.length : 10;
					const shown = lines.slice(0, keep);
					return h(
						EL.Box,
						{ flexDirection: "column" },
						...shown.map((line, i) => h(EL.Text, { key: `l${i}` }, `${i === 0 ? "  ⎿  " : "     "}${line}`)),
						...(lines.length > keep
							? [h(EL.Text, { key: "more", dimColor: true }, `     … +${lines.length - keep} lines`)]
							: []),
					);
				}, context.outputPad);
				return comp;
			},
		};
	});

	pi.on("session_start", (_event, ctx) => {
		uiCtx = ctx;
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
			ctx.ui.setWorkingIndicator({
				frames: [`\x1b[38;2;203;166;247m●\x1b[0m`],
			});
		}
	});

	pi.on("session_shutdown", () => {
		uiCtx = undefined;
		tuiInstance = undefined;
		screenTui = undefined;
		clearHover();
	});

	pi.on("input", (event, ctx) => {
		uiCtx = ctx;
		if (event.source !== "extension" && style.clock !== "off") {
			sentRecords = withRecord(sentRecords, { text: promptKey(event.text), at: Date.now() });
		}
	});

	pi.on("before_agent_start", (event, ctx) => {
		uiCtx = ctx;
		refreshFromDisk(ctx.cwd);
		turnStartedAt = Date.now();
		if (options.enabled === false || event.messageType !== "user") return;

		const hints: string[] = [
			...(style.diagramHints ? [HINT, FIGURE_HINT, ...(style.latex && getCapabilities().images ? [LATEX_HINT] : [])] : []),
			...(style.issueHint && promptsCount++ % 10 === 0 ? [ISSUE_HINT] : []),
		];
		if (hints.length > 0) {
			event.systemPromptOptions.guidelines = [
				...(event.systemPromptOptions.guidelines ?? []),
				...hints,
			];
		}
	});

	pi.on("agent_end", (_event, ctx) => {
		uiCtx = ctx;
		if (options.enabled === false) return;
		const durationMs = Math.max(0, Date.now() - turnStartedAt);
		const at = Date.now();
		if (style.clock !== "off") {
			turnEndsRecords = withRecord(turnEndsRecords, { durationMs, at });
		}
		if (durationMs >= 1000) {
			pi.appendEntry(TURN_ENTRY_TYPE, { durationMs, at });
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
				const steps = setupSteps(PRESET_NAMES).map((s) => s.name);
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

				const steps = setupSteps(PRESET_NAMES);
				const at = name ? steps.findIndex((s) => s.name === name) : 0;
				const step = steps[at];
				if (!step) {
					sendPrismantisOutput(`Unknown setup step "${name}". Steps: ${steps.map((s) => s.name).join(", ")}`);
					return;
				}
				if (!third) {
					sendPrismantisOutput(setupText(setupParts(PRESET_NAMES, at)));
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
					`${saved}\n\n${at + 1 < steps.length ? setupText(setupParts(PRESET_NAMES, at + 1)) : SETUP_DONE}`,
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
