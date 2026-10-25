import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { pathToFileURL } from "node:url";

const whichPi = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
const piPkg = realpathSync(resolve(dirname(realpathSync(whichPi)), "../@earendil-works/pi-coding-agent/package.json"));
const parentURL = pathToFileURL(piPkg).href;
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith("@earendil-works/")) {
			return nextResolve(specifier, { ...context, parentURL });
		}
		return nextResolve(specifier, context);
	},
});

const {
	AssistantMessageComponent,
	initTheme,
	SessionManager,
	UserMessageComponent,
} = await import("@earendil-works/pi-coding-agent");
const { setTheme, theme: activePiGlobalTheme } = await import(
	pathToFileURL(resolve(dirname(piPkg), "dist/modes/interactive/theme/theme.js")).href
);
const { matchesKey, visibleWidth } = await import("@earendil-works/pi-tui");
initTheme("dark");

const { default: prismExtension, themeFromPiTheme } = await import("../extensions/prism/index.ts");
const { EL, h } = await import("../extensions/prism/core/jsx.ts");
const { PrismComponent } = await import("../extensions/prism/renderer.ts");
const { clearHover, settlePointerMove } = await import("../extensions/lib/pointer-hover.ts");
const { tableHtml, tableText } = await import("../extensions/prism/core/html.ts");
const { parse } = await import("../extensions/prism/core/markdown.ts");

const stripAnsi = (s: string) =>
	s
		.replace(/\x1b\[[0-9;]*m/g, "")
		.replace(/\x1b\]8;;.*?(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b\]133;[A-Z]\x07/g, "");

function createHarness(initialConfig?: Record<string, unknown>) {
	const dir = mkdtempSync(join(tmpdir(), "prism-unit-"));
	process.env.PI_CODING_AGENT_DIR = dir;
	if (initialConfig) {
		writeFileSync(join(dir, "prism.json"), `${JSON.stringify(initialConfig, null, 2)}\n`);
	}

	const handlers = new Map<string, ((...args: any[]) => any)[]>();
	const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void>; getArgumentCompletions?: (p: string) => any }>();
	const messageRenderers = new Map<string, (msg: any, opts: any, theme: any) => any>();
	const entryRenderers = new Map<string, (entry: any, opts: any, theme: any) => any>();
	const toolRenderers: ((toolName: string, next: () => any) => any)[] = [];
	const markdownTransformers: ((md: string, ctx: any) => string)[] = [];
	const notifications: { text: string; level: string }[] = [];
	const sentCustomMessages: any[] = [];
	const appendedEntries: { customType: string; data: any }[] = [];

	let activePiTheme = "system";
	let overlayComponent: any = null;

	const fakeTui = {
		terminal: { columns: 100, rows: 40 },
		requestRender: () => {},
	} as any;

	const sm = SessionManager.inMemory("/tmp");

	const ctx = {
		mode: "tui",
		hasUI: true,
		cwd: "/tmp/project",
		sessionManager: sm,
		ui: {
			get theme() {
				return activePiGlobalTheme;
			},
			notify: (text: string, level = "info") => {
				notifications.push({ text, level });
			},
			setTheme: (name: string) => {
				activePiTheme = name;
				return { success: true };
			},
			setWorkingIndicator: () => {},
			setWidget: () => {},
			custom: async (factory: any) => {
				return new Promise<void>((resolveDone) => {
					overlayComponent = factory(fakeTui, activePiGlobalTheme, { matches: matchesKey }, () => {
						overlayComponent = null;
						resolveDone();
					});
				});
			},
		},
	} as any;

	const pi = {
		on: (event: string, handler: (...args: any[]) => any) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerCommand: (name: string, def: any) => {
			commands.set(name, def);
		},
		registerMessageRenderer: (customType: string, renderer: any) => {
			messageRenderers.set(customType, renderer);
		},
		registerEntryRenderer: (customType: string, renderer: any) => {
			entryRenderers.set(customType, renderer);
		},
		registerToolRenderer: (resolver: any) => {
			toolRenderers.push(resolver);
		},
		registerMarkdownTransformer: (transformer: any) => {
			markdownTransformers.push(transformer);
		},
		sendMessage: (msg: any) => {
			sentCustomMessages.push(msg);
		},
		appendEntry: (customType: string, data: any) => {
			appendedEntries.push({ customType, data });
		},
	} as any;

	prismExtension(pi);

	const emit = async (event: string, payload: any = {}) => {
		let lastResult: any;
		for (const h of handlers.get(event) ?? []) {
			const res = await h(payload, ctx);
			if (res !== undefined) lastResult = res;
		}
		return lastResult;
	};

	const readConfig = () => JSON.parse(readFileSync(join(dir, "prism.json"), "utf8"));
	const writeConfig = (data: Record<string, unknown>) =>
		writeFileSync(join(dir, "prism.json"), `${JSON.stringify(data, null, 2)}\n`);

	return {
		dir,
		ctx,
		sm,
		emit,
		commands,
		messageRenderers,
		entryRenderers,
		toolRenderers,
		markdownTransformers,
		notifications,
		sentCustomMessages,
		appendedEntries,
		getActivePiTheme: () => activePiTheme,
		getOverlay: () => overlayComponent,
		readConfig,
		writeConfig,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

let cleanupFn: (() => void) | undefined;
beforeEach(() => {
	cleanupFn = undefined;
});
afterEach(() => {
	cleanupFn?.();
});

test("1. prismantis derives its palette from pi's active theme without mutating global theme or registering tool renderers", () => {
	setTheme("dark");
	const darkPalette = themeFromPiTheme(activePiGlobalTheme);
	assert.match(darkPalette.accent ?? "", /^#[0-9a-f]{6}$/);
	assert.match(darkPalette.heading ?? "", /^#[0-9a-f]{6}$/);
	assert.match(darkPalette.diffAdded ?? "", /^#[0-9a-f]{6}$/);
	assert.match(darkPalette.diffRemoved ?? "", /^#[0-9a-f]{6}$/);

	setTheme("light");
	const lightPalette = themeFromPiTheme(activePiGlobalTheme);
	assert.notEqual(lightPalette.codeText, darkPalette.codeText, "light and dark pi themes produce distinct codeText colors");
	assert.notEqual(lightPalette.accent, darkPalette.accent, "light and dark pi themes produce distinct accent colors");
	setTheme("dark");

	const h = createHarness();
	cleanupFn = h.cleanup;
	assert.equal(h.toolRenderers.length, 0, "does not register a tool renderer");
});

test("2. AssistantMessageComponent renders tables, headings, code folding, diagrams, figures, alerts, and footnotes", async () => {
	const h = createHarness({ headingStyle: "banner", tableStyle: "box" });
	cleanupFn = h.cleanup;
	await h.emit("session_start");

	const codeLines = Array.from({ length: 35 }, (_, i) => `const x${i + 1} = ${i + 1};`).join("\n");
	const reply = [
		"# Title",
		"",
		"| Name | Latency[^1] |",
		"|:-----|------------:|",
		"| api  | 120ms       |",
		"",
		"> [!WARNING]",
		"> Watch the queue.",
		"",
		"```mermaid",
		"xychart-beta",
		'    title "Load"',
		"    x-axis [a, b, c]",
		"    y-axis 0 --> 10",
		"    bar [2, 6, 9]",
		"```",
		"",
		"```figure",
		"{accent:┌─ box ─┐}",
		"{accent:│} {ok:✓ ok} {accent:│}",
		"{accent:└───────┘}",
		"```",
		"",
		"```ts",
		codeLines,
		"```",
		"",
		"[^1]: Measured at p95.",
	].join("\n");

	const comp = new AssistantMessageComponent({
		role: "assistant",
		content: [{ type: "text", text: reply }],
		timestamp: 1000,
	} as any);

	const lines = comp.render(96);
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= 96, `Line exceeded width 96: ${visibleWidth(line)}`);
	}
	const plain = stripAnsi(lines.join("\n"));
	assert.ok(plain.includes("┏━━━━━━━┓"), "draws banner heading");
	assert.ok(plain.includes("╞══════╪"), "draws double-lined box table header");
	assert.ok(plain.includes("[ ⧉ md ]"), "draws table md copy button");
	assert.ok(plain.includes("Warning"), "draws GitHub alert box");
	assert.ok(plain.includes("┌─ box ─┐"), "draws and reframes figure block");
	assert.ok(plain.includes("[ +15 more lines ]"), "folds 35-line code block at 20 lines");
	assert.ok(!plain.includes("const x35 = 35;"), "hides folded code lines");

	const foldRowIdx = lines.findIndex((l) => stripAnsi(l).includes("[ +15 more lines ]"));
	assert.ok(foldRowIdx >= 0, "found fold button row");
	const foldColIdx = stripAnsi(lines[foldRowIdx]!).indexOf("[ +15 more lines ]") + 2;
	comp.handleMouse({
		type: "press",
		button: "left",
		x: foldColIdx,
		y: foldRowIdx,
		screenX: foldColIdx,
		screenY: foldRowIdx,
		width: 96,
		height: lines.length,
	} as any);
	comp.handleMouse({
		type: "click",
		button: "left",
		x: foldColIdx,
		y: foldRowIdx,
		screenX: foldColIdx,
		screenY: foldRowIdx,
		width: 96,
		height: lines.length,
	} as any);

	const expandedPlain = stripAnsi(comp.render(96).join("\n"));
	assert.ok(expandedPlain.includes("const x35 = 35;"), "unfolds code block on button click");
	assert.ok(expandedPlain.includes("[ show less ]"), "shows show less button when unfolded");
});

test("3. UserMessageComponent renders bubble, wide, bar, chevron prompt styles and clock times", async () => {
	const h = createHarness({ promptStyle: "bubble", clock: "24h" });
	cleanupFn = h.cleanup;
	await h.emit("session_start");
	await h.emit("input", { text: "fix the failing test", source: "interactive" });

	const userComp = new UserMessageComponent("fix the failing test");
	const bubblePlain = stripAnsi(userComp.render(80).join("\n"));
	assert.ok(bubblePlain.includes("╭─"), "draws bubble border around user prompt");
	assert.ok(bubblePlain.includes("fix the failing test"), "draws prompt text");
	assert.match(bubblePlain, /\d{2}:\d{2}/, "draws 24h clock timestamp");

	await h.commands.get("prism")!.handler("setup prompts wide", h.ctx);
	userComp.rebuild();
	const widePlain = stripAnsi(userComp.render(80).join("\n"));
	assert.ok(widePlain.includes(`╭${"─".repeat(76)}╮`), "wide prompt spans full content width");

	await h.commands.get("prism")!.handler("setup prompts chevron", h.ctx);
	userComp.rebuild();
	const chevronPlain = stripAnsi(userComp.render(80).join("\n"));
	assert.ok(chevronPlain.includes("› "), "draws chevron prompt marker");
});

test("4. /prism commands, interactive setup pane, pi theme tracking, and turn duration entry work", async () => {
	setTheme("dark");
	const h = createHarness({ clock: "24h" });
	cleanupFn = h.cleanup;
	await h.emit("session_start");
	assert.equal(h.getActivePiTheme(), "system", "prism never calls ctx.ui.setTheme");

	const comp = new AssistantMessageComponent({
		role: "assistant",
		content: [{ type: "text", text: "# Heading" }],
		timestamp: 1500,
	} as any);
	const darkRendered = comp.render(80).join("\n");
	setTheme("light");
	const lightRendered = comp.render(80).join("\n");
	assert.notEqual(darkRendered, lightRendered, "switching pi theme dynamically updates prism colors");
	setTheme("dark");

	const cmd = h.commands.get("prism")!;
	await cmd.handler("demo ko", h.ctx);
	assert.equal(h.sentCustomMessages.length, 0, "does not call pi.sendMessage (never enters LLM context)");
	assert.equal(h.appendedEntries.at(-1)?.customType, "prism-output", "appends display-only custom entry");
	const outputEntryRenderer = h.entryRenderers.get("prism-output")!;
	const demoComp = outputEntryRenderer(h.appendedEntries.at(-1), { expanded: false }, activePiGlobalTheme);
	const demoPlain = stripAnsi(demoComp.render(96).join("\n"));
	assert.ok(demoPlain.includes("한국어"), "demo ko includes Korean showcase");
	assert.ok(demoPlain.includes("Parse"), "demo renders mermaid diagrams and pie charts");
	assert.ok(!demoPlain.includes("Claude Code"), "demo contains zero Claude Code references");

	await cmd.handler("", h.ctx);
	const helpComp = outputEntryRenderer(h.appendedEntries.at(-1), { expanded: false }, activePiGlobalTheme);
	const helpPlain = stripAnsi(helpComp.render(96).join("\n"));
	assert.ok(!helpPlain.includes("Claude Code"), "help contains zero Claude Code references");

	const ctxEvent = {
		type: "context",
		messages: [
			{ role: "user", content: "hello" },
			{ role: "custom", customType: "prism-output", content: "demo" },
		],
	};
	const filteredCtx = await h.emit("context", ctxEvent);
	assert.deepEqual(filteredCtx, { messages: [{ role: "user", content: "hello" }] }, "filters prism-output from LLM context");

	void cmd.handler("setup", h.ctx);
	const overlay = h.getOverlay();
	assert.ok(overlay, "opens interactive setup overlay in TUI mode");
	const initialOverlayPlain = stripAnsi(overlay.render(90).join("\n"));
	assert.ok(initialOverlayPlain.includes("Setup 1/7: Tables"), "renders step 1 (Tables) in 7-step setup overlay");
	overlay.handleInput("\x1b[B");
	overlay.handleInput("\r");
	assert.equal(h.readConfig().tableStyle, "rules", "saves selected tableStyle to prism.json");
	assert.equal(h.readConfig().theme, undefined, "does not write theme to prism.json");
	assert.equal(h.readConfig().syncPiTheme, undefined, "does not write syncPiTheme to prism.json");
	const step2Plain = stripAnsi(overlay.render(90).join("\n"));
	assert.ok(step2Plain.includes("Setup 2/7: Tasks"), "advances to step 2 (Tasks) after Enter");
	overlay.handleInput("\x1b");
	assert.equal(h.getOverlay(), null, "Escape closes setup overlay");

	const startEvent = {
		type: "before_agent_start",
		messageType: "user",
		prompt: "explain how the queue works",
		systemPrompt: "",
		systemPromptOptions: { guidelines: [] as string[] },
	};
	await h.emit("before_agent_start", startEvent);
	assert.ok(
		startEvent.systemPromptOptions.guidelines.some((g) => g.includes("drawn by prism inside Pi")),
		"injects Pi-native diagram hint into guidelines",
	);
	assert.ok(
		startEvent.systemPromptOptions.guidelines.every((g) => !g.includes("Claude")),
		"system prompt guidelines contain zero Claude references",
	);
	assert.ok(
		startEvent.systemPromptOptions.guidelines.some((g) => g.includes("```figure")),
		"injects figure hint into guidelines",
	);

	const entryRenderer = h.entryRenderers.get("prism-turn")!;
	const turnComp = entryRenderer(
		{ type: "custom", customType: "prism-turn", data: { durationMs: 125000, at: Date.now() } },
		{ expanded: false },
		activePiGlobalTheme,
	);
	const turnPlain = stripAnsi(turnComp.render(80).join("\n"));
	assert.ok(
		turnPlain.includes("✻ prismantis rendering for 2m 5s"),
		`expected prismantis rendering duration footer, got: ${turnPlain}`,
	);

	const transformer = h.markdownTransformers[0]!;
	const transformed = transformer("```figure\n{ok:✓ healthy}\n```", {
		messageType: "assistant",
		isStreaming: false,
		availableWidth: 80,
	});
	assert.ok(transformed.includes("✓ healthy") && !transformed.includes("```figure"), "transforms figure blocks in standard Markdown");
});

const INVERSE = "\x1b[7m";
const move = (x: number, y: number) => ({ type: "move", button: "none", x, y, width: 40, height: 4 }) as any;

function hoverFixture() {
	const tree = h(
		EL.Box,
		{ flexDirection: "column" },
		h(EL.Button, { variant: "secondary", label: "⧉ source", onPress: () => {} }),
		h(EL.Text, { hover: { color: "#ff0000" }, onPress: () => {} }, "styled link"),
		h(EL.Text, {}, "plain text"),
	);
	const comp = new PrismComponent(() => tree);
	comp.render(40);
	return comp;
}

test("5. Hovering a button highlights it and moving off clears it", () => {
	const comp = hoverFixture();
	assert.ok(!comp.render(40).join("").includes(INVERSE), "no highlight before any pointer move");

	assert.deepEqual(comp.handleMouse(move(3, 0)), { handled: true, render: true }, "pi only repaints a move reported as handled");
	const lit = comp.render(40);
	assert.ok(lit[0]!.includes(`${INVERSE}`) && stripAnsi(lit[0]!).includes("[ ⧉ source ]"), "button is inverse on hover");
	assert.equal(comp.handleMouse(move(4, 0)), undefined, "moving within the same button changes nothing");

	assert.deepEqual(comp.handleMouse(move(3, 2)), { handled: true, render: true });
	assert.ok(!comp.render(40).join("").includes(INVERSE), "moving to plain text clears the highlight");
});

test("6. A hover prop replaces the default inverse highlight", () => {
	const comp = hoverFixture();
	comp.handleMouse(move(2, 1));
	const lines = comp.render(40);
	assert.ok(lines[1]!.includes("38;2;255;0;0"), "uses the hover color");
	assert.ok(!lines[1]!.includes(INVERSE), "does not fall back to inverse");
});

test("7. Only one element is highlighted across components, and leaving them all clears it", () => {
	const a = hoverFixture();
	const b = hoverFixture();
	a.handleMouse(move(3, 0));
	b.handleMouse(move(3, 0));
	assert.ok(!a.render(40).join("").includes(INVERSE), "first component is cleared when the pointer enters another");
	assert.ok(b.render(40).join("").includes(INVERSE), "second component is highlighted");

	assert.equal(settlePointerMove(), false, "a move claimed by a component keeps its highlight");
	assert.ok(b.render(40).join("").includes(INVERSE));
	assert.equal(settlePointerMove(), true, "a move no component claimed clears the highlight");
	assert.ok(!b.render(40).join("").includes(INVERSE), "pointer left every component");
	assert.equal(clearHover(), false, "nothing left to clear");
});

test("8. color slot overrides, table <br> line breaks, and probed loose path hyperlinks work", async () => {
	const prevForce = process.env.FORCE_HYPERLINK;
	process.env.FORCE_HYPERLINK = "1";
	const h = createHarness({ headingColor: "#ff00ff" });
	const projectDir = join(h.dir, "workspace");
	mkdirSync(join(projectDir, "docs", "guide"), { recursive: true });
	mkdirSync(join(projectDir, "src"), { recursive: true });
	writeFileSync(join(projectDir, "src", "app.ts"), "export const x = 1;\n");
	writeFileSync(join(projectDir, "notes.md"), "# Notes\n");
	writeFileSync(join(projectDir, "run.sh"), "#!/bin/sh\n");
	h.ctx.cwd = projectDir;

	cleanupFn = () => {
		if (prevForce === undefined) delete process.env.FORCE_HYPERLINK;
		else process.env.FORCE_HYPERLINK = prevForce;
		h.cleanup();
	};

	await h.emit("session_start");

	const tableMd = [
		"| Cell | Code |",
		"|:-----|:-----|",
		"| a<br>b<br/>c<BR>d | `x<br>y` |",
	].join("\n");
	const tableBlocks = parse(tableMd, { numbers: true, paths: true });
	const tableBlock = tableBlocks[0];
	assert.equal(tableBlock?.kind, "table");
	assert.ok(tableHtml(tableBlock).includes("a<br>b<br>c<br>d"));
	assert.ok(tableHtml(tableBlock).includes('<code style="white-space: pre-wrap">x&lt;br&gt;y</code>'));
	assert.ok(tableText(tableBlock).includes('"a\nb\nc\nd"\tx<br>y'));

	const reply = [
		"# Custom Heading",
		"",
		tableMd,
		"",
		"See docs/guide/, src/app.ts:42, `src/app.ts`, notes.md, missing.ts, later.ts, and/or run.sh.",
	].join("\n");

	const comp = new AssistantMessageComponent({
		role: "assistant",
		content: [{ type: "text", text: reply }],
		timestamp: 2000,
	} as any);

	const rawRendered = comp.render(100).join("\n");
	assert.ok(rawRendered.includes("38;2;255;0;255"), "applies headingColor override from prismantis.json");
	const plainRendered = stripAnsi(rawRendered);
	assert.ok(plainRendered.includes("x<br>y"), "keeps <br> literal inside inline code");
	for (const linePart of ["│ a", "│ b", "│ c", "│ d"]) {
		assert.ok(plainRendered.includes(linePart), `breaks table cell line for ${linePart}`);
	}

	assert.ok(rawRendered.includes(`file://${projectDir}/docs/guide/`), "links existing directory path");
	assert.equal(
		rawRendered.split(`file://${projectDir}/src/app.ts`).length - 1,
		2,
		"links both loose path:line and inline-code `path`",
	);
	assert.ok(rawRendered.includes(`file://${projectDir}/notes.md`), "links existing root file");
	assert.ok(!rawRendered.includes(`file://${projectDir}/missing.ts`), "does not link missing file");
	assert.ok(!rawRendered.includes(`file://${projectDir}/later.ts`), "does not link not-yet-created file");
	assert.ok(!rawRendered.includes("and/or\x1b]8;;"), "does not link slash prose");
	assert.ok(!rawRendered.includes(`file://${projectDir}/run.sh`), "does not link launcher script");

	writeFileSync(join(projectDir, "later.ts"), "export const y = 2;\n");
	await h.emit("tool_result", {});
	comp.invalidate();
	const rawAfterTool = comp.render(100).join("\n");
	assert.ok(rawAfterTool.includes(`file://${projectDir}/later.ts`), "links file created after tool_result resets unfound probes");
});
