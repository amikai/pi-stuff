import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const { loadThemeFromPath } = await import(
	pathToFileURL(resolve(dirname(piPkg), "dist/modes/interactive/theme/theme.js")).href
);
const { matchesKey, visibleWidth } = await import("@earendil-works/pi-tui");
initTheme();

const { default: prismantisExtension } = await import("../extensions/prismantis/index.ts");
const { EL, h } = await import("../extensions/prismantis/core/jsx.ts");
const { clearHover, PrismantisComponent, settlePointerMove } = await import("../extensions/prismantis/renderer.ts");
const { parse } = await import("../extensions/prismantis/core/markdown.ts");
const { drawDiagrams } = await import("../extensions/prismantis/core/mermaid.ts");
const { renderBlocks } = await import("../extensions/prismantis/core/render.ts");
const { resolveStyle } = await import("../extensions/prismantis/core/theme.ts");

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stripAnsi = (s: string) =>
	s
		.replace(/\x1b\[[0-9;]*m/g, "")
		.replace(/\x1b\]8;;.*?(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b\]133;[A-Z]\x07/g, "");

const mockPiTheme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
	underline: (text: string) => text,
	strikethrough: (text: string) => text,
} as any;

function createHarness(initialConfig?: Record<string, unknown>) {
	const dir = mkdtempSync(join(tmpdir(), "prismantis-unit-"));
	process.env.PI_CODING_AGENT_DIR = dir;
	if (initialConfig) {
		writeFileSync(join(dir, "prismantis.json"), `${JSON.stringify(initialConfig, null, 2)}\n`);
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
	const allThemes = readdirSync(join(repoRoot, "themes"))
		.filter((f) => f.endsWith(".json"))
		.map((f) => ({ name: f.replace(/\.json$/, ""), path: join(repoRoot, "themes", f) }));

	const ctx = {
		mode: "tui",
		hasUI: true,
		cwd: "/tmp/project",
		sessionManager: sm,
		ui: {
			notify: (text: string, level = "info") => {
				notifications.push({ text, level });
			},
			getAllThemes: () => allThemes,
			setTheme: (name: string) => {
				activePiTheme = name;
				return { success: true };
			},
			setWorkingIndicator: () => {},
			setWidget: () => {},
			custom: async (factory: any) => {
				return new Promise<void>((resolveDone) => {
					overlayComponent = factory(fakeTui, mockPiTheme, { matches: matchesKey }, () => {
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

	prismantisExtension(pi);

	const emit = async (event: string, payload: any = {}) => {
		for (const h of handlers.get(event) ?? []) {
			await h(payload, ctx);
		}
	};

	const readConfig = () => JSON.parse(readFileSync(join(dir, "prismantis.json"), "utf8"));
	const writeConfig = (data: Record<string, unknown>) =>
		writeFileSync(join(dir, "prismantis.json"), `${JSON.stringify(data, null, 2)}\n`);

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

test("1. all 16 generated prismantis themes load and validate in pi, and core matches upstream snapshots", () => {
	const themesDir = join(repoRoot, "themes");
	const files = readdirSync(themesDir).filter((f) => f.startsWith("prismantis-") && f.endsWith(".json"));
	assert.equal(files.length, 16);
	for (const file of files) {
		const loaded = loadThemeFromPath(join(themesDir, file));
		assert.equal(loaded.name, file.replace(/\.json$/, ""));
	}

	const upstreamPrismantis = resolve(repoRoot, "../prismantis");
	if (existsSync(join(upstreamPrismantis, "docs/demo.md"))) {
		const demo = readFileSync(join(upstreamPrismantis, "docs/demo.md"), "utf8");
		const flags = (p: any) => ["bold", "italic", "underline", "strikethrough", "dim", "inverse"].filter((k) => p?.[k]).join(",");
		const walk = (node: any, depth: number, out: string[]) => {
			if (node === null || node === undefined || node === false) return;
			if (Array.isArray(node)) return node.forEach((n) => walk(n, depth, out));
			if (typeof node !== "object") return void out.push(`${"  ".repeat(depth)}"${node}"`);
			const { type, props: p, children = [] } = node;
			const props = p ?? {};
			const attrs = [
				props.color && `color=${props.color}`,
				props.backgroundColor && `bg=${props.backgroundColor}`,
				flags(props),
				props.flexDirection === "row" && "row",
				props.borderStyle && `border=${props.borderStyle}`,
			]
				.filter(Boolean)
				.join(" ");
			out.push(`${"  ".repeat(depth)}<${type}${attrs ? ` ${attrs}` : ""}>`);
			walk(children, depth + 1, out);
		};
		for (const [theme, rtl, name] of [
			["catppuccin-mocha", "warp", "catppuccin-mocha"],
			["github-light", "warp", "github-light"],
			["mono", "warp", "mono"],
			["catppuccin-mocha", "kitty", "kitty"],
		] as const) {
			const style = resolveStyle({ theme, rtl });
			const blocks = parse(demo, { numbers: style.highlightNumbers, paths: style.highlightPaths });
			const out: string[] = [];
			walk(renderBlocks(EL, style, blocks, 100, drawDiagrams(EL, style, blocks, 100), () => null), 0, out);
			const expected = readFileSync(join(upstreamPrismantis, `tests/snapshots/demo-${name}.txt`), "utf8");
			assert.equal(`${out.join("\n")}\n`, expected);
		}
	}
});

test("2. AssistantMessageComponent renders tables, headings, code folding, diagrams, figures, alerts, and footnotes", async () => {
	const h = createHarness({ theme: "catppuccin-mocha", headingStyle: "banner", tableStyle: "box" });
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

test("3. UserMessageComponent renders bubble, bar, chevron prompt styles and clock times", async () => {
	const h = createHarness({ promptStyle: "bubble", clock: "24h" });
	cleanupFn = h.cleanup;
	await h.emit("session_start");
	await h.emit("input", { text: "fix the failing test", source: "interactive" });

	const userComp = new UserMessageComponent("fix the failing test");
	const bubblePlain = stripAnsi(userComp.render(80).join("\n"));
	assert.ok(bubblePlain.includes("╭─"), "draws bubble border around user prompt");
	assert.ok(bubblePlain.includes("fix the failing test"), "draws prompt text");
	assert.match(bubblePlain, /\d{2}:\d{2}/, "draws 24h clock timestamp");

	await h.commands.get("prismantis")!.handler("setup prompts chevron", h.ctx);
	userComp.rebuild();
	const chevronPlain = stripAnsi(userComp.render(80).join("\n"));
	assert.ok(chevronPlain.includes("› "), "draws chevron prompt marker");
});

test("4. Tool renderer draws quiet tool rows and clickable diff cards for edit and write", async () => {
	const h = createHarness({ toolStyle: "tree-dim", toolOutput: "quiet", diffStyle: "card" });
	cleanupFn = h.cleanup;
	await h.emit("session_start");

	const resolver = h.toolRenderers[0]!;
	const bashRenderers = resolver("bash", () => undefined);
	assert.equal(bashRenderers.renderShell, "self");

	const bashCtx = {
		args: { command: 'rg "TODO" src/' },
		toolCallId: "tc-bash-1",
		invalidate: () => {},
		state: {},
		cwd: "/tmp/project",
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: true,
		isError: false,
		outputPad: 1,
	};
	const callComp = bashRenderers.renderCall(bashCtx.args, mockPiTheme, bashCtx);
	const callPlain = stripAnsi(callComp.render(80).join("\n"));
	assert.ok(callPlain.includes('Searched src/ for "TODO"'), `expected quiet shell description, got: ${callPlain}`);

	const resultComp = bashRenderers.renderResult(
		{ content: [{ type: "text", text: "src/a.ts:1: // TODO" }] },
		{ expanded: false, isPartial: false },
		mockPiTheme,
		bashCtx,
	);
	assert.equal(resultComp.render(80).length, 0, "quiet mode hides read-only tool output");

	const editRenderers = resolver("edit", () => undefined);
	const patchLines = Array.from({ length: 25 }, (_, i) => `+const line${i + 1} = ${i + 1};`);
	const patch = `@@ -1,1 +1,25 @@\n-const old = 0;\n${patchLines.join("\n")}`;
	const editCtx = {
		...bashCtx,
		toolCallId: "tc-edit-1",
		args: { path: "/tmp/project/src/config.ts", edits: [] },
	};
	const diffComp = editRenderers.renderResult(
		{ content: [{ type: "text", text: "Edited" }], details: { patch } },
		{ expanded: false, isPartial: false },
		mockPiTheme,
		editCtx,
	);
	const diffLines = diffComp.render(80);
	const diffPlain = stripAnsi(diffLines.join("\n"));
	assert.ok(diffPlain.includes("+25 −1"), "draws diff header counts");
	assert.ok(diffPlain.includes("[ +6 more lines ]"), "folds diff card past 20 lines");

	diffComp.handleMouse({ type: "press", button: "left", x: 10, y: 2 } as any);
	diffComp.handleMouse({ type: "click", button: "left", x: 10, y: 2 } as any);
	const unfoldedDiffPlain = stripAnsi(diffComp.render(80).join("\n"));
	assert.ok(unfoldedDiffPlain.includes("const line25 = 25;"), "clicking diff card unfolds all lines");
});

test("5. /prismantis commands, interactive setup pane, system prompt hints, and turn duration entry work", async () => {
	const h = createHarness({ theme: "catppuccin-mocha", clock: "24h" });
	cleanupFn = h.cleanup;
	await h.emit("session_start");
	assert.equal(h.getActivePiTheme(), "prismantis-catppuccin-mocha");

	const cmd = h.commands.get("prismantis")!;
	await cmd.handler("nord", h.ctx);
	assert.equal(h.getActivePiTheme(), "prismantis-nord");
	assert.equal(h.readConfig().theme, "nord");

	await cmd.handler("demo ko", h.ctx);
	assert.equal(h.sentCustomMessages.at(-1)?.customType, "prismantis-output");
	const msgRenderer = h.messageRenderers.get("prismantis-output")!;
	const demoComp = msgRenderer(h.sentCustomMessages.at(-1), { expanded: false, outputPad: 1 }, mockPiTheme);
	const demoPlain = stripAnsi(demoComp.render(96).join("\n"));
	assert.ok(demoPlain.includes("한국어"), "demo ko includes Korean showcase");
	assert.ok(demoPlain.includes("Parse"), "demo renders mermaid diagrams and pie charts");

	void cmd.handler("setup", h.ctx);
	const overlay = h.getOverlay();
	assert.ok(overlay, "opens interactive setup overlay in TUI mode");
	const initialOverlayPlain = stripAnsi(overlay.render(90).join("\n"));
	assert.ok(initialOverlayPlain.includes("Setup 1/11: Theme"), "renders step 1 in setup overlay");
	overlay.handleInput("\x1b[B");
	overlay.handleInput("\r");
	const step2Plain = stripAnsi(overlay.render(90).join("\n"));
	assert.ok(step2Plain.includes("Setup 2/11: Tables"), "advances to step 2 after Enter");
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
		startEvent.systemPromptOptions.guidelines.some((g) => g.includes("xychart-beta")),
		"injects diagram hint into guidelines",
	);
	assert.ok(
		startEvent.systemPromptOptions.guidelines.some((g) => g.includes("```figure")),
		"injects figure hint into guidelines",
	);

	const entryRenderer = h.entryRenderers.get("prismantis-turn")!;
	const turnComp = entryRenderer({ type: "custom", customType: "prismantis-turn", data: { durationMs: 125000, at: Date.now() } }, { expanded: false }, mockPiTheme);
	const turnPlain = stripAnsi(turnComp.render(80).join("\n"));
	assert.ok(turnPlain.includes("✻ Baked for 2m 5s"), `expected Baked duration footer, got: ${turnPlain}`);

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
	const comp = new PrismantisComponent(() => tree);
	comp.render(40);
	return comp;
}

test("6. Hovering a button highlights it and moving off clears it", () => {
	const comp = hoverFixture();
	assert.ok(!comp.render(40).join("").includes(INVERSE), "no highlight before any pointer move");

	assert.deepEqual(comp.handleMouse(move(3, 0)), { handled: true, render: true }, "pi only repaints a move reported as handled");
	const lit = comp.render(40);
	assert.ok(lit[0]!.includes(`${INVERSE}`) && stripAnsi(lit[0]!).includes("[ ⧉ source ]"), "button is inverse on hover");
	assert.equal(comp.handleMouse(move(4, 0)), undefined, "moving within the same button changes nothing");

	assert.deepEqual(comp.handleMouse(move(3, 2)), { handled: true, render: true });
	assert.ok(!comp.render(40).join("").includes(INVERSE), "moving to plain text clears the highlight");
});

test("7. A hover prop replaces the default inverse highlight", () => {
	const comp = hoverFixture();
	comp.handleMouse(move(2, 1));
	const lines = comp.render(40);
	assert.ok(lines[1]!.includes("38;2;255;0;0"), "uses the hover color");
	assert.ok(!lines[1]!.includes(INVERSE), "does not fall back to inverse");
});

test("8. Only one element is highlighted across components, and leaving them all clears it", () => {
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
