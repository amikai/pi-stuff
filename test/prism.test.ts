import assert from "node:assert/strict";
import childProcess, { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, deflateSync, inflateSync } from "node:zlib";

import type { Desktop } from "../extensions/prism/desktop.ts";

const whichPi = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
const piPkg = realpathSync(resolve(dirname(realpathSync(whichPi)), "../@earendil-works/pi-coding-agent/package.json"));
const parentURL = pathToFileURL(piPkg).href;
const copiedTexts: string[] = [];
(globalThis as any).__prismCopiedTexts = copiedTexts;
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith("@earendil-works/")) {
			return nextResolve(specifier, { ...context, parentURL });
		}
		return nextResolve(specifier, context);
	},
	// pi's copyToClipboard writes the real pasteboard, so pressing a source button would clobber it. Record the text instead.
	load(url, context, nextLoad) {
		const loaded = nextLoad(url, context);
		if (!url.endsWith("/pi-coding-agent/dist/utils/clipboard.js")) return loaded;
		const real = "export async function copyToClipboard(";
		const source = String(loaded.source);
		if (!source.includes(real)) throw new Error("pi's copyToClipboard moved; the tests would write the real clipboard");
		return {
			...loaded,
			source: `${source.replace(real, "async function realCopyToClipboard(")}\nexport async function copyToClipboard(text) { globalThis.__prismCopiedTexts.push(text); }\n`,
		};
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
const { Container, getCellDimensions, matchesKey, resetCapabilitiesCache, ScrollView, setCapabilities, setCellDimensions, Text, visibleWidth } = await import("@earendil-works/pi-tui");
const { renderLayoutFrame } = await import(
	pathToFileURL(resolve(dirname(realpathSync(fileURLToPath(import.meta.resolve("@earendil-works/pi-tui", parentURL)))), "layout.js")).href
);
initTheme("dark");

const { default: prismExtension, themeFromPiTheme } = await import("../extensions/prism/index.ts");
const { EL, h } = await import("../extensions/prism/core/jsx.ts");
const { PrismComponent } = await import("../extensions/prism/renderer.ts");
const { clearHover, settlePointerMove } = await import("../extensions/lib/pointer-hover.ts");
const { tableHtml, tableText } = await import("../extensions/prism/core/html.ts");
const { parse } = await import("../extensions/prism/core/markdown.ts");
const { background } = await import("../extensions/prism/core/background.ts");
const { fallback, textNote, textVerdict } = await import("../extensions/prism/core/mermaid.ts");
const { headerWord, MERMAN_HINT, MERMAN_KINDS, mermanJobs, mermanPicture } = await import("../extensions/prism/core/merman.ts");
const { plantumlJobs, plantumlTimeout } = await import("../extensions/prism/core/plantuml.ts");
const { resolveStyle } = await import("../extensions/prism/core/theme.ts");
const { holdEngine, holdRow } = await import("../extensions/prism/core/rtl.ts");
const { imageCommand, MAC_IMAGE_COPY, WIN_IMAGE_COPY } = await import("../extensions/prism/core/clipboard.ts");
const { helpText, showcaseText } = await import("../extensions/prism/core/help.ts");

const stripAnsi = (s: string) =>
	s
		.replace(/\x1b\[[0-9;]*m/g, "")
		.replace(/\x1b\]8;;.*?(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b\]133;[A-Z]\x07/g, "");

function recordingDesktop(pictures = true) {
	const did = { pngs: [] as Buffer[], previews: [] as Buffer[], previewReports: [] as Parameters<Desktop["previewPng"]>[1][] };
	const desktop: Desktop = {
		pictures,
		copyPng: (png) => (did.pngs.push(Buffer.from(png)), null),
		previewPng: (png, report) => {
			did.previews.push(Buffer.from(png));
			did.previewReports.push(report);
		},
	};
	return { desktop, did };
}

function createHarness(initialConfig?: Record<string, unknown>, recording = recordingDesktop()) {
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

	const renders = { screen: 0, overlay: 0 };
	const overlayTui = {
		terminal: { columns: 100, rows: 40 },
		requestRender: () => {
			renders.overlay++;
		},
	} as any;
	const screenTui = {
		terminal: { columns: 100, rows: 40 },
		requestRender: () => {
			renders.screen++;
		},
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
			setWidget: (_key: string, factory: unknown) => {
				if (typeof factory === "function") factory(screenTui);
			},
			custom: async (factory: any) => {
				return new Promise<void>((resolveDone) => {
					overlayComponent = factory(overlayTui, activePiGlobalTheme, { matches: matchesKey }, () => {
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

	prismExtension(pi, recording.desktop);

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
		desktop: recording.did,
		sentCustomMessages,
		appendedEntries,
		getActivePiTheme: () => activePiTheme,
		getOverlay: () => overlayComponent,
		renders,
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

test("1. prism derives its palette from pi's active theme without mutating global theme or registering tool renderers", () => {
	setTheme("dark");
	const darkPalette = themeFromPiTheme(activePiGlobalTheme);
	assert.match(darkPalette.accent ?? "", /^#[0-9a-f]{6}$/);
	assert.match(darkPalette.heading ?? "", /^#[0-9a-f]{6}$/);
	assert.match(darkPalette.diagram ?? "", /^#[0-9a-f]{6}$/);
	assert.match(darkPalette.codeString ?? "", /^#[0-9a-f]{6}$/);

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

test("3. UserMessageComponent renders bubble, wide, bar, chevron prompt styles", async () => {
	const h = createHarness({ promptStyle: "bubble" });
	cleanupFn = h.cleanup;
	await h.emit("session_start");

	const userComp = new UserMessageComponent("fix the failing test");
	const bubblePlain = stripAnsi(userComp.render(80).join("\n"));
	assert.ok(bubblePlain.includes("╭─"), "draws bubble border around user prompt");
	assert.ok(bubblePlain.includes("fix the failing test"), "draws prompt text");

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
	const h = createHarness();
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
	assert.ok(initialOverlayPlain.includes("Setup 1/6: Tables"), "renders step 1 (Tables) in 6-step setup overlay");
	overlay.handleInput("\x1b[B");
	overlay.handleInput("\r");
	assert.equal(h.readConfig().tableStyle, "rules", "saves selected tableStyle to prism.json");
	assert.equal(h.readConfig().theme, undefined, "does not write theme to prism.json");
	assert.equal(h.readConfig().syncPiTheme, undefined, "does not write syncPiTheme to prism.json");
	const step2Plain = stripAnsi(overlay.render(90).join("\n"));
	assert.ok(step2Plain.includes("Setup 2/6: Tasks"), "advances to step 2 (Tasks) after Enter");
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
		{ type: "custom", customType: "prism-turn", data: { durationMs: 125000 } },
		{ expanded: false },
		activePiGlobalTheme,
	);
	const turnPlain = stripAnsi(turnComp.render(80).join("\n"));
	assert.ok(
		turnPlain.includes("✻ prism rendering for 2m 5s"),
		`expected prism rendering duration footer, got: ${turnPlain}`,
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
	assert.ok(rawRendered.includes("38;2;255;0;255"), "applies headingColor override from the legacy settings file");
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

const pngOf = (width: number, height: number) => {
	const chunk = (type: string, data: Buffer) => {
		const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
		const head = Buffer.alloc(4);
		head.writeUInt32BE(data.length);
		const tail = Buffer.alloc(4);
		tail.writeUInt32BE(crc32(body));
		return Buffer.concat([head, body, tail]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 0, 0, 0, 0], 8);
	const pixels = Buffer.alloc((width + 1) * height);
	return Buffer.concat([
		Buffer.from("89504e470d0a1a0a", "hex"),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(pixels)),
		chunk("IEND", Buffer.alloc(0)),
	]);
};

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function until(condition: () => boolean, ms = 3000) {
	for (let waited = 0; !condition() && waited < ms; waited += 10) await sleep(10);
	assert.ok(condition(), "condition was not met in time");
}

let diagramCount = 0;
const diagram = (tag = "", body = "Alice -> Bob : hi") =>
	["```plantuml", "@startuml", `' ${tag} #${++diagramCount}`, body, "@enduml", "```"].join("\n");

const REPLY_INSET = 4;
const fittedAt = (columns: number) => columns + REPLY_INSET;

const reply = (text: string) =>
	new AssistantMessageComponent({ role: "assistant", content: [{ type: "text", text }], timestamp: 1000 } as any);

function plantumlTerminal(options: { images?: "kitty" | "iterm2" | null } = {}) {
	setCapabilities({ images: options.images === undefined ? "kitty" : options.images, trueColor: true, hyperlinks: false });
	plantumlJobs.clear();
	return {
		restore: () => {
			resetCapabilitiesCache();
			plantumlJobs.clear();
			plantumlTimeout.ms = 5000;
		},
	};
}

const cachedImages = () =>
	[...plantumlJobs.cache.values()].flatMap((entry) => (entry.kind === "image" ? [entry] : []));

// The newest image the worker drew, as the exact bytes the terminal receives.
const drawnPng = () => {
	const entry = cachedImages().at(-1);
	assert.ok(entry, "a plantuml image is cached");
	return Buffer.from(entry.png, "base64");
};

// Kitty splits the PNG over several escape sequences; iTerm2 sends it in one.
const sentPayload = (text: string) => [...text.matchAll(/\x1b_G[^;\x1b]*;([^\x1b]*)\x1b\\|\x1b\]1337;File=[^:]*:([^\x07]*)\x07/g)].map((m) => m[1] ?? m[2]).join("");

const manyMessages = Array.from({ length: 12 }, (_, i) => `Alice -> Bob : step ${i}`).join("\n");

const KITTY_IMAGE = "\x1b_G";
const ITERM2_IMAGE = "\x1b]1337;File=";

test("9. a plantuml block draws its source first, then an image, one job per block, and redraws the screen", async () => {
	const terminal = plantumlTerminal();
	const h = createHarness();
	cleanupFn = () => {
		terminal.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	const comp = reply(["Intro", "", "  @startuml", "' png", "Alice -> Bob : hi", "  @enduml"].join("\n"));
	const first = stripAnsi(comp.render(100).join("\n"));
	assert.ok(first.includes("Alice -> Bob : hi"), "first frame draws the source");
	assert.equal(plantumlJobs.pending.size, 1, "render starts one background job");

	await plantumlJobs.idle();
	assert.ok(h.renders.screen > 0, "falls back to the screen TUI for the redraw");
	assert.equal(h.renders.overlay, 0, "no setup overlay is open");
	const drawn = comp.render(100).join("\n");
	assert.ok(drawn.includes(KITTY_IMAGE), "second frame draws the PNG");
	assert.ok(!stripAnsi(drawn).includes("Alice -> Bob : hi"), "source is gone once the image is drawn");
	const png = drawnPng();
	assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "the terminal receives a PNG");
	assert.equal(sentPayload(drawn), png.toString("base64"), "it is the PNG the worker made");

	comp.invalidate();
	comp.render(100);
	assert.equal(plantumlJobs.pending.size, 0, "later frames hit the cache");
	assert.equal(plantumlJobs.cache.size, 1);

	const twice = diagram("twice");
	reply([twice, "", twice, "", diagram("other")].join("\n")).render(100);
	assert.equal(plantumlJobs.pending.size, 2, "a repeated block shares one job");
	await plantumlJobs.idle();
	assert.equal(plantumlJobs.cache.size, 3);
});

test("10. a terminal without images shows a note and starts no job", async () => {
	const terminal = plantumlTerminal({ images: null });
	const h = createHarness();
	cleanupFn = () => {
		terminal.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	const comp = reply(diagram("no images"));
	const note = stripAnsi(comp.render(100).join("\n"));
	assert.ok(note.includes("plantuml diagrams require an image-capable terminal"), "explains the refusal on the first frame");
	assert.equal(plantumlJobs.pending.size, 0, "does not start a job");
	await sleep(50);
	assert.ok(stripAnsi(comp.render(100).join("\n")).includes("image-capable terminal"), "the note stays");
	assert.equal(cachedImages().length, 0);
});

test("11. a stuck plantuml render times out with a note, and the next render gets a fresh worker", async () => {
	const terminal = plantumlTerminal();
	const h = createHarness();
	cleanupFn = () => {
		terminal.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	// Graphviz takes far longer than the timeout to lay out three thousand edges.
	const edges = [];
	for (let from = 0; from < 60; from++) for (let to = 0; to < 60; to++) if (from !== to) edges.push(`C${from} --> C${to}`);
	const stuck = diagram("stuck", edges.join("\n"));

	plantumlTimeout.ms = 1000;
	const comp = reply([stuck, "", diagram("after the stuck one")].join("\n"));
	comp.render(100);
	assert.equal(plantumlJobs.pending.size, 2);
	const started = Date.now();
	await plantumlJobs.idle(8000);
	assert.ok(Date.now() - started < 4000, "the stuck render ends at the timeout");
	const plain = stripAnsi(comp.render(100).join("\n"));
	assert.ok(plain.includes("plantuml render timed out"), "reports the timeout");
	assert.ok(comp.render(100).join("\n").includes(KITTY_IMAGE), "the block queued behind it still draws");
	assert.equal(plantumlJobs.pending.size, 0, "no key is left in flight");

	plantumlTimeout.ms = 5000;
	comp.invalidate();
	comp.render(100);
	assert.equal(plantumlJobs.pending.size, 0, "a timed-out render stays cached, not retried");

	const later = reply(diagram("later"));
	later.render(100);
	await plantumlJobs.idle();
	assert.ok(later.render(100).join("\n").includes(KITTY_IMAGE), "a render after the timeout draws");
});

test("12. a plantuml syntax error reports the source line, with and without @startuml markers", async () => {
	const terminal = plantumlTerminal();
	const h = createHarness();
	cleanupFn = () => {
		terminal.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	const noteOf = async (markdown: string) => {
		const comp = reply(markdown);
		comp.render(100);
		await plantumlJobs.idle();
		return stripAnsi(comp.render(100).join("\n"));
	};
	assert.ok((await noteOf(diagram("syntax", "foo bar baz"))).includes("plantuml error (line 3): Syntax Error?"), "markers and a comment put the fault on line 3");
	assert.ok(
		(await noteOf(["```plantuml", "' bare", "foo bar baz", "```"].join("\n"))).includes("plantuml error (line 2): Syntax Error?"),
		"the markers prism adds do not shift the line",
	);
	assert.ok(
		(await noteOf(["```plantuml", "", "", "@startuml", "foo bar baz", "@enduml", "```"].join("\n"))).includes("plantuml error (line 4): Syntax Error?"),
		"blank lines before @startuml still count",
	);
});

test("13. a blocked plantuml include shows PlantUML's reason", async () => {
	const terminal = plantumlTerminal();
	const h = createHarness();
	cleanupFn = () => {
		terminal.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	const noteOf = async (body: string) => {
		const comp = reply(diagram("include", body));
		comp.render(200);
		await plantumlJobs.idle();
		return stripAnsi(comp.render(200).join("\n"));
	};
	assert.ok((await noteOf("!include /etc/passwd")).includes("plantuml error (line 3): cannot include /etc/passwd"), "a file include names the file and its line");
	assert.ok((await noteOf("!includeurl https://example.com/a.puml")).includes("plantuml error (line 3): cannot include https://example.com/a.puml"), "a URL include is refused too");
	assert.ok((await noteOf("!include <awslib/AWSCommon>")).includes("plantuml error (line 3): cannot include <awslib/AWSCommon>"), "a stdlib file other than C4 is refused");
	assert.ok((await noteOf("!theme x from /etc")).includes("plantuml error (line 3): Cannot load theme x in /etc"), "a theme folder on disk is refused");
	assert.equal(cachedImages().length, 0, "nothing was drawn");
});

test("14. other diagram kinds draw as images, including the ones Graphviz lays out", async () => {
	const terminal = plantumlTerminal();
	const h = createHarness();
	cleanupFn = () => {
		terminal.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	const kinds = [
		diagram("class", "class Foo {\n  +bar()\n}\nFoo --> Baz"),
		diagram("state", "[*] --> Idle\nIdle --> Busy : go"),
		["```plantuml", "@startmindmap", "* root", "** leaf", "@endmindmap", "```"].join("\n"),
		["```plantuml", "@startgantt", "[Build] lasts 3 days", "@endgantt", "```"].join("\n"),
	];
	const comp = reply(kinds.join("\n\n"));
	comp.render(100);
	await plantumlJobs.idle();
	const lines = comp.render(100).join("\n");
	assert.equal(lines.split("\x1b_Ga=T").length - 1, kinds.length, "every kind is an image");
	assert.ok(!stripAnsi(lines).includes("plantuml error"), "no kind reports an error");
});

test("15. plantuml detection covers fences and unfenced blocks, and leaves unclosed and nested ones as text", async () => {
	const hl = { numbers: false, paths: false };
	const kinds = (md: string) => parse(md, hl).map((b) => (b.kind === "code" ? b.lang : b.kind));
	assert.deepEqual(kinds("@startuml\nA -> B\n@enduml"), ["plantuml"], "closed unfenced block");
	assert.deepEqual(kinds("text\n  @startmindmap\n* root\n  @endmindmap\nmore"), ["paragraph", "plantuml", "paragraph"], "indented marker");
	assert.deepEqual(kinds("@startuml\nA -> B"), ["paragraph"], "unclosed @startuml stays paragraph text");
	assert.deepEqual(kinds("@startuml\nA -> B\n@endmindmap"), ["paragraph"], "mismatched end stays paragraph text");
	assert.deepEqual(kinds("@startfoo\nA\n@endfoo"), ["paragraph"], "unknown kind is not plantuml");
	assert.deepEqual(kinds("> @startuml\n> A -> B\n> @enduml"), ["quote"], "a quoted block is not detected");
	assert.deepEqual(kinds("```puml\nA -> B\n```"), ["puml"]);

	const terminal = plantumlTerminal();
	const h = createHarness();
	cleanupFn = () => {
		terminal.restore();
		h.cleanup();
	};
	await h.emit("session_start");
	const untagged = reply("```\n@startuml\n' untagged\nA -> B\n@enduml\n```");
	untagged.render(100);
	assert.equal(plantumlJobs.pending.size, 1, "an untagged fence opening with @start renders");
	await plantumlJobs.idle();
	const plain = reply("```\nA -> B\n```");
	plain.render(100);
	assert.equal(plantumlJobs.pending.size, 0, "an untagged fence without @start is plain code");

	const startEvent = {
		type: "before_agent_start",
		messageType: "user",
		prompt: "x",
		systemPrompt: "",
		systemPromptOptions: { guidelines: [] as string[] },
	};
	await h.emit("before_agent_start", startEvent);
	assert.ok(startEvent.systemPromptOptions.guidelines.some((g) => g.includes("!include")), "hints PlantUML when enabled");
});

test("16. plantuml:false renders PlantUML blocks as ordinary code, starts no job, and drops the hint", async () => {
	const terminal = plantumlTerminal();
	const h = createHarness({ plantuml: false });
	cleanupFn = () => {
		terminal.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	const comp = reply([diagram("off"), "", "@startuml", "' bare off", "A -> B", "@enduml"].join("\n"));
	const plain = stripAnsi(comp.render(100).join("\n"));
	assert.ok(plain.includes("Alice -> Bob : hi") && plain.includes("A -> B"), "draws both blocks as code");
	await sleep(100);
	assert.equal(plantumlJobs.pending.size, 0, "starts no job");
	assert.equal(plantumlJobs.cache.size, 0);

	const startEvent = {
		type: "before_agent_start",
		messageType: "user",
		prompt: "x",
		systemPrompt: "",
		systemPromptOptions: { guidelines: [] as string[] },
	};
	await h.emit("before_agent_start", startEvent);
	assert.ok(startEvent.systemPromptOptions.guidelines.every((g) => !g.includes("!include")), "no PlantUML hint");

	assert.equal(resolveStyle({}).plantuml, true);
	assert.equal(resolveStyle({ plantuml: false }).plantuml, false);
});

test("17. closing the setup overlay stops plantuml redraws from going to the stale overlay TUI", async () => {
	const terminal = plantumlTerminal();
	const h = createHarness();
	cleanupFn = () => {
		terminal.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	void h.commands.get("prism")!.handler("setup", h.ctx);
	assert.ok(h.getOverlay(), "setup overlay is open");
	reply(diagram("overlay open")).render(100);
	await plantumlJobs.idle();
	assert.ok(h.renders.overlay > 0, "redraw goes to the open overlay");
	assert.equal(h.renders.screen, 0);

	h.getOverlay().handleInput("\x1b");
	assert.equal(h.getOverlay(), null, "Escape closes the overlay");
	const overlayRenders = h.renders.overlay;
	reply(diagram("overlay closed")).render(100);
	await plantumlJobs.idle();
	assert.ok(h.renders.screen > 0, "redraw goes to the screen TUI");
	assert.equal(h.renders.overlay, overlayRenders, "stale overlay handle is not used");
});

test("18. five plantuml blocks share one worker and each draws its own picture", async () => {
	const terminal = plantumlTerminal();
	const h = createHarness();
	cleanupFn = () => {
		terminal.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	const comp = reply(Array.from({ length: 5 }, (_, i) => diagram(`many ${i}`, Array.from({ length: i + 1 }, (_, j) => `Alice -> Bob : m${j}`).join("\n"))).join("\n\n"));
	comp.render(100);
	assert.equal(plantumlJobs.pending.size, 5);
	await plantumlJobs.idle();
	const images = cachedImages();
	assert.equal(images.length, 5, "all five end as images");
	assert.equal(new Set(images.map((image) => image.png)).size, 5, "no reply went to the wrong block");
	assert.deepEqual(images.map((image) => image.height), images.map((image) => image.height).sort((a, b) => a - b), "a longer diagram is taller, in block order");
});

test("19. a plantuml image reserves a line per image row, so the text after it is never drawn under it", async () => {
	for (const images of ["kitty", "iterm2"] as const) {
		const terminal = plantumlTerminal({ images });
		const h = createHarness();
		cleanupFn = () => {
			terminal.restore();
			h.cleanup();
		};
		await h.emit("session_start");

		const comp = reply([diagram(images, manyMessages), "", "After the diagram"].join("\n"));
		comp.render(100);
		await plantumlJobs.idle();
		const png = drawnPng();
		const lines = comp.render(100);
		const at = lines.findIndex((line) => line.includes(images === "kitty" ? KITTY_IMAGE : ITERM2_IMAGE));
		assert.ok(at >= 0, `${images}: the diagram is drawn as an image`);
		// Kitty draws down from its line; iTerm2 moves up to the top row first.
		const up = Number(/\x1b\[(\d+)A/.exec(lines[at]!)?.[1] ?? 0);
		const rows = images === "kitty" ? Number(/[,;]r=(\d+)/.exec(lines[at]!)?.[1]) : up + 1;
		const top = at - up;
		assert.ok(rows > 1, `${images}: the image spans ${rows} rows`);
		const covered = lines.slice(top, top + rows).filter((_, i) => top + i !== at).map((line) => stripAnsi(line).trim());
		assert.deepEqual(covered, Array(rows - 1).fill(""), `${images}: rows under the image are left blank`);
		const after = lines.findIndex((line) => stripAnsi(line).includes("After the diagram"));
		assert.ok(after >= top + rows, `${images}: text after the image starts on row ${after - top} of a ${rows}-row image`);
		if (images === "kitty") assert.match(lines[at]!, /[,;]C=1[,;]/, "the terminal is told not to move the cursor past the image");
		assert.equal(sentPayload(lines[at]!), png.toString("base64"), `${images}: the terminal receives the whole PNG`);
		cleanupFn();
		cleanupFn = undefined;
	}
});

test("20. a drawn image keeps one Kitty image id across redraws and streaming updates, and each reply gets its own", async () => {
	const terminal = plantumlTerminal();
	const h = createHarness();
	cleanupFn = () => {
		terminal.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	const text = diagram("ids", manyMessages);
	const message = { role: "assistant", content: [{ type: "text", text }], timestamp: 1000 } as any;
	const comp = new AssistantMessageComponent(message);
	comp.render(100);
	await plantumlJobs.idle();
	const idOf = (lines: string[]) => /[,;]i=(\d+)/.exec(lines.find((line) => line.includes(KITTY_IMAGE)) ?? "")?.[1];
	const first = idOf(comp.render(100));
	assert.ok(first, "the image carries a Kitty image id");

	comp.invalidate();
	assert.equal(idOf(comp.render(100)), first, "a redraw keeps the id");
	comp.updateContent(message);
	assert.equal(idOf(comp.render(100)), first, "a streaming update keeps the id, so the image is not sent again");
	assert.notEqual(idOf(reply(text).render(100)), first, "another reply with the same diagram gets its own id");
});

test("21. an image drawn before the terminal reports its cell size lays out like a fresh one once the size arrives", async () => {
	const savedCell = getCellDimensions();
	for (const images of ["kitty", "iterm2"] as const) {
		setCellDimensions({ widthPx: 9, heightPx: 18 });
		const terminal = plantumlTerminal({ images });
		const h = createHarness();
		cleanupFn = () => {
			terminal.restore();
			h.cleanup();
			setCellDimensions(savedCell);
		};
		await h.emit("session_start");

		const text = diagram(`cell ${images}`, manyMessages);
		const comp = reply(text);
		comp.render(100);
		await plantumlJobs.idle();
		const reserved = (lines: string[]) => {
			const line = lines.find((l) => l.includes(images === "kitty" ? KITTY_IMAGE : ITERM2_IMAGE)) ?? "";
			return images === "kitty" ? Number(/[,;]r=(\d+)/.exec(line)?.[1]) : Number(/\x1b\[(\d+)A/.exec(line)?.[1] ?? 0) + 1;
		};
		const before = reserved(comp.render(100));

		setCellDimensions({ widthPx: 10, heightPx: 30 });
		comp.invalidate();
		const fresh = reserved(reply(text).render(100));
		assert.notEqual(fresh, before, `${images}: the new cell size changes how many rows the image covers`);
		assert.equal(reserved(comp.render(100)), fresh, `${images}: the earlier message reserves the rows the image now covers`);
		cleanupFn();
		cleanupFn = undefined;
	}
});

test("22. a plantuml diagram replaces its source after a streaming update that arrived while it rendered", async () => {
	const terminal = plantumlTerminal();
	const h = createHarness();
	cleanupFn = () => {
		terminal.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	const message = { role: "assistant", content: [{ type: "text", text: [diagram("streamed"), "", "After"].join("\n") }], timestamp: 1000 } as any;
	const comp = new AssistantMessageComponent(message);
	comp.render(100);
	assert.equal(plantumlJobs.pending.size, 1, "the first frame starts the render");
	comp.updateContent(message);
	assert.ok(stripAnsi(comp.render(100).join("\n")).includes("Alice -> Bob : hi"), "the rebuilt frame still shows the source while it renders");
	await plantumlJobs.idle();
	assert.ok(comp.render(100).join("\n").includes(KITTY_IMAGE), "the next frame shows the image");
});

const mouse = (type: "move" | "press" | "click", x: number, y: number, width: number, height: number) =>
	({ type, button: type === "move" ? "none" : "left", x, y, screenX: x, screenY: y, width, height }) as any;

const onScreen = (line: string) => stripAnsi(line).replace(/\x1b_G[^\x1b]*\x1b\\/g, "");

// Hover mode keeps its buttons in a panel the renderer never reveals, so they are read from the tree the reply built.
function treeButtons(comp: any, width: number) {
	comp.render(width);
	const prism = comp.contentContainer.children.find((child: unknown) => child instanceof PrismComponent);
	const found: { label: string; onPress: () => void }[] = [];
	const walk = (node: any) => {
		if (Array.isArray(node)) return node.forEach(walk);
		if (node === null || typeof node !== "object") return;
		if (node.type === "Button") found.push({ label: node.props.label, onPress: node.props.onPress });
		walk(node.children);
	};
	walk(prism.tree.node);
	return found;
}

function shownLabels(comp: any, width: number, hover: boolean): string[] {
	if (hover) return treeButtons(comp, width).map((button) => button.label);
	return [...comp.render(width).map(onScreen).join("\n").matchAll(/\[ ([^\]]+) \]/g)].map((match) => match[1]!);
}

function press(comp: any, width: number, label: string, hover: boolean) {
	if (hover) {
		const button = treeButtons(comp, width).find((candidate) => candidate.label === label);
		assert.ok(button, `${label} is in the reply's hover panel`);
		button.onPress();
		return;
	}
	const lines: string[] = comp.render(width);
	const y = lines.findIndex((line) => onScreen(line).includes(`[ ${label} ]`));
	assert.ok(y >= 0, `[ ${label} ] is drawn`);
	const x = onScreen(lines[y]!).indexOf(`[ ${label} ]`) + 2;
	for (const type of ["press", "click"] as const) comp.handleMouse(mouse(type, x, y, width, lines.length));
}

test("23. a plantuml image offers source, image and preview, and each button hands its payload to the desktop", async () => {
	for (const copyButtonStyle of ["inline", "hover"] as const) {
		const terminal = plantumlTerminal();
		const h = createHarness({ copyButtonStyle });
		cleanupFn = () => {
			terminal.restore();
			h.cleanup();
		};
		await h.emit("session_start");
		const text = diagram(copyButtonStyle);
		const comp = reply(text);
		comp.render(100);
		await plantumlJobs.idle();
		const png = drawnPng();
		const hover = copyButtonStyle === "hover";

		assert.deepEqual(shownLabels(comp, 100, hover), ["⧉ source", "⧉ image", "⧉ preview"], `${copyButtonStyle}: three buttons, in order`);
		if (!hover) {
			const plain = comp.render(100).map(onScreen).join("\n");
			assert.ok(plain.includes("[ ⧉ source ] [ ⧉ image ] [ ⧉ preview ]"), "inline: the three buttons share one row");
			assert.ok(!plain.includes("[ ⧉ copy ]"), "inline: the old copy button is gone");
		}

		copiedTexts.length = 0;
		press(comp, 100, "⧉ source", hover);
		assert.deepEqual(copiedTexts, [text.split("\n").slice(1, -1).join("\n")], `${copyButtonStyle}: source hands the PlantUML text to pi's text copy`);
		assert.deepEqual(h.notifications.at(-1), { text: "Copied", level: "info" }, `${copyButtonStyle}: source toasts Copied`);
		press(comp, 100, "⧉ image", hover);
		assert.deepEqual(h.desktop.pngs, [png], `${copyButtonStyle}: image copies the exact PNG that was drawn`);
		assert.deepEqual(h.notifications.at(-1), { text: "Copied image", level: "info" }, `${copyButtonStyle}: image toasts Copied image`);
		press(comp, 100, "⧉ preview", hover);
		assert.deepEqual(h.desktop.previews, [png], `${copyButtonStyle}: preview opens the exact PNG that was drawn`);
		assert.deepEqual(h.desktop.pngs, [png], `${copyButtonStyle}: preview does not copy`);
		h.desktop.previewReports[0]!("Building the Quick Look helper (first use, about 10 s)", "info");
		assert.deepEqual(h.notifications.at(-1), { text: "Building the Quick Look helper (first use, about 10 s)", level: "info" }, `${copyButtonStyle}: a preview notice reaches the user as an info toast`);
		h.desktop.previewReports[0]!("Quick Look failed", "error");
		assert.deepEqual(h.notifications.at(-1), { text: "Quick Look failed", level: "error" }, `${copyButtonStyle}: a preview failure reaches the user as an error toast`);
		cleanupFn();
		cleanupFn = undefined;
	}
});

test("24. picture buttons drop at narrow widths, vanish with copyButtons:false, and are absent where the desktop cannot show pictures", async () => {
	const drawnReply = async (config: Record<string, unknown>, recording = recordingDesktop()) => {
		const terminal = plantumlTerminal();
		const h = createHarness(config, recording);
		cleanupFn = () => {
			terminal.restore();
			h.cleanup();
		};
		await h.emit("session_start");
		const comp = reply(diagram(JSON.stringify(config)));
		comp.render(100);
		await plantumlJobs.idle();
		return { comp, h };
	};

	for (const copyButtonStyle of ["inline", "hover"] as const) {
		const hover = copyButtonStyle === "hover";
		const { comp } = await drawnReply({ copyButtonStyle });
		const at = (columns: number) => shownLabels(comp, fittedAt(columns), hover);
		assert.deepEqual(at(38), ["⧉ source", "⧉ image", "⧉ preview"], `${copyButtonStyle}: render width ${fittedAt(38)} fits 38 columns, the 38 cells all three need`);
		assert.deepEqual(at(37), ["⧉ source", "⧉ image"], `${copyButtonStyle}: render width ${fittedAt(37)} fits 37 columns, so preview drops`);
		assert.deepEqual(at(30), ["⧉ source", "⧉ image"], `${copyButtonStyle}: render width ${fittedAt(30)} fits 30 columns, enough for two`);
		assert.deepEqual(at(24), ["⧉ source", "⧉ image"], `${copyButtonStyle}: render width ${fittedAt(24)} fits 24 columns, the 24 cells two need`);
		assert.deepEqual(at(23), ["⧉ source"], `${copyButtonStyle}: render width ${fittedAt(23)} fits 23 columns, so image drops`);
		assert.deepEqual(at(20), ["⧉ source"], `${copyButtonStyle}: render width ${fittedAt(20)} fits 20 columns, where source alone stays`);
		cleanupFn();
		cleanupFn = undefined;

		const off = await drawnReply({ copyButtonStyle, copyButtons: false });
		assert.deepEqual(shownLabels(off.comp, 100, hover), [], `${copyButtonStyle}: copyButtons:false draws no button`);
		assert.ok(!off.comp.render(100).map(onScreen).join("\n").includes("⧉"), `${copyButtonStyle}: copyButtons:false draws no ⧉ marker`);
		cleanupFn();
		cleanupFn = undefined;

		const remote = await drawnReply({ copyButtonStyle }, recordingDesktop(false));
		assert.deepEqual(shownLabels(remote.comp, 100, hover), ["⧉ source"], `${copyButtonStyle}: a desktop without pictures keeps [ ⧉ source ] alone`);
		copiedTexts.length = 0;
		press(remote.comp, 100, "⧉ source", hover);
		assert.equal(copiedTexts.length, 1, `${copyButtonStyle}: source still copies without pictures`);
		assert.deepEqual(remote.h.notifications.at(-1), { text: "Copied", level: "info" }, `${copyButtonStyle}: source toasts Copied without pictures`);
		cleanupFn();
		cleanupFn = undefined;
	}
});

test("25. the system desktop sends the PNG to osascript on stdin, builds the Quick Look helper once without waiting, and opens a panel on every press", async () => {
	const { systemDesktop } = await import("../extensions/prism/desktop.ts");
	const dir = mkdtempSync(join(tmpdir(), "prism-desktop-"));
	const log = join(dir, "ql.log");
	const opens = () => {
		try {
			return readFileSync(log, "utf8").split("\n").filter((line) => line.startsWith("open "));
		} catch {
			return [];
		}
	};
	const opened = (n: number) => {
		const [, pid, file, ...argv] = opens()[n]!.split(" ") as [string, string, string, ...string[]];
		return { pid, file, argv };
	};
	const builds = (name: string) => {
		try {
			return readFileSync(join(dir, `${name}.log`), "utf8").split("\n").filter(Boolean);
		} catch {
			return [];
		}
	};
	const alive = (pid: number) => {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	};
	cleanupFn = () => {
		for (const line of opens()) {
			try {
				process.kill(Number(line.split(" ")[1]));
			} catch {}
		}
		rmSync(dir, { recursive: true, force: true });
	};
	const fakeBin = (name: string, body: string) => {
		const file = join(dir, name);
		writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
		return file;
	};
	const fakePanel = (name: string, fileArg: string) =>
		fakeBin(
			name,
			[
				`cp "${fileArg}" "${dir}/seen-$$.png"`,
				`echo "open $$ ${fileArg} $0 $*" >> "${log}"`,
				`exec sleep 5`,
			].join("\n"),
		);
	const fakeSwiftc = (name: string, helper: string, seconds = 0) =>
		fakeBin(name, `echo "$*" >> "${dir}/${name}.log"\nsleep ${seconds}\ncp "${helper}" "$4"`);
	const recorder = () => {
		const reports: [string, string][] = [];
		return {
			reports,
			report: (text: string, level: string) => void reports.push([text, level]),
			at: (level: string) => reports.filter(([, l]) => l === level).map(([text]) => text),
		};
	};
	const building = "Building the Quick Look helper (first use, about 10 s)";
	const osascript = fakeBin("osascript", `cat > "${dir}/stdin.bin"\nprintf '%s\\n' "$@" > "${dir}/osascript.args"`);
	const qlmanage = fakePanel("qlmanage", "$2");
	const helperSource = join(dir, "quicklook.swift");
	writeFileSync(helperSource, "// helper v1\n");
	const helperDir = join(dir, "helpers");
	const previews = join(dir, "previews");
	const options = { pictures: true, osascript, qlmanage, swiftc: fakeSwiftc("swiftc", fakePanel("helper", "$1"), 1), helperSource, helperDir, dir: previews };
	const desktop = systemDesktop(options);
	const first = pngOf(320, 280);
	const second = pngOf(200, 100);

	assert.equal(desktop.copyPng(first), null, "copyPng reports success when osascript exits 0");
	assert.deepEqual(readFileSync(join(dir, "stdin.bin")), first, "osascript receives the PNG bytes on stdin");
	const args = readFileSync(join(dir, "osascript.args"), "utf8").split("\n");
	assert.deepEqual(args.slice(0, 3), ["-l", "JavaScript", "-e"], "osascript runs the JavaScript for Automation script");
	assert.ok(args.slice(3).join("\n").includes("NSPasteboardTypePNG"), "the script writes the PNG type");
	const broken = systemDesktop({ pictures: true, osascript: fakeBin("osascript-fails", `cat > /dev/null\necho 'no pasteboard' >&2\nexit 1`) });
	assert.equal(broken.copyPng(first), "no pasteboard", "copyPng returns what osascript printed when it exits 1");

	const session = recorder();
	const before = performance.now();
	desktop.previewPng(first, session.report);
	assert.ok(performance.now() - before < 500, "previewPng returns while the 1 s helper build runs");
	assert.deepEqual(session.reports, [[building, "info"]], "the first preview says the helper is building");
	await until(() => opens().length === 1);
	assert.equal(builds("swiftc").length, 1, "the first preview runs swiftc once");
	const [optimize, source, outputFlag, output] = builds("swiftc")[0]!.split(" ");
	assert.deepEqual([optimize, source, outputFlag], ["-O", helperSource, "-o"], "swiftc compiles the helper source with -O");
	assert.ok(output!.startsWith(helperDir), "swiftc writes into the helper directory");
	const { pid: firstPid, file: firstFile, argv: firstArgv } = opened(0);
	const helper = firstArgv[0]!;
	assert.ok(helper.startsWith(join(helperDir, "quicklook-")), "the panel is the helper binary swiftc built");
	assert.deepEqual(firstArgv.slice(1), [firstFile], "the helper gets the PNG path as its only argument");
	assert.ok(alive(Number(firstPid)), "the fake panel is still open after the build finished");
	assert.ok(firstFile.startsWith(previews) && firstFile.endsWith(".png"), "Quick Look gets a .png under the preview directory");
	assert.match(basename(firstFile), /^diagram-[0-9a-f]{12}\.png$/, "the title bar shows a name that fits any diagram source");
	assert.deepEqual(readFileSync(join(dir, `seen-${firstPid}.png`)), first, "the file Quick Look opened holds the PNG");

	desktop.previewPng(first, session.report);
	await until(() => opens().length === 2);
	const { pid: repeatPid, argv: repeatArgv } = opened(1);
	assert.deepEqual(repeatArgv, [helper, firstFile], "a repeat on the same PNG opens another panel on the same file");

	desktop.previewPng(second, session.report);
	await until(() => opens().length === 3);
	const { pid: secondPid, file: secondFile, argv: secondArgv } = opened(2);
	assert.equal(builds("swiftc").length, 1, "a second PNG reuses the built helper");
	assert.deepEqual(secondArgv, [helper, secondFile], "the second panel is the same helper on the second file");
	assert.notEqual(secondFile, firstFile, "the different PNG opens its own file");
	assert.deepEqual(readFileSync(join(dir, `seen-${secondPid}.png`)), second, "the second panel shows the second PNG");
	assert.ok([firstPid, repeatPid, secondPid].every((pid) => alive(Number(pid))), "a new panel closes none of the open ones");
	assert.deepEqual(session.reports, [[building, "info"]], "a ready helper reports nothing more");

	const nextSession = recorder();
	systemDesktop(options).previewPng(first, nextSession.report);
	await until(() => opens().length === 4);
	assert.equal(builds("swiftc").length, 1, "a new desktop reuses the helper already in the helper directory");
	assert.equal(opened(3).argv[0], helper, "the new desktop opens the same helper");
	assert.deepEqual(nextSession.reports, [], "a reused helper reports nothing");

	writeFileSync(helperSource, "// helper v2\n");
	systemDesktop(options).previewPng(second, recorder().report);
	await until(() => opens().length === 5);
	assert.equal(builds("swiftc").length, 2, "a changed helper source builds again");
	assert.notEqual(opened(4).argv[0], helper, "the changed source gets its own helper binary");

	const exits = recorder();
	const exitsAtOnce = { ...options, swiftc: fakeSwiftc("swiftc-exits", fakeBin("helper-exits", "exit 1")), helperDir: join(dir, "helpers-exits") };
	systemDesktop(exitsAtOnce).previewPng(first, exits.report);
	await until(() => exits.at("error").length === 1);
	assert.deepEqual(exits.at("error"), ["Quick Look failed"], "a helper that exits 1 at once reports a failure");

	const fallback = recorder();
	const noHelper = systemDesktop({ ...options, swiftc: fakeBin("swiftc-fails", `echo "error: no SDK found" >&2\nexit 1`), helperDir: join(dir, "helpers-fails") });
	noHelper.previewPng(first, fallback.report);
	await until(() => opens().length === 6);
	assert.deepEqual(opened(5).argv, [qlmanage, "-p", opened(5).file], "a failed build falls back to qlmanage -p on the file");
	noHelper.previewPng(second, fallback.report);
	await until(() => opens().length === 7);
	assert.deepEqual(opened(6).argv, [qlmanage, "-p", opened(6).file], "the next press goes straight to qlmanage");
	assert.deepEqual(fallback.at("warning"), ["Quick Look helper could not be built (error: no SDK found), using qlmanage"], "two presses after a failed build warn once, with the reason");
	assert.deepEqual(fallback.at("error"), [], "the qlmanage fallback reports no failure");

	const missing = recorder();
	const nothing = { ...options, swiftc: join(dir, "absent-swiftc"), qlmanage: join(dir, "absent-qlmanage"), helperDir: join(dir, "helpers-missing") };
	systemDesktop(nothing).previewPng(first, missing.report);
	await until(() => missing.at("error").length === 1);
	assert.deepEqual(missing.at("warning"), ["Quick Look helper could not be built (swiftc not found), using qlmanage"], "a missing swiftc warns and falls back");
	assert.deepEqual(missing.at("error"), ["Quick Look is unavailable"], "a missing qlmanage after that reports a failure");
	assert.equal(systemDesktop({ pictures: false }).pictures, false, "pictures follows the option");
});

test("26. a plantuml image stays drawn while its top rows are scrolled above pi's fullscreen viewport", async () => {
	const terminal = plantumlTerminal({ images: "kitty" });
	const h = createHarness();
	cleanupFn = () => {
		terminal.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	const comp = reply(diagram("scroll", manyMessages));
	comp.render(100);
	await plantumlJobs.idle();
	const lines = comp.render(100);
	const at = lines.findIndex((line) => line.includes(KITTY_IMAGE));
	assert.ok(at >= 0, "the diagram is drawn as an image");
	const rows = Number(/[,;]r=(\d+)/.exec(lines[at]!)?.[1]);
	assert.ok(rows > 2, `the image spans ${rows} rows`);

	const body = new Container();
	body.addChild(new Text("Before the reply", 0, 0));
	body.addChild(comp);
	for (let i = 0; i < rows + 10; i++) body.addChild(new Text(`After the reply ${i}`, 0, 0));
	const view = new ScrollView(body);
	const height = rows + 2;
	renderLayoutFrame(view, 100, height, () => {});
	const scrolledAway = Array.from({ length: rows - 1 }, (_, i) => i + 1);
	const topRows = scrolledAway.map((k) => {
		view.scrollTo(1 + at + k);
		const top = renderLayoutFrame(view, 100, height, () => {}).lines[0];
		return top.includes(KITTY_IMAGE) ? `${k} away: image, ${/[,;]r=(\d+)/.exec(top)?.[1]} rows` : `${k} away: ${JSON.stringify(stripAnsi(top))}`;
	});
	assert.deepEqual(topRows, scrolledAway.map((k) => `${k} away: image, ${rows - k} rows`), "the top row draws the image cropped to the rows still in view");
});

test("27. background jobs keep every caller's invalidator, queue behind the cap, wake after the next job starts, and stay awaitable", async () => {
	const wake = (invalidated: string[], name: string) => ({ requestRender: () => invalidated.push(`${name}:render`), onInvalidate: () => invalidated.push(`${name}:invalidate`) });
	const gate = () => {
		let open!: () => void;
		const opened = new Promise<void>((done) => (open = done));
		return { open, opened };
	};

	const jobs = background<string>({ limit: 2, concurrency: 1, crashed: "crashed" });
	const events: string[] = [];
	const first = gate();
	const run = (name: string, gate?: Promise<void>) => async () => {
		events.push(`${name}:start`);
		await gate;
		events.push(`${name}:end`);
		return name;
	};

	assert.equal(jobs.get("a", run("a", first.opened), wake(events, "a1")), undefined);
	assert.equal(jobs.get("a", run("a"), wake(events, "a2")), undefined, "a second caller joins the pending key");
	assert.equal(jobs.get("b", run("b"), wake(events, "b")), undefined);
	assert.deepEqual([...jobs.pending.keys()], ["a", "b"]);
	assert.equal(jobs.pending.get("a")!.size, 2, "both callers' invalidators are kept");
	assert.deepEqual(events, ["a:start"], "b waits behind the cap");

	first.open();
	await jobs.idle();
	assert.deepEqual(events, ["a:start", "a:end", "b:start", "a1:invalidate", "a2:invalidate", "a1:render", "b:end", "b:invalidate", "b:render"]);
	assert.equal(jobs.get("a", run("a"), wake(events, "late")), "a");
	assert.deepEqual([...jobs.cache.keys()], ["b", "a"], "a hit moves the key to the young end");

	jobs.put("c", "c");
	assert.deepEqual([...jobs.cache.keys()], ["a", "c"], "the oldest entry leaves past the limit");

	const crashing = background<string>({ limit: 2, concurrency: 1, crashed: "crashed" });
	crashing.get("x", () => Promise.reject(new Error("boom")), wake([], "x"));
	await crashing.idle();
	assert.equal(crashing.cache.get("x"), "crashed", "a rejected job settles as the crash value");

	const throwing = background<string>({ limit: 2, concurrency: 1, crashed: "crashed" });
	const woken: string[] = [];
	throwing.get("p", async () => "p", { requestRender: () => woken.push("p"), onInvalidate: () => { throw new Error("bad wake"); } });
	throwing.get("q", async () => "q", wake(woken, "q"));
	await throwing.idle();
	await new Promise((done) => setTimeout(done, 10));
	assert.deepEqual([throwing.cache.get("p"), throwing.cache.get("q"), throwing.pending.size], ["p", "q", 0], "a wake that throws strands neither the queue nor idle()");

	const reset = background<string>({ limit: 2, concurrency: 1, crashed: "crashed" });
	const old = gate();
	events.length = 0;
	reset.get("k", run("old", old.opened), wake(events, "old"));
	assert.deepEqual(events, ["old:start"]);
	reset.clear();
	const fresh = gate();
	assert.equal(reset.get("k", run("fresh", fresh.opened), wake(events, "fresh")), undefined);
	old.open();
	await new Promise((done) => setTimeout(done, 10));
	assert.deepEqual([[...reset.cache.keys()], [...reset.pending.keys()], events], [[], ["k"], ["old:start", "old:end", "fresh:start"]], "a job running at clear() stores nothing, wakes no one and leaves the newer pending entry");
	fresh.open();
	await reset.idle();
	assert.equal(reset.cache.get("k"), "fresh", "the newer job still settles");

	const stuck = background<string>({ limit: 2, concurrency: 1, crashed: "crashed" });
	const never = gate();
	stuck.get("s", run("s", never.opened), wake([], "s"));
	await assert.rejects(stuck.idle(20), /still pending/);
	const waiting = stuck.idle();
	stuck.clear();
	await waiting;
	assert.equal(stuck.pending.size, 0, "clear() resolves the waiters");
	never.open();
});

const hugePng = (width: number, height: number, bytes: number) => {
	const png = Buffer.alloc(bytes);
	pngOf(1, 1).copy(png, 0, 0, 33);
	png.writeUInt32BE(width, 16);
	png.writeUInt32BE(height, 20);
	return png;
};

function mermanFixture(options: { images?: "kitty" | "iterm2" | null; installed?: boolean; png?: Buffer } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "prism-fake-merman-"));
	const bin = join(dir, "bin");
	mkdirSync(bin);
	writeFileSync(join(dir, "fixture.png"), options.png ?? pngOf(320, 280));
	writeFileSync(join(dir, "big.png"), hugePng(2000, 1500, 2.5 * 1024 * 1024));
	writeFileSync(join(dir, "huge.png"), hugePng(8141, 4530, 3 * 1024 * 1024 + 1));
	copyFileSync(join(dirname(fileURLToPath(import.meta.url)), "fake-merman.sh"), join(bin, "merman-cli"));
	chmodSync(join(bin, "merman-cli"), 0o755);
	const saved = Object.fromEntries(["PATH", "TMPDIR", "FAKE_MERMAN_DIR", "SSH_CONNECTION", "SSH_TTY"].map((k) => [k, process.env[k]]));
	delete process.env.SSH_CONNECTION;
	delete process.env.SSH_TTY;
	process.env.FAKE_MERMAN_DIR = dir;
	process.env.TMPDIR = dir;
	process.env.PATH = options.installed === false ? join(dir, "empty") : `${bin}:${saved.PATH}`;
	setCapabilities({ images: options.images === undefined ? "kitty" : options.images, trueColor: true, hyperlinks: false });
	mermanJobs.clear();
	const read = (name: string) => {
		try {
			return readFileSync(join(dir, name), "utf8");
		} catch {
			return "";
		}
	};
	return {
		dir,
		calls: () => read("calls.log").trim().split("\n").filter(Boolean),
		runs: () => read("calls.log").split("\n").filter((line) => line === "start").length,
		stdin: () => read("last-stdin.txt"),
		args: () => read("last-args.txt").trim(),
		restore: () => {
			for (const [name, value] of Object.entries(saved)) {
				if (value === undefined) delete process.env[name];
				else process.env[name] = value;
			}
			resetCapabilitiesCache();
			mermanJobs.clear();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

const mermaidFence = (source: string) => ["```mermaid", source, "```"].join("\n");
const fanOut = (id: (n: number) => string = (n) => `c${n}`) =>
	mermaidFence(["flowchart TD", "  root[Root]", ...[0, 1, 2, 3].map((n) => `  root --> ${id(n)}[Child number ${n}]`)].join("\n"));
const plainText = (comp: any, width = 100) => stripAnsi(comp.render(width).join("\n"));
const drawnImages = (comp: any, width = 100) => shownLabels(comp, width, false).filter((label) => label === "⧉ preview").length;

test("28. a timeline the text renderer cannot draw shows a pending note, then the merman picture with source, image and preview", async () => {
	const png = pngOf(320, 280);
	const fake = mermanFixture({ png });
	const h = createHarness();
	cleanupFn = () => {
		fake.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	const source = "timeline\n  2020 : <i>start</i>\n  2021 : end";
	const comp = reply(mermaidFence(source));
	const first = plainText(comp);
	assert.ok(first.includes("drawing with merman…"), "the first frame says merman is drawing");
	assert.ok(!first.includes("timeline diagrams draw as source"), "the pending note replaces the give-up note");
	assert.ok(first.includes("2020 : <i>start</i>"), "the source stays visible meanwhile");
	assert.equal(mermanJobs.pending.size, 1);

	await mermanJobs.idle();
	assert.ok(h.renders.screen > 0, "the settled job asks pi to paint");
	const drawn = comp.render(100).join("\n");
	assert.ok(drawn.includes(KITTY_IMAGE), "the next frame draws the PNG");
	assert.ok(!stripAnsi(drawn).includes("2020 :"), "the source is gone");
	assert.deepEqual(shownLabels(comp, 100, false), ["⧉ source", "⧉ image", "⧉ preview"]);

	copiedTexts.length = 0;
	press(comp, 100, "⧉ source", false);
	assert.deepEqual(copiedTexts, [source], "source copies the mermaid text as written, tags included");
	press(comp, 100, "⧉ image", false);
	assert.deepEqual(h.desktop.pngs, [png], "image copies the PNG merman drew");
	press(comp, 100, "⧉ preview", false);
	assert.deepEqual(h.desktop.previews, [png], "preview opens the PNG merman drew");

	assert.equal(fake.stdin(), "timeline\n  2020 : start\n  2021 : end\n", "merman gets the source without inline tags");
	comp.invalidate();
	comp.render(100);
	assert.equal(fake.runs(), 1, "later frames hit the cache");
});

test("29. merman never runs for art that fits, an open fence, a terminal without images, or the markdown transformer", async () => {
	const restoreHost = clipboardHost("linux");
	const fake = mermanFixture();
	const h = createHarness();
	cleanupFn = () => {
		fake.restore();
		h.cleanup();
		restoreHost();
	};
	await h.emit("session_start");

	const art = reply(mermaidFence("flowchart TD\n  A --> B"));
	assert.ok(plainText(art).includes("│"), "a flowchart that fits is drawn as art");
	assert.deepEqual(shownLabels(art, 100, false), ["⧉ source", "⧉ art"]);

	const open = reply("```mermaid\ntimeline\n  2020 : a");
	assert.ok(!plainText(open).includes("merman") && !plainText(open).includes("draw as source"), "an open fence is plain source with no note");

	const transformed = h.markdownTransformers[0]!(mermaidFence("timeline\n  2020 : a"), { messageType: "assistant", isStreaming: false, availableWidth: 80 });
	assert.ok(transformed.includes("timeline diagrams draw as source for now"), "the transformer keeps the give-up note");
	assert.ok(!transformed.includes("merman"), "the transformer never mentions merman");

	assert.equal(mermanJobs.pending.size, 0);
	assert.deepEqual(fake.calls(), [], "no run started");

	setCapabilities({ images: null, trueColor: true, hyperlinks: false });
	const text = reply(mermaidFence("timeline\n  2020 : a"));
	assert.ok(plainText(text).includes("timeline diagrams draw as source for now"), "a terminal without images keeps the give-up note");
	assert.equal(mermanJobs.pending.size, 0);
	assert.deepEqual(fake.calls(), [], "no run started without images");
});

test("30. a too-wide fan-out is a picture at 80 columns and box art at 130, from one run", async () => {
	const restoreHost = clipboardHost("linux");
	const fake = mermanFixture();
	const h = createHarness();
	cleanupFn = () => {
		fake.restore();
		h.cleanup();
		restoreHost();
	};
	await h.emit("session_start");

	const comp = reply(fanOut());
	assert.ok(plainText(comp, fittedAt(80)).includes("drawing with merman…"), "80 columns are too few for the 81-column art");
	await mermanJobs.idle();
	assert.equal(drawnImages(comp, fittedAt(80)), 1, "80 columns show the picture");

	assert.ok(plainText(comp, fittedAt(130)).includes("Child number 3"), "130 columns show the text art");
	assert.deepEqual(shownLabels(comp, fittedAt(130), false), ["⧉ source", "⧉ art"], "the art has its own buttons");
	assert.equal(drawnImages(comp, fittedAt(130)), 0);

	assert.equal(drawnImages(comp, fittedAt(80)), 1, "narrowing again shows the picture at once");
	assert.equal(fake.runs(), 1, "one run served all three widths");
});

test("31. every way merman cannot draw keeps the text note and the source, and a missing merman changes nothing", async () => {
	const fake = mermanFixture();
	const h = createHarness();
	cleanupFn = () => {
		fake.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	const noteOf = async (source: string) => {
		const comp = reply(mermaidFence(source));
		comp.render(100);
		await mermanJobs.idle();
		const plain = plainText(comp);
		return { plain, images: drawnImages(comp) };
	};
	const timeline = (marker: string) => `timeline\n  2020 : ${marker}`;
	const give = "timeline diagrams draw as source for now";

	for (const marker of ["fake:fail", "fake:huge"]) {
		const result = await noteOf(timeline(marker));
		assert.ok(result.plain.includes(give), `${marker}: main's note`);
		assert.ok(!result.plain.includes("merman") && result.plain.includes(`2020 : ${marker}`), `${marker}: no merman suffix, and the code block shows the source`);
		assert.equal(result.images, 0, `${marker}: no picture`);
	}

	const before = fake.runs();
	const long = await noteOf(timeline("x".repeat(100000)));
	assert.ok(long.plain.includes(give) && !long.plain.includes("merman"), "a source over 100000 characters keeps main's note and is not sent");
	assert.equal(fake.runs(), before, "and starts no run");
	const large = await noteOf(timeline("x".repeat(99000)));
	assert.equal(large.images, 1, "a source under the cap draws");
	assert.equal(fake.runs(), before + 1);

	fake.restore();
	const absent = mermanFixture({ installed: false });
	cleanupFn = () => {
		absent.restore();
		h.cleanup();
	};
	const comp = reply(mermaidFence(timeline("absent")));
	const frame = plainText(comp);
	assert.ok(frame.includes(give), "without merman the note is today's");
	assert.ok(!frame.includes("merman"), "and never mentions merman");
	assert.equal(mermanJobs.pending.size, 0);
	assert.deepEqual(absent.calls(), []);
});

test("32. a merman render past 5 s is killed and noted", async () => {
	const fake = mermanFixture();
	const h = createHarness();
	cleanupFn = () => {
		fake.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	const comp = reply(mermaidFence("timeline\n  2020 : fake:sleep"));
	comp.render(100);
	await mermanJobs.idle(8000);
	const frame = plainText(comp);
	assert.ok(frame.includes("timeline diagrams draw as source for now") && !frame.includes("merman"), "a timeout leaves main's note");
});

test("33. five slow blocks run one at a time and all end as pictures", async () => {
	const fake = mermanFixture();
	const h = createHarness();
	cleanupFn = () => {
		fake.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	const comp = reply([0, 1, 2, 3, 4].map((n) => mermaidFence(`timeline\n  2020 : fake:slow ${n}`)).join("\n\n"));
	comp.render(100);
	assert.equal(mermanJobs.pending.size, 5);
	await mermanJobs.idle();
	assert.equal(drawnImages(comp), 5);
	let open = 0;
	let most = 0;
	for (const line of fake.calls()) most = Math.max(most, (open += line === "start" ? 1 : -1));
	assert.equal(most, 1, "no two runs overlap");
	assert.equal(fake.calls().length, 10, "five runs started and ended");
});

test("34. a reply rebuilt while merman draws shows the picture once it settles, with no further nudge", async () => {
	const fake = mermanFixture();
	const h = createHarness();
	cleanupFn = () => {
		fake.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	const message = { role: "assistant", content: [{ type: "text", text: [mermaidFence("timeline\n  2020 : fake:slow"), "", "After"].join("\n") }], timestamp: 1000 } as any;
	const comp = new AssistantMessageComponent(message);
	comp.render(100);
	assert.equal(mermanJobs.pending.size, 1);
	comp.updateContent(message);
	assert.ok(plainText(comp).includes("drawing with merman…"), "the rebuilt frame still shows the pending note");
	assert.equal(mermanJobs.pending.size, 1, "the rebuild joins the job");
	await mermanJobs.idle();
	assert.ok(comp.render(100).join("\n").includes(KITTY_IMAGE), "the next frame shows the picture");
	assert.equal(fake.runs(), 1, "the rebuild did not start a second run");
});

test("35. headerWord reads the diagram word past front matter, comments and blank lines", () => {
	const words: [string, string][] = [
		["flowchart TD\n  A --> B", "flowchart"],
		["  \n%% note\n%%{init: {}}%%\ntimeline\n  2020 : a", "timeline"],
		["---\ntitle: T\n---\nmindmap\n  root", "mindmap"],
		["---\r\ntitle: T\r\n---\r\ngantt\r\n  x", "gantt"],
		["graph TD;\n  A-->B;", "graph"],
		["", ""],
	];
	for (const [source, word] of words) assert.equal(headerWord(source), word, JSON.stringify(source));
});

test("36. fallback shows the picture, the pending note, or today's note, for every verdict", () => {
	const verdicts = [
		{ fits: false, why: "unsupported", word: "timeline" },
		{ fits: false, why: "too-wide", narrowest: 95, columns: 78 },
		{ fits: false, why: "no-art" },
	] as const;
	const notes = ["timeline diagrams draw as source for now", "diagram is 95 cols, terminal is 78", "diagram failed to render"];
	assert.deepEqual(verdicts.map(textNote), notes, "textNote keeps main's strings");
	const png = { state: "drawn", png: "AAAA", width: 3, height: 4 } as const;
	verdicts.forEach((verdict, i) => {
		assert.deepEqual(fallback(verdict, png), png, "a picture wins");
		assert.deepEqual(fallback(verdict, { state: "pending" }), { note: "drawing with merman…" });
		assert.deepEqual(fallback(verdict, { state: "declined" }), { note: notes[i] });
	});
	const style = resolveStyle({});
	const fits = textVerdict("flowchart TD\n  A --> B", style, 80, 0);
	assert.ok(fits.fits, "textVerdict returns the art when it fits");
	assert.deepEqual(textVerdict("timeline\n  2020 : a", style, 80, 0), { fits: false, why: "unsupported", word: "timeline" });
	assert.deepEqual(textVerdict(fanOut().split("\n").slice(1, -1).join("\n"), style, 80, 0), { fits: false, why: "too-wide", narrowest: 81, columns: 80 });
	assert.deepEqual(textVerdict("graph TD;\n  A-->B;", style, 80, 0), { fits: false, why: "no-art" }, "valid syntax the text parser lacks gives 'no-art'");
});

const hasMerman = (() => {
	try {
		execFileSync("which", ["merman-cli"]);
		return true;
	} catch {
		return false;
	}
})();
const skipWithoutMerman = hasMerman ? false : "merman-cli is not on PATH";

const drawnBy = async (source: string) => {
	const wake = { requestRender: () => {} };
	assert.equal(mermanPicture(source, wake).state, "pending");
	await mermanJobs.idle();
	return mermanPicture(source, wake);
};

test("37. real merman declines an unknown header word and a broken flowchart, and draws a timeline and a hyphenated flowchart", { skip: skipWithoutMerman }, async () => {
	mermanJobs.clear();
	assert.deepEqual(await drawnBy("notADiagram\n  foo"), { state: "declined" });
	assert.deepEqual(await drawnBy("flowchart TD\n  A -->"), { state: "declined" });
	assert.equal((await drawnBy("timeline\n  2020 : a")).state, "drawn");
	assert.equal((await drawnBy("flowchart TD\n  api-gateway --> auth-service")).state, "drawn", "a hyphenated id is read whole");
	mermanJobs.clear();
});

test("38. a merman picture between 2 and 3 MiB reaches the terminal and the clipboard whole, and one over 3 MiB keeps the old note", async () => {
	const fake = mermanFixture();
	const h = createHarness();
	cleanupFn = () => {
		fake.restore();
		h.cleanup();
	};
	await h.emit("session_start");
	const png = readFileSync(join(fake.dir, "big.png"));
	assert.ok(png.length > 2 * 1024 * 1024 && png.length < 3 * 1024 * 1024);

	const comp = reply(mermaidFence("timeline\n  2020 : fake:big"));
	comp.render(100);
	await mermanJobs.idle();
	const drawn = comp.render(100).join("\n");
	const sent = [...drawn.matchAll(/\x1b_G[^;\x1b]*;([^\x1b]*)\x1b\\/g)].map((m) => m[1]).join("");
	assert.equal(sent, png.toString("base64"), "every chunk of the picture is sent to the terminal");
	assert.ok(!plainText(comp).includes("draw as source"), "no note replaces the picture");
	press(comp, 100, "⧉ image", false);
	assert.deepEqual(h.desktop.pngs, [png], "image copies all of the PNG");

	const over = reply(mermaidFence("timeline\n  2020 : fake:huge"));
	over.render(100);
	await mermanJobs.idle();
	assert.ok(plainText(over).includes("timeline diagrams draw as source for now"), "a picture over 3 MiB keeps main's note");
	assert.equal(drawnImages(over), 0);
});

test("39. merman:false or an SSH session keeps every block the text renderer cannot draw as source and never starts merman", async () => {
	assert.equal(resolveStyle({}).merman, true);
	assert.equal(resolveStyle({ merman: false }).merman, false);

	const cases: [string, Record<string, unknown>, Record<string, string>][] = [
		["merman:false", { merman: false }, {}],
		["SSH_CONNECTION", {}, { SSH_CONNECTION: "10.0.0.1 22 10.0.0.2 22" }],
		["SSH_TTY", {}, { SSH_TTY: "/dev/pts/0" }],
	];
	for (const [name, config, env] of cases) {
		const fake = mermanFixture();
		Object.assign(process.env, env);
		const h = createHarness(config);
		try {
			await h.emit("session_start");
			const comp = reply([mermaidFence("timeline\n  2020 : off"), fanOut((n) => `c${n}`)].join("\n\n"));
			const plain = plainText(comp, fittedAt(80));
			assert.ok(plain.includes("timeline diagrams draw as source for now"), `${name}: the timeline keeps main's note`);
			assert.ok(plain.includes("diagram is 81 cols, terminal is 80"), `${name}: the wide flowchart keeps main's note`);
			assert.ok(!plain.includes("merman"), `${name}: nothing mentions merman`);
			await sleep(100);
			assert.equal(mermanJobs.pending.size, 0, name);
			assert.deepEqual(fake.calls(), [], `${name}: merman is never called`);
		} finally {
			fake.restore();
			h.cleanup();
		}
	}
});

test("40. the merman hint reaches the model only when mermaid, merman, images, the command and a local session are all there", async () => {
	const startEvent = () => ({
		type: "before_agent_start",
		messageType: "user",
		prompt: "x",
		systemPrompt: "",
		systemPromptOptions: { guidelines: [] as string[] },
	});
	const hinted = async (config: Record<string, unknown>, fixture: Parameters<typeof mermanFixture>[0] = {}, env: Record<string, string> = {}) => {
		const fake = mermanFixture(fixture);
		Object.assign(process.env, env);
		const h = createHarness(config);
		try {
			await h.emit("session_start");
			const event = startEvent();
			await h.emit("before_agent_start", event);
			return event.systemPromptOptions.guidelines.some((g) => g.includes("sankey-beta"));
		} finally {
			fake.restore();
			h.cleanup();
		}
	};
	assert.equal(await hinted({}), true, "every gate holds");
	assert.equal(await hinted({ diagramHints: false }), false, "diagramHints off");
	assert.equal(await hinted({ mermaid: false }), false, "mermaid off");
	assert.equal(await hinted({ merman: false }), false, "merman off");
	assert.equal(await hinted({}, { images: null }), false, "the terminal shows no images");
	assert.equal(await hinted({}, { installed: false }), false, "merman is not installed");
	assert.equal(await hinted({}, {}, { SSH_CONNECTION: "10.0.0.1 22 10.0.0.2 22" }), false, "over SSH");
	assert.equal(await hinted({}, {}, { SSH_TTY: "/dev/pts/0" }), false, "over SSH on a tty");
	assert.ok(MERMAN_HINT.includes("```mermaid"), "the hint names the fence");
});

const demoKinds = () =>
	parse(showcaseText(), { numbers: true, paths: true })
		.filter((block) => block.kind === "code" && block.lang === "mermaid")
		.map((block) => (block as { lines: string[] }).lines.join("\n"));

test("41. /prism demo shows a sample of every kind the merman hint names, and each is small", () => {
	const samples = demoKinds();
	for (const kind of MERMAN_KINDS) {
		const own = samples.filter((source) => headerWord(source) === kind);
		assert.equal(own.length, 1, `one ${kind} sample`);
		assert.ok(own[0]!.split("\n").length <= 12, `${kind} is small`);
	}
});

test("42. real merman draws every /prism demo sample as a picture", { skip: skipWithoutMerman }, async () => {
	mermanJobs.clear();
	const wake = { requestRender: () => {} };
	for (const source of demoKinds().filter((source) => MERMAN_KINDS.includes(headerWord(source) as never))) {
		assert.equal(mermanPicture(source, wake).state, "pending", headerWord(source));
		await mermanJobs.idle();
		assert.equal(mermanPicture(source, wake).state, "drawn", `${headerWord(source)} draws`);
	}
	mermanJobs.clear();
});

const pngWidth = (png: string) => Buffer.from(png, "base64").readUInt32BE(16);

test("43. a picture is reported at half its pixels, so it fills the columns a 1x image would", async () => {
	const fake = mermanFixture({ png: pngOf(320, 280) });
	cleanupFn = fake.restore;

	const picture = await drawnBy("timeline\n  2020 : start");
	assert.ok(picture.state === "drawn");
	assert.deepEqual({ width: picture.width, height: picture.height }, { width: 160, height: 140 });
});

test("44. real merman draws every /prism demo sample at twice the width it reports", { skip: skipWithoutMerman }, async () => {
	mermanJobs.clear();
	for (const source of demoKinds().filter((source) => MERMAN_KINDS.includes(headerWord(source) as never))) {
		const picture = await drawnBy(source);
		assert.ok(picture.state === "drawn", headerWord(source));
		assert.equal(pngWidth(picture.png), picture.width * 2, `${headerWord(source)}: the PNG is 2x the reported width`);
	}
	mermanJobs.clear();
});

test("45. real merman draws a hyphenated flowchart the text renderer cannot fit", { skip: skipWithoutMerman }, async () => {
	mermanJobs.clear();
	const hyphenated = fanOut((n) => `child-${n}`).split("\n").slice(1, -1).join("\n");
	const style = resolveStyle({});
	assert.equal(textVerdict(hyphenated, style, 80, 0).fits, false, "80 columns are too few for the text art");
	assert.equal((await drawnBy(hyphenated)).state, "drawn");
	mermanJobs.clear();
});

const C4_RAW = "https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML";
const C4_FORK = "https://raw.githubusercontent.com/gnodux/C4-PlantUML/master/C4_Container.puml";

async function settled(markdown: string) {
	const comp = reply(markdown);
	comp.render(200);
	await plantumlJobs.idle();
	return { plain: stripAnsi(comp.render(200).join("\n")), images: cachedImages().length };
}

test("46. includes of PlantUML's built-in libraries are refused, C4 included", async () => {
	const terminal = plantumlTerminal();
	const h = createHarness();
	cleanupFn = () => {
		terminal.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	for (const name of ["<C4/C4_Container>", "<C4/C4_Context>", "<C4/C4>"]) {
		const { plain, images } = await settled(diagram("builtin", `!include ${name}\nPerson(user, "User")`));
		assert.ok(plain.includes(`plantuml error (line 3): cannot include ${name}`), `${name}: ${plain}`);
		assert.equal(images, 0, `${name} draws nothing`);
		plantumlJobs.clear();
	}
});

test("47. C4-PlantUML URLs and C4 themes are refused with PlantUML's reason", async () => {
	const terminal = plantumlTerminal();
	const h = createHarness();
	cleanupFn = () => {
		terminal.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	const refused = [
		[`!include ${C4_RAW}/master/C4_Container.puml`, `cannot include ${C4_RAW}/master/C4_Container.puml`],
		[`!includeurl ${C4_FORK}`, `cannot include ${C4_FORK}`],
		[`!theme C4_united from ${C4_RAW}/master/themes`, `Cannot load theme C4_united in ${C4_RAW}/master/themes`],
		["!theme C4_united from <C4/themes>", "Cannot load theme C4_united in <C4/themes>"],
	];
	for (const [line, reason] of refused) {
		const { plain, images } = await settled(diagram("refused", line));
		assert.ok(plain.includes(`plantuml error (line 3): ${reason}`), `${line}: ${plain}`);
		assert.equal(images, 0, `${line} draws nothing`);
		plantumlJobs.clear();
	}
});

test("48. an error names the line of the source, with and without @startuml markers and after blank lines", async () => {
	const terminal = plantumlTerminal();
	const h = createHarness();
	cleanupFn = () => {
		terminal.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	const noteOf = async (markdown: string) => (await settled(markdown)).plain;
	assert.ok(
		(await noteOf(diagram("markers", "Alice -> Bob\nfoo bar baz"))).includes("plantuml error (line 4): Syntax Error?"),
		"markers, a comment and one good line put the fault on line 4",
	);
	assert.ok(
		(await noteOf(["```plantuml", "' bare", "Alice -> Bob", "foo bar baz", "```"].join("\n"))).includes("plantuml error (line 3): Syntax Error?"),
		"the @startuml prism adds is not counted",
	);
	assert.ok(
		(await noteOf(["```plantuml", "", "", "@startuml", "Alice -> Bob", "foo bar baz", "@enduml", "```"].join("\n"))).includes("plantuml error (line 5): Syntax Error?"),
		"blank lines before @startuml are counted",
	);
});

// The first pixel of a PNG as RGBA, from its first scanline (the filter byte is skipped; PNG files from the worker are 8-bit RGBA).
const firstPixel = (png: Buffer) => {
	assert.equal(png[24], 8, "8 bits per channel");
	assert.equal(png[25], 6, "RGBA colour type");
	const idat: Buffer[] = [];
	for (let at = 8; at < png.length; ) {
		const length = png.readUInt32BE(at);
		if (png.toString("latin1", at + 4, at + 8) === "IDAT") idat.push(png.subarray(at + 8, at + 8 + length));
		at += length + 12;
	}
	const pixels = inflateSync(Buffer.concat(idat));
	return [...pixels.subarray(1, 5)];
};

test("49. a plantuml picture is opaque, so a dark terminal shows its white background and not black text on black", async () => {
	const terminal = plantumlTerminal();
	const h = createHarness();
	cleanupFn = () => {
		terminal.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	await settled(diagram("opaque"));
	assert.deepEqual(firstPixel(drawnPng()), [255, 255, 255, 255], "the corner is opaque white");
});

test("50. a space between words widens a label, so words are not run together", async () => {
	const terminal = plantumlTerminal();
	const h = createHarness();
	cleanupFn = () => {
		terminal.restore();
		h.cleanup();
	};
	await h.emit("session_start");

	const widthOf = async (label: string) => {
		plantumlJobs.clear();
		await settled(diagram("spacing", `skinparam wrapWidth 300\nrectangle "${label}"`));
		return pngWidth(drawnPng().toString("base64"));
	};
	const joined = await widthOf("wordwordword");
	const spaced = await widthOf("word word word");
	assert.ok(spaced - joined >= 4, `${spaced} px with spaces against ${joined} px without`);
});

const hebrewFigureRows = async (rtl: string, figure: string) => {
	const h = createHarness({ rtl });
	cleanupFn = h.cleanup;
	await h.emit("session_start");
	const comp = new AssistantMessageComponent({
		role: "assistant",
		content: [{ type: "text", text: `\`\`\`figure\n${figure}\n\`\`\`` }],
		timestamp: 1000,
	} as any);
	return comp
		.render(120)
		.map((line) => stripAnsi(line))
		.filter((line) => /[א-ת]/.test(line))
		.join("\n");
};

for (const [rtl, label, note] of [
	["iterm", "⠀Saved Tabs-נעלם מ⠀", "(Recent Sessions-נמצא ב)"],
	["warp", " Saved Tabs-מ םלענ ", "(Recent Sessions-ב אצמנ)"],
] as const) {
	test(`51. a figure label that mixes Hebrew with two English words stays one label on ${rtl}, so the English words and the brackets stay together`, async () => {
		const rows = await hebrewFigureRows(rtl, "רגיל  ──► נעלם מ-Saved Tabs ──► סוף\n          (נמצא ב-Recent Sessions)");
		assert.ok(rows.includes(label), `label in ${JSON.stringify(rows)}`);
		assert.ok(rows.includes(note), `note in ${JSON.stringify(rows)}`);
	});
}

test("52. a single space keeps English words in a Hebrew figure label only between letters, so boxes, members and connectors still split as before", () => {
	for (const [row, held] of [
		["[בנייה] [בדיקה] [Deploy]", "[בנייה]\u2800[בדיקה]\u2800[Deploy]"],
		["│ +שם: String  │", "│\u2800+שם:\u2800String\u2800\u2800│"],
		["עברית -- English words", "עברית --\u2800English\u2800words"],
		["אבג──►Saved Tabs", "Saved►──אבג\u2800Tabs"],
		["│ שלב │──►│ ArgoCD sync │", "│\u2800שלב\u2800│──►│\u2800ArgoCD\u2800sync\u2800│"],
		["A B──►C שלב", "A\u2800B──►C שלב"],
		["Saved Tabs-נעלם  ──►  x", "Saved Tabs-נעלם\u2800\u2800──►\u2800\u2800x"],
		["שלב 1 2 3 4", "שלב 1\u28002\u28003\u28004"],
		["בִּ Foo", "Foo בִּ"],
	] as const) {
		assert.equal(holdRow([...row]).cells.join(""), held, row);
	}
});

test("53. Windows Terminal keeps English words in a Hebrew figure label together too", () => {
	assert.ok(holdEngine([...("רגיל  ──► נעלם מ-Saved Tabs ──► סוף")]).cells.join("").includes("\u200e Saved Tabs-נעלם מ\u200e "));
	assert.equal(holdEngine([...("(נמצא ב-Recent Sessions)")]).cells.join(""), "(Recent Sessions-נמצא ב)");
});

test("54. on iTerm a shell block with a line that opens with Hebrew keeps the shell colors the block has without Hebrew", async () => {
	const colors = async (note: string) => {
		const h = createHarness({ rtl: "iterm" });
		cleanupFn = h.cleanup;
		await h.emit("session_start");
		const comp = new AssistantMessageComponent({
			role: "assistant",
			content: [{ type: "text", text: `\`\`\`bash\n${note}\nnpm install --save "x"\n\`\`\`` }],
			timestamp: 1000,
		} as any);
		const rendered = comp.render(80).join("\n");
		return [note, "npm", "--save", '"x"'].map((word) => {
			const before = rendered.slice(0, rendered.indexOf(word));
			return [...before.matchAll(/\x1b\[([0-9;]*)m/g)].at(-1)?.[1];
		});
	};
	const plain = await colors("# note");
	const held = await colors("# התקנת החבילות");
	assert.equal(new Set(plain).size, 4, `command, flag, string and comment each have a color: ${plain}`);
	assert.deepEqual(held, plain);
});

test("55. editor file links are terminal hyperlinks, and the editors' other links draw as text and target", async () => {
	const prevForce = process.env.FORCE_HYPERLINK;
	process.env.FORCE_HYPERLINK = "1";
	const h = createHarness();
	cleanupFn = () => {
		h.cleanup();
		if (prevForce === undefined) delete process.env.FORCE_HYPERLINK;
		else process.env.FORCE_HYPERLINK = prevForce;
	};
	await h.emit("session_start");

	const reply = [
		"[note](vscode://file/C:/src/notes.md:12)",
		"[insiders](vscode-insiders://file/home/me/app.ts)",
		"[cursor](cursor://file/C:/src/app.ts:3:5)",
		"[windsurf](windsurf://file/home/me/run.py:7)",
		"[zed](zed://file/home/me/main.rs:9:2)",
		"[clone](vscode://vscode.git/clone?url=https://example.com/x.git)",
		"[zclone](zed://git/clone?repo=https://example.com/x.git)",
		"[settings](zed://settings)",
	].join(" ");
	const comp = new AssistantMessageComponent({ role: "assistant", content: [{ type: "text", text: reply }], timestamp: 1000 } as any);
	const rendered = comp.render(400).join("\n");
	const linked = [...rendered.matchAll(/\x1b\]8;;([^\x07\x1b]+)/g)].map((m) => m[1]);
	assert.deepEqual(linked, [
		"vscode://file/C:/src/notes.md:12",
		"vscode-insiders://file/home/me/app.ts",
		"cursor://file/C:/src/app.ts:3:5",
		"windsurf://file/home/me/run.py:7",
		"zed://file/home/me/main.rs:9:2",
	]);
	const plain = stripAnsi(rendered);
	assert.ok(plain.includes("zclone (zed://git/clone?repo=https://example.com/x.git)"), "a zed clone link shows its target");
	assert.ok(plain.includes("settings (zed://settings)"), "a zed settings link shows its target");
});

test("56. the image helper gets each glyph at its terminal column, and the theme colors as RGB, on stdin", () => {
	const text = "┌──┬──┐\n│苹│ab│\n└──┴──┘";
	const mac = imageCommand("macos", text, { foreground: "#cdd6f4", background: "#1e1e2e" });
	assert.deepEqual(mac.argv, ["/usr/bin/osascript", "-l", "JavaScript", "-e", MAC_IMAGE_COPY]);
	const row = (line: string) => [...line].map((glyph, at) => ({ at, text: glyph }));
	assert.deepEqual(JSON.parse(mac.stdin), {
		lines: [
			row("┌──┬──┐"),
			[{ at: 0, text: "│" }, { at: 1, text: "苹" }, { at: 3, text: "│" }, { at: 4, text: "a" }, { at: 5, text: "b" }, { at: 6, text: "│" }],
			row("└──┴──┘"),
		],
		columns: 7,
		foreground: [205, 214, 244],
		background: [30, 30, 46],
	});
	const win = imageCommand("windows", text, { foreground: "ansi256(15)", background: "#fff" }, "C:\\Windows");
	assert.deepEqual(win.argv, ["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-NoProfile", "-NonInteractive", "-STA", "-Command", WIN_IMAGE_COPY]);
	assert.match(win.stdin, /^[\x00-\x7e]*$/, "PowerShell reads ASCII only");
	assert.deepEqual(JSON.parse(win.stdin), { ...JSON.parse(mac.stdin), foreground: [0, 0, 0], background: [255, 255, 255] });
	const colors = (colorSet: { foreground?: string; background?: string }) => JSON.parse(imageCommand("macos", "x", colorSet).stdin);
	assert.deepEqual([colors({ foreground: "cyan" }).foreground, colors({ foreground: "cyan" }).background], [[0, 0, 0], [255, 255, 255]], "a color it cannot read falls back to black on white");
	assert.deepEqual(colors({ foreground: "#c9d4f2" }).foreground, [0, 0, 0], "light text on the white default turns black");
	assert.deepEqual(colors({ foreground: "#202020", background: "#1e1e2e" }).foreground, [255, 255, 255], "dark text on a dark background turns white");
});

test("57. the image helper gets right-to-left cell text in drawn order, each letter in its own column, borders kept in place", () => {
	const lines = JSON.parse(imageCommand("macos", "│ שלום │ 3 │\n│ Pears אגסים │", {}).stdin).lines;
	assert.deepEqual(lines[0], [
		{ at: 0, text: "│" }, { at: 2, text: "ם" }, { at: 3, text: "ו" }, { at: 4, text: "ל" }, { at: 5, text: "ש" },
		{ at: 7, text: "│" }, { at: 9, text: "3" }, { at: 11, text: "│" },
	]);
	assert.equal(lines[1].map((g: { text: string }) => g.text).join(""), "│Pearsםיסגא│");
	assert.deepEqual(lines[1].at(-1), { at: 14, text: "│" });
});

type ClipboardHost = "macos" | "windows" | "linux" | "none";

function clipboardHost(kind: ClipboardHost) {
	const keys = ["SSH_CONNECTION", "SSH_TTY", "OS", "SystemRoot", "DISPLAY", "WAYLAND_DISPLAY"];
	const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
	const platform = process.platform;
	for (const key of keys) delete process.env[key];
	if (kind === "windows") Object.assign(process.env, { OS: "Windows_NT", SystemRoot: "C:\\Windows" });
	if (kind === "linux") process.env.DISPLAY = ":0";
	Object.defineProperty(process, "platform", { value: kind === "macos" ? "darwin" : kind === "windows" ? platform : "linux" });
	return () => {
		Object.defineProperty(process, "platform", { value: platform });
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	};
}

function recordHelpers(result: { status: number; stderr?: string } = { status: 0 }) {
	const real = childProcess.spawnSync;
	const calls: { bin: string; args: string[]; input: string; timeout: number }[] = [];
	(childProcess as any).spawnSync = (bin: string, args: string[], options: { input: string; timeout: number }) => {
		calls.push({ bin, args, input: options.input, timeout: options.timeout });
		return { status: result.status, stderr: result.stderr ?? "" };
	};
	syncBuiltinESMExports();
	return {
		calls,
		restore: () => {
			(childProcess as any).spawnSync = real;
			syncBuiltinESMExports();
		},
	};
}

const hasOsascript = existsSync("/usr/bin/osascript");
const pictureHosts: ClipboardHost[] = ["windows", ...(hasOsascript ? (["macos"] as const) : [])];
const FIGURE_SOURCE = "```figure\n┌─ box ─┐\n│ ok    │\n└───────┘\n```";
const TABLE_SOURCE = "| Item | Qty |\n|--|--:|\n| 苹果 | 3 |";
const FLOWCHART_SOURCE = mermaidFence("flowchart TD\n  A[User] --> B[Gateway]");
const blockLabels = (text: string) => shownLabels(reply(text), 100, false).filter((label) => label !== "⧉ copy reply");

for (const host of ["windows", "macos", "linux", "none"] as const) {
	test(`58. a table, a text diagram and a figure ${host === "windows" || host === "macos" ? "offer" : "hide"} ▣ png on ${host}`, { skip: host === "macos" && !hasOsascript }, async () => {
		const restoreHost = clipboardHost(host);
		const h = createHarness();
		cleanupFn = () => {
			h.cleanup();
			restoreHost();
		};
		await h.emit("session_start");

		const png = host === "windows" || host === "macos" ? ["▣ png"] : [];
		const html = host === "none" ? [] : ["⧉ html"];
		assert.deepEqual(blockLabels(TABLE_SOURCE), ["⧉ md", "⧉ art", ...html, ...png]);
		assert.deepEqual(blockLabels(FLOWCHART_SOURCE), ["⧉ source", "⧉ art", ...png]);
		assert.deepEqual(blockLabels(FIGURE_SOURCE), ["⧉ source", "⧉ art", ...png]);
		assert.deepEqual(blockLabels("```ts\nconst x = 1;\n```"), ["⧉ copy"], "a plain code block has no picture to copy");
	});
}

test("59. a block drawn as a picture keeps ⧉ image and gets no ▣ png", { skip: !hasOsascript }, async () => {
	const restoreHost = clipboardHost("macos");
	const fake = mermanFixture();
	const h = createHarness();
	cleanupFn = () => {
		fake.restore();
		h.cleanup();
		restoreHost();
	};
	await h.emit("session_start");

	const comp = reply(mermaidFence("timeline\n  2020 : start\n  2021 : end"));
	comp.render(100);
	await mermanJobs.idle();
	assert.deepEqual(shownLabels(comp, 100, false), ["⧉ source", "⧉ image", "⧉ preview"]);
});

test("60. ▣ png hands the helper the drawn art without fences, in the pi theme's background, and says it copied an image", { skip: !hasOsascript }, async () => {
	const restoreHost = clipboardHost("macos");
	const helper = recordHelpers();
	const h = createHarness();
	cleanupFn = () => {
		helper.restore();
		setTheme("dark");
		h.cleanup();
		restoreHost();
	};
	await h.emit("session_start");

	const comp = reply(TABLE_SOURCE);
	copiedTexts.length = 0;
	press(comp, 100, "⧉ art", false);
	assert.equal(helper.calls.length, 0, "the plain art button starts no helper");
	press(comp, 100, "▣ png", false);
	assert.equal(helper.calls.length, 1);
	const [call] = helper.calls;
	assert.deepEqual([call!.bin, ...call!.args], ["/usr/bin/osascript", "-l", "JavaScript", "-e", MAC_IMAGE_COPY]);
	assert.equal(call!.timeout, 5000);
	const drawnRows = JSON.parse(call!.input).lines.map((glyphs: { text: string }[]) => glyphs.map((g) => g.text).join(""));
	assert.ok(copiedTexts[0]!.startsWith("```"), "the art button copies the fenced art");
	assert.deepEqual(drawnRows, copiedTexts[0]!.split("\n").slice(1, -1).map((row) => row.replace(/ /g, "")), "the image draws the art without its fences");
	assert.deepEqual(JSON.parse(call!.input).background, [0, 0, 0], "a dark pi theme draws on black");
	assert.ok(h.notifications.some((n) => n.text === "Copied as image"), JSON.stringify(h.notifications));

	setTheme("light");
	press(reply(TABLE_SOURCE), 100, "▣ png", false);
	assert.deepEqual(JSON.parse(helper.calls[1]!.input).background, [255, 255, 255], "a light pi theme draws on white");
});

test("61. ▣ png on a figure and a diagram draws their art, and a cold PowerShell gets 15 s", async () => {
	const restoreHost = clipboardHost("windows");
	const helper = recordHelpers();
	const h = createHarness();
	cleanupFn = () => {
		helper.restore();
		h.cleanup();
		restoreHost();
	};
	await h.emit("session_start");

	press(reply(FLOWCHART_SOURCE), 100, "▣ png", false);
	press(reply(FIGURE_SOURCE), 100, "▣ png", false);
	const drawn = helper.calls.map((call) => JSON.parse(call.input).lines.flat().map((g: { text: string }) => g.text).join(""));
	assert.ok(drawn[0]!.includes("Gateway"), drawn[0]);
	assert.ok(drawn[1]!.includes("ok") && drawn[1]!.includes("┌─box─┐"), drawn[1]);
	for (const call of helper.calls) {
		assert.equal(call.bin, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
		assert.equal(call.timeout, 15000);
	}
});

test("62. a failed image copy falls back to the drawn text and says why", async () => {
	const restoreHost = clipboardHost("windows");
	const helper = recordHelpers({ status: 1, stderr: "Cannot draw image\n" });
	const h = createHarness();
	cleanupFn = () => {
		helper.restore();
		h.cleanup();
		restoreHost();
	};
	await h.emit("session_start");

	copiedTexts.length = 0;
	press(reply(TABLE_SOURCE), 100, "▣ png", false);
	assert.ok(copiedTexts[0]!.includes("│ 苹果 │"), copiedTexts[0]);
	assert.ok(!copiedTexts[0]!.includes("`"), "the fallback text has no fences");
	assert.deepEqual(h.notifications.at(-1), { text: "Copied as plain text (Cannot draw image)", level: "warning" });
});

test("63. copyButtons:false draws no ▣ png", async () => {
	const restoreHost = clipboardHost("windows");
	const h = createHarness({ copyButtons: false });
	cleanupFn = () => {
		h.cleanup();
		restoreHost();
	};
	await h.emit("session_start");

	assert.deepEqual(blockLabels(TABLE_SOURCE), []);
});

test("64. the help screen names ▣ png, with the platforms it shows on", () => {
	assert.ok(showcaseText().includes("`▣ png`"));
	assert.ok(helpText().includes("PNG image (macOS/Windows)"));
});
