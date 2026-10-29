#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../../..");

const whichPi = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
const piBinReal = realpathSync(whichPi);
const piPkg = realpathSync(resolve(dirname(piBinReal), "../@earendil-works/pi-coding-agent/package.json"));
const parentURL = pathToFileURL(piPkg).href;

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith("@earendil-works/")) {
			return nextResolve(specifier, { ...context, parentURL });
		}
		return nextResolve(specifier, context);
	},
});

const { AssistantMessageComponent, initTheme, SessionManager, UserMessageComponent, VERSION } = await import(
	"@earendil-works/pi-coding-agent"
);
const { setTheme, theme: activePiGlobalTheme } = await import(
	pathToFileURL(resolve(dirname(piPkg), "dist/modes/interactive/theme/theme.js")).href
);
const { matchesKey, resetCapabilitiesCache, setCapabilities, visibleWidth } = await import("@earendil-works/pi-tui");

const stripAnsi = (s) =>
	s
		.replace(/\x1b\[[0-9;]*m/g, "")
		.replace(/\x1b\]8;;.*?(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b\]133;[A-Z]\x07/g, "");

function parseArgs(argv) {
	const out = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith("--")) {
			const key = arg.slice(2);
			const next = argv[i + 1];
			if (next !== undefined && !next.startsWith("--")) {
				out[key] = next;
				i++;
			} else {
				out[key] = "true";
			}
		} else {
			out._.push(arg);
		}
	}
	return out;
}

function runDirFor(runId) {
	if (!runId || !/^[A-Za-z0-9._-]+$/.test(runId)) {
		throw new Error(`Invalid or missing --run-id: ${runId}`);
	}
	return join(tmpdir(), `prism-verify-${runId}`);
}

async function createRuntime(runDir) {
	process.env.PI_CODING_AGENT_DIR = runDir;
	initTheme("dark");
	const { default: prismExtension, themeFromPiTheme } = await import(
		pathToFileURL(join(repoRoot, "extensions/prism/index.ts")).href
	);

	const handlers = new Map();
	const commands = new Map();
	const messageRenderers = new Map();
	const entryRenderers = new Map();
	const toolRenderers = [];
	const markdownTransformers = [];
	const notifications = [];
	const sentCustomMessages = [];
	const appendedEntries = [];
	let setThemeCalls = 0;
	let overlayComponent = null;

	const fakeTui = {
		terminal: { columns: 100, rows: 40 },
		requestRender: () => {},
	};

	const workDir = join(runDir, "work");
	mkdirSync(workDir, { recursive: true });
	const sm = SessionManager.inMemory(workDir);

	const ctx = {
		mode: "tui",
		hasUI: true,
		cwd: workDir,
		sessionManager: sm,
		ui: {
			get theme() {
				return activePiGlobalTheme;
			},
			notify: (text, level = "info") => {
				notifications.push({ text, level });
			},
			setTheme: () => {
				setThemeCalls++;
				return { success: true };
			},
			setWorkingIndicator: () => {},
			setWidget: () => {},
			custom: async (factory) => {
				return new Promise((resolveDone) => {
					overlayComponent = factory(fakeTui, activePiGlobalTheme, { matches: matchesKey }, () => {
						overlayComponent = null;
						resolveDone();
					});
				});
			},
		},
	};

	const pi = {
		on: (event, handler) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerCommand: (name, def) => commands.set(name, def),
		registerMessageRenderer: (customType, renderer) => messageRenderers.set(customType, renderer),
		registerEntryRenderer: (customType, renderer) => entryRenderers.set(customType, renderer),
		registerToolRenderer: (resolver) => toolRenderers.push(resolver),
		registerMarkdownTransformer: (transformer) => markdownTransformers.push(transformer),
		sendMessage: (msg) => sentCustomMessages.push(msg),
		appendEntry: (customType, data) => appendedEntries.push({ customType, data }),
	};

	prismExtension(pi);

	const emit = async (event, payload = {}) => {
		let last;
		for (const h of handlers.get(event) ?? []) {
			const res = await h(payload, ctx);
			if (res !== undefined) last = res;
		}
		return last;
	};

	await emit("session_start");

	return {
		runDir,
		workDir,
		ctx,
		emit,
		commands,
		entryRenderers,
		toolRenderers,
		markdownTransformers,
		notifications,
		sentCustomMessages,
		appendedEntries,
		getSetThemeCalls: () => setThemeCalls,
		getOverlay: () => overlayComponent,
		themeFromPiTheme,
	};
}

function writeArtifacts(outDir, name, ansiLines, metadata) {
	mkdirSync(outDir, { recursive: true });
	const ansiText = `${ansiLines.join("\n")}\n`;
	const plainText = `${ansiLines.map(stripAnsi).join("\n")}\n`;
	writeFileSync(join(outDir, `${name}.ansi`), ansiText);
	writeFileSync(join(outDir, `${name}.txt`), plainText);
	writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(metadata, null, 2)}\n`);
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];

if (cmd === "launch") {
	const runDir = runDirFor(args["run-id"]);
	mkdirSync(join(runDir, "work"), { recursive: true });
	mkdirSync(join(runDir, "sessions"), { recursive: true });
	if (args.config) {
		const parsed = JSON.parse(args.config);
		writeFileSync(join(runDir, "prism.json"), `${JSON.stringify(parsed, null, 2)}\n`);
	}
	writeFileSync(
		join(runDir, "instance.json"),
		`${JSON.stringify({ runId: args["run-id"], runDir, pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`,
	);
	console.log(JSON.stringify({ status: "ready", runId: args["run-id"], runDir }));
	process.exit(0);
}

if (cmd === "doctor") {
	const runDir = runDirFor(args["run-id"]);
	const instancePath = join(runDir, "instance.json");
	const extPath = join(repoRoot, "extensions/prism/index.ts");
	const rendererPath = join(repoRoot, "extensions/prism/renderer.ts");
	const ok = existsSync(instancePath) && existsSync(extPath) && existsSync(rendererPath);
	const report = {
		ok,
		piVersion: VERSION,
		piBinary: piBinReal,
		runDir,
		instanceExists: existsSync(instancePath),
		extensionExists: existsSync(extPath),
		rendererExists: existsSync(rendererPath),
	};
	console.log(JSON.stringify(report, null, 2));
	process.exit(ok ? 0 : 1);
}

if (cmd === "cleanup") {
	const runDir = runDirFor(args["run-id"]);
	if (existsSync(runDir)) {
		rmSync(runDir, { recursive: true, force: true });
	}
	console.log(JSON.stringify({ cleaned: true, runDir }));
	process.exit(0);
}

if (cmd === "drive") {
	const runDir = runDirFor(args["run-id"]);
	const feature = args.feature;
	const outDir = resolve(args.out ?? join(repoRoot, "artifacts/verify", args["run-id"]));
	const width = Number(args.width ?? 96);
	if (feature === "rtl-latex") {
		// The proof strings are in logical order, which prism keeps only when it detects no terminal to reorder for.
		for (const name of ["TERM_PROGRAM", "KITTY_WINDOW_ID", "ALACRITTY_WINDOW_ID", "WT_SESSION", "VTE_VERSION", "KONSOLE_VERSION"]) {
			delete process.env[name];
		}
		process.env.TERM = "xterm-256color";
	}
	const rt = await createRuntime(runDir);

	if (feature === "reply-markdown") {
		const prevForce = process.env.FORCE_HYPERLINK;
		process.env.FORCE_HYPERLINK = "1";
		try {
			writeFileSync(join(rt.workDir, "app.ts"), "export const ok = true;\n");
			const codeLines = Array.from({ length: 35 }, (_, i) => `const item${i + 1} = ${i + 1};`).join("\n");
			const md = [
				"# Release Notes",
				"",
				"Latency dropped to 99.5% (120ms[^1]) in `app.ts`.",
				"",
				"| Service | Status |",
				"|:--------|:------:|",
				"| api<br>edge | **ok** |",
				"",
				"> [!WARNING]",
				"> Drain the queue before restart.",
				"",
				"- [x] Validate schema",
				"- [ ] Roll out",
				"",
				"```ts",
				codeLines,
				"```",
				"",
				"[^1]: Measured over 50 runs.",
			].join("\n");

			const comp = new AssistantMessageComponent({
				role: "assistant",
				content: [{ type: "text", text: md }],
				timestamp: 1000,
			});
			const beforeLines = comp.render(width);
			for (const line of beforeLines) {
				assert.ok(visibleWidth(line) <= width, `Line exceeded width ${width}`);
			}
			const beforePlain = beforeLines.map(stripAnsi).join("\n");
			assert.ok(beforePlain.includes("┏━━━━━━━━━━━━━━━┓"), "banner heading rendered");
			assert.ok(beforePlain.includes("╞═════════╪════════╡"), "box table header rendered");
			assert.ok(beforePlain.includes("[ +15 more lines ]"), "code block folded at 20 lines");
			assert.ok(!beforePlain.includes("const item35 = 35;"), "folded line 35 hidden before click");

			const foldRow = beforeLines.findIndex((l) => stripAnsi(l).includes("[ +15 more lines ]"));
			const foldCol = stripAnsi(beforeLines[foldRow]).indexOf("[ +15 more lines ]") + 2;
			comp.handleMouse({ type: "press", button: "left", x: foldCol, y: foldRow, width, height: beforeLines.length });
			comp.handleMouse({ type: "click", button: "left", x: foldCol, y: foldRow, width, height: beforeLines.length });

			const afterLines = comp.render(width);
			const afterPlain = afterLines.map(stripAnsi).join("\n");
			assert.ok(afterPlain.includes("const item35 = 35;"), "unfolded line 35 visible after click");
			assert.ok(afterPlain.includes("[ show less ]"), "show less button rendered after click");

			writeArtifacts(outDir, "reply-folded", beforeLines, { feature, state: "folded", width });
			writeArtifacts(outDir, "reply-unfolded", afterLines, {
				feature,
				state: "unfolded",
				width,
				hasHyperlink: afterLines.join("\n").includes(`file://${rt.workDir}/app.ts`),
			});
			console.log(JSON.stringify({ ok: true, feature, outDir }));
			process.exit(0);
		} finally {
			if (prevForce === undefined) delete process.env.FORCE_HYPERLINK;
			else process.env.FORCE_HYPERLINK = prevForce;
		}
	}

	if (feature === "diagrams-figures") {
		const md = [
			"```mermaid",
			"flowchart LR",
			"    A[Request] --> B[Parse]",
			"    B --> C[Render]",
			"```",
			"",
			"```mermaid",
			"xychart-beta",
			'    title "Throughput"',
			"    x-axis [mon, tue, wed]",
			"    y-axis 0 --> 20",
			'    line "east" [5, 12, 18]',
			'    line "west" [3, 8, 14]',
			"```",
			"",
			"```mermaid",
			"pie showData title Share",
			'    "Core" : 7',
			'    "UI" : 3',
			"```",
			"",
			"```mermaid",
			"gantt",
			"    title Sprint",
			"    dateFormat YYYY-MM-DD",
			"    section Dev",
			"    Build :a, 2026-10-05, 2d",
			"    Test  :after a, 2d",
			"```",
			"",
			"```figure",
			"{accent:┌─ pipeline ─┐}",
			"{accent:│} {ok:✓ ready}  {accent:│}",
			"{accent:└────────────┘}",
			"```",
		].join("\n");

		const comp = new AssistantMessageComponent({
			role: "assistant",
			content: [{ type: "text", text: md }],
			timestamp: 2000,
		});
		const lines = comp.render(width);
		const plain = lines.map(stripAnsi).join("\n");
		assert.ok(plain.includes("Request") && plain.includes("Render"), "flowchart rendered");
		assert.ok(plain.includes("Throughput") && plain.includes("east"), "xychart rendered");
		assert.ok(plain.includes("Share") && plain.includes("70%"), "pie chart rendered");
		assert.ok(plain.includes("Sprint") && plain.includes("Build"), "gantt chart rendered");
		assert.ok(plain.includes("┌─ pipeline ─┐") && plain.includes("✓ ready"), "figure rendered and aligned");

		writeArtifacts(outDir, "diagrams-figures", lines, { feature, width, lineCount: lines.length });
		console.log(JSON.stringify({ ok: true, feature, outDir }));
		process.exit(0);
	}

	if (feature === "setup-commands") {
		const cmdHandler = rt.commands.get("prism");
		void cmdHandler.handler("setup", rt.ctx);
		const overlay = rt.getOverlay();
		assert.ok(overlay, "setup overlay opened");
		const step1Lines = overlay.render(width);
		const step1Plain = step1Lines.map(stripAnsi).join("\n");
		assert.ok(step1Plain.includes("Setup 1/7: Tables"), "step 1 is Tables (7 core steps)");

		overlay.handleInput("\x1b[B");
		overlay.handleInput("\r");
		const step2Lines = overlay.render(width);
		const step2Plain = step2Lines.map(stripAnsi).join("\n");
		assert.ok(step2Plain.includes("Setup 2/7: Tasks"), "advanced to step 2 Tasks");
		overlay.handleInput("\x1b");
		assert.equal(rt.getOverlay(), null, "overlay closed on Escape");

		const savedConfig = JSON.parse(readFileSync(join(runDir, "prism.json"), "utf8"));
		assert.equal(savedConfig.tableStyle, "rules", "tableStyle saved to prism.json");
		assert.equal(savedConfig.theme, undefined, "no theme key written to prism.json");
		assert.equal(savedConfig.syncPiTheme, undefined, "no syncPiTheme key written to prism.json");
		assert.equal(savedConfig.toolRows, undefined, "no toolRows key written to prism.json");

		await cmdHandler.handler("", rt.ctx);
		assert.equal(rt.sentCustomMessages.length, 0, "/prism never calls pi.sendMessage");
		assert.equal(rt.appendedEntries.at(-1)?.customType, "prism-output", "/prism appends display-only custom entry");
		const helpRenderer = rt.entryRenderers.get("prism-output");
		const helpLines = helpRenderer(rt.appendedEntries.at(-1), { expanded: false }, activePiGlobalTheme).render(width);
		const helpPlain = helpLines.map(stripAnsi).join("\n");
		assert.ok(!helpPlain.includes("Claude"), "help contains zero Claude references");

		const turnRenderer = rt.entryRenderers.get("prism-turn");
		const turnLines = turnRenderer(
			{ type: "custom", customType: "prism-turn", data: { durationMs: 125000, at: Date.now() } },
			{ expanded: false },
			activePiGlobalTheme,
		).render(width);
		const turnPlain = turnLines.map(stripAnsi).join("\n");
		assert.ok(turnPlain.includes("✻ prismantis rendering for 2m 5s"), "turn duration renders prismantis rendering for ...");

		writeArtifacts(outDir, "setup-step1", step1Lines, { feature, step: 1, savedConfig });
		writeArtifacts(outDir, "setup-step2", step2Lines, { feature, step: 2, savedConfig });
		writeArtifacts(outDir, "help-entry", [...helpLines, ...turnLines], {
			feature,
			sentCustomMessagesCount: rt.sentCustomMessages.length,
			appendedEntryType: rt.appendedEntries.at(-1)?.customType,
			turnPlain: turnPlain.trim(),
		});
		console.log(JSON.stringify({ ok: true, feature, outDir }));
		process.exit(0);
	}

	if (feature === "rtl-latex") {
		const cmdHandler = rt.commands.get("prism");
		await cmdHandler.handler("checkhealth-rtl", rt.ctx);
		const rtlEntry = rt.appendedEntries.at(-1);
		const outputRenderer = rt.entryRenderers.get("prism-output");
		const rtlLines = outputRenderer(rtlEntry, { expanded: false }, activePiGlobalTheme).render(width);
		const rtlPlain = rtlLines.map(stripAnsi).join("\n");
		assert.ok(rtlPlain.includes("עברית מימין לשמאל"), "renders Hebrew RTL heading");
		assert.ok(rtlPlain.includes("us-east"), "renders mixed LTR inside RTL table/list");

		const mathMd = [
			"Inline math $x^2 + y^2 = z^2$ and display math:",
			"",
			"$$",
			"\\alpha + \\beta = \\gamma",
			"$$",
		].join("\n");
		const mathComp = new AssistantMessageComponent({
			role: "assistant",
			content: [{ type: "text", text: mathMd }],
			timestamp: 4000,
		});
		const mathLines = mathComp.render(width);
		const mathPlain = mathLines.map(stripAnsi).join("\n");
		assert.ok(mathPlain.includes("x² + y² = z²"), "renders inline TeX math as Unicode");
		assert.ok(mathPlain.includes("α + β = γ"), "renders display TeX math block");

		writeArtifacts(outDir, "rtl-showcase", rtlLines, { feature, section: "rtl", width });
		writeArtifacts(outDir, "latex-math", mathLines, { feature, section: "latex", width });
		console.log(JSON.stringify({ ok: true, feature, outDir }));
		process.exit(0);
	}

	if (feature === "theme-sync") {
		setTheme("dark");
		const comp = new AssistantMessageComponent({
			role: "assistant",
			content: [{ type: "text", text: "# Theme Heading\n\n| Key | Value |\n|:----|------:|\n| latency | 42ms |" }],
			timestamp: 3000,
		});
		const darkLines = comp.render(width);
		const darkPalette = rt.themeFromPiTheme(activePiGlobalTheme);

		setTheme("light");
		const lightLines = comp.render(width);
		const lightPalette = rt.themeFromPiTheme(activePiGlobalTheme);
		setTheme("dark");

		assert.equal(rt.getSetThemeCalls(), 0, "prismantis never mutates global Pi theme");
		assert.notEqual(darkLines.join("\n"), lightLines.join("\n"), "switching Pi theme repaints ANSI output");
		assert.equal(
			darkLines.map(stripAnsi).join("\n"),
			lightLines.map(stripAnsi).join("\n"),
			"plain text layout stays identical across theme switches",
		);

		writeArtifacts(outDir, "theme-dark", darkLines, {
			feature,
			piTheme: "dark",
			setThemeCalls: rt.getSetThemeCalls(),
			palette: darkPalette,
		});
		writeArtifacts(outDir, "theme-light", lightLines, {
			feature,
			piTheme: "light",
			setThemeCalls: rt.getSetThemeCalls(),
			palette: lightPalette,
		});
		console.log(JSON.stringify({ ok: true, feature, outDir }));
		process.exit(0);
	}

	if (feature === "plantuml") {
		const plantuml = await import(pathToFileURL(join(repoRoot, "extensions/prism/core/plantuml.ts")).href);
		const waitForJobs = () => plantuml.plantumlJobs.idle();
		const count = (haystack, needle) => haystack.split(needle).length - 1;
		const md = [
			"```plantuml",
			"@startuml",
			"Alice -> Bob : hi",
			"Bob --> Alice : hello",
			"@enduml",
			"```",
			"",
			"@startuml",
			"A -> B : unfenced",
			"@enduml",
			"",
			"```",
			"@startuml",
			"Carol -> Dave : untagged",
			"@enduml",
			"```",
			"",
			"```plantuml",
			"class Foo",
			"Foo --> Bar",
			"```",
			"",
			"```plantuml",
			"@startuml",
			"!include <C4/C4_Container>",
			'Person(user, "User")',
			'Container(web, "Web", "Go")',
			'Rel(user, web, "Uses")',
			"SHOW_LEGEND()",
			"@enduml",
			"```",
			"",
			"```plantuml",
			"@startuml",
			"!include /etc/passwd",
			"Alice -> Bob : after include",
			"@enduml",
			"```",
			"",
			"```plantuml",
			"@startuml",
			"foo bar baz",
			"@enduml",
			"```",
		].join("\n");
		const reply = (timestamp) =>
			new AssistantMessageComponent({ role: "assistant", content: [{ type: "text", text: md }], timestamp });

		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
		const text = reply(3000);
		const textLines = text.render(width);
		const textPlain = textLines.map(stripAnsi).join("\n");
		assert.equal(count(textPlain, "plantuml diagrams require an image-capable terminal"), 7, "every block gets the note on a terminal without images");
		assert.equal(plantuml.plantumlJobs.pending.size, 0, "no render starts without images");
		assert.ok(!textPlain.includes("│Alice│"), "no text art is drawn");

		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: false });
		const png = reply(4000);
		const sourceLines = png.render(width);
		assert.ok(sourceLines.map(stripAnsi).join("\n").includes("Alice -> Bob : hi"), "first frame shows the source while the engine runs");
		await waitForJobs();
		const pngLines = png.render(width);
		const pngPlain = pngLines.map(stripAnsi).join("\n");
		const imageIds = new Set([...pngLines.join("\n").matchAll(/\x1b_G[^\x1b]*?\bi=(\d+)/g)].map((m) => m[1]));
		assert.equal(imageIds.size, 4, "the fenced, unfenced, untagged and class diagrams are kitty images");
		assert.ok(pngPlain.includes("plantuml error (line 2): cannot include <C4/C4_Container>"), "a built-in library include is refused too");
		assert.ok(pngPlain.includes("plantuml error (line 2): cannot include /etc/passwd"), "a blocked include shows PlantUML's reason");
		assert.ok(pngPlain.includes("plantuml error (line 2): Syntax Error?"), "a syntax error names its line");
		resetCapabilitiesCache();

		writeArtifacts(outDir, "plantuml-text", textLines, { feature, images: false, width, lineCount: textLines.length });
		writeArtifacts(outDir, "plantuml-png", pngLines, { feature, images: true, width, lineCount: pngLines.length });
		console.log(JSON.stringify({ ok: true, feature, outDir }));
		process.exit(0);
	}

	if (feature === "merman") {
		assert.equal(spawnSync("which", ["merman-cli"]).status, 0, "merman-cli must be on PATH");
		assert.ok(!process.env.SSH_CONNECTION && !process.env.SSH_TTY, "prism turns merman off over SSH; drive it from a local terminal");
		const { headerWord, MERMAN_HINT, MERMAN_KINDS, mermanJobs } = await import(pathToFileURL(join(repoRoot, "extensions/prism/core/merman.ts")).href);
		const fence = (source) => ["```mermaid", source, "```"].join("\n");
		const fan = (id) => ["flowchart TD", "  root[Root]", ...[0, 1, 2, 3].map((n) => `  root --> ${id(n)}[Child number ${n}]`)].join("\n");
		const timeline = "timeline\n  title Releases\n  2024 : alpha\n  2025 : beta : stable";
		const text = [
			fence(timeline),
			fence("notADiagram\n  foo"),
			fence(fan((n) => `c${n}`)),
			fence(fan((n) => `child-${n}`)),
		].join("\n\n");
		const reply = () =>
			new AssistantMessageComponent({ role: "assistant", content: [{ type: "text", text }], timestamp: 5000 });
		const count = (haystack, needle) => haystack.split(needle).length - 1;
		const KITTY = "\x1b_G";
		const PENDING = "drawing with merman…";
		const REPLY_INSET = 4;
		const fittedAt = (columns) => columns + REPLY_INSET;
		const narrow = fittedAt(80);
		const wide = fittedAt(140);
		const buttons = process.platform === "darwin";

		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: false });
		const comp = reply();
		const pendingLines = comp.render(narrow);
		const pendingPlain = pendingLines.map(stripAnsi).join("\n");
		assert.equal(count(pendingPlain, PENDING), 4, "the first frame marks all four blocks as drawing with merman");
		assert.equal(count(pendingLines.join("\n"), KITTY), 0, "no picture yet");

		await mermanJobs.idle();
		const drawnLines = comp.render(narrow);
		const drawnPlain = drawnLines.map(stripAnsi).join("\n");
		const imageIds = new Set([...drawnLines.join("\n").matchAll(/\x1b_G[^\x1b]*?\bi=(\d+)/g)].map((m) => m[1]));
		assert.equal(imageIds.size, 3, "the timeline and both fan-outs are kitty images");
		assert.ok(!drawnPlain.includes(PENDING), "nothing is still pending");
		assert.equal(count(drawnPlain, "[ ⧉ source ]"), 3, "every picture offers source");
		assert.equal(count(drawnPlain, "[ ⧉ image ]"), buttons ? 3 : 0, "image buttons appear where the desktop shows pictures");
		assert.equal(count(drawnPlain, "[ ⧉ preview ]"), buttons ? 3 : 0, "preview buttons appear where the desktop shows pictures");
		assert.ok(drawnPlain.includes("notADiagram diagrams draw as source for now"), "a header merman rejects keeps main's note");
		assert.ok(!drawnPlain.includes("(merman"), "and no note carries a merman suffix");
		assert.ok(!drawnPlain.includes("child-0[Child number 0]"), "the hyphenated fan-out is a picture, not source");

		const widePlain = comp.render(wide).map(stripAnsi).join("\n");
		assert.equal(count(widePlain, "Child number 3"), 2, "at 140 columns both fan-outs are box art");
		assert.ok(widePlain.includes("notADiagram diagrams draw as source for now"), "the rejected header still keeps its note");

		const minimal = {
			timeline: "timeline\n  2024 : alpha",
			mindmap: "mindmap\n  root((Plan))\n    Build\n    Ship",
			gitGraph: "gitGraph\n  commit\n  branch dev\n  commit\n  checkout main\n  merge dev",
			journey: "journey\n  title Day\n  section Work\n    Code: 5: Me",
			quadrantChart: "quadrantChart\n  title Reach\n  x-axis Low --> High\n  y-axis Low --> High\n  A: [0.3, 0.6]",
			"sankey-beta": "sankey-beta\n  A,B,10",
			C4Context: 'C4Context\n  Person(u, "User")\n  System(s, "App")\n  Rel(u, s, "Uses")',
			"architecture-beta": "architecture-beta\n  service api(server)[API]",
			"block-beta": "block-beta\n  a b c",
			kanban: "kanban\n  Todo\n    t1[Write docs]",
			"packet-beta": 'packet-beta\n  0-15: "Source Port"\n  16-31: "Destination Port"',
			"radar-beta": 'radar-beta\n  axis a["A"], b["B"], c["C"]\n  curve x["X"]{1, 2, 3}',
			"treemap-beta": 'treemap-beta\n  "Root"\n    "Leaf": 5',
			requirementDiagram: "requirementDiagram\n  requirement r1 {\n    id: 1\n    text: hello\n    risk: low\n    verifymethod: test\n  }",
		};
		assert.deepEqual(Object.keys(minimal).sort(), [...MERMAN_KINDS].sort(), "every kind the hint names has a minimal body");
		for (const word of MERMAN_KINDS) {
			assert.ok(MERMAN_HINT.includes(word), `the hint names ${word}`);
			const ran = spawnSync("merman-cli", ["render", "-", "-f", "png", "-q", "-o", "-"], { input: minimal[word] });
			assert.equal(ran.status, 0, `merman draws ${word}`);
		}

		const picture = mermanJobs.cache.get(timeline);
		assert.equal(picture?.state, "drawn", "the timeline is cached as a picture");
		const timelinePng = Buffer.from(picture.png, "base64");
		assert.equal(timelinePng.subarray(1, 4).toString("latin1"), "PNG", "the cached picture is a PNG");
		mkdirSync(outDir, { recursive: true });
		writeFileSync(join(outDir, "merman-timeline.png"), timelinePng);

		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
		const jobsBefore = mermanJobs.pending.size;
		const textLines = reply().render(narrow);
		const textPlain = textLines.map(stripAnsi).join("\n");
		assert.equal(jobsBefore + mermanJobs.pending.size, 0, "without images nothing is pending");
		assert.ok(textPlain.includes("timeline diagrams draw as source for now"), "without images the timeline keeps main's note");
		assert.ok(textPlain.includes("diagram is 81 cols, terminal is 80"), "without images the fan-out keeps main's note");
		assert.ok(!textPlain.includes("merman"), "without images nothing mentions merman");
		resetCapabilitiesCache();

		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: false });
		await rt.commands.get("prism").handler("checkhealth", rt.ctx);
		const demoEntry = rt.appendedEntries.at(-1);
		const demoRenderer = rt.entryRenderers.get("prism-output");
		const demoComp = demoRenderer(demoEntry, { expanded: false }, activePiGlobalTheme);
		const demoWidth = fittedAt(100);
		demoComp.render(demoWidth);
		await mermanJobs.idle();
		const demoLines = demoComp.render(demoWidth);
		const demoPlain = demoLines.map(stripAnsi).join("\n");
		const demoSamples = [...demoEntry.data.text.matchAll(/```mermaid\n([\s\S]*?)\n```/g)]
			.map((m) => m[1])
			.filter((source) => MERMAN_KINDS.includes(headerWord(source)));
		assert.deepEqual(
			demoSamples.map(headerWord).sort(),
			[...MERMAN_KINDS].sort(),
			"/prism checkhealth has one sample of every kind the hint names",
		);
		for (const source of demoSamples) {
			const word = headerWord(source);
			assert.equal(mermanJobs.cache.get(source)?.state, "drawn", `the ${word} demo sample ends as a picture`);
			assert.ok(!demoPlain.includes(`${word} diagrams draw as source for now`), `the ${word} demo sample shows no note`);
		}
		assert.ok(!demoPlain.includes(PENDING), "no demo sample is still drawing");
		const demoImageIds = new Set([...demoLines.join("\n").matchAll(/\x1b_G[^\x1b]*?\bi=(\d+)/g)].map((m) => m[1]));
		assert.ok(demoImageIds.size >= demoSamples.length, "every demo sample is a kitty image");
		resetCapabilitiesCache();

		writeArtifacts(outDir, "merman-demo", demoLines, { feature, state: "demo", width: demoWidth, samples: demoSamples.length, imageIds: [...demoImageIds] });
		writeArtifacts(outDir, "merman-pending", pendingLines, { feature, state: "pending", width: narrow });
		writeArtifacts(outDir, "merman-images", drawnLines, { feature, state: "drawn", width: narrow, imageIds: [...imageIds], buttons });
		writeArtifacts(outDir, "merman-wide", comp.render(wide), { feature, state: "wide", width: wide });
		writeArtifacts(outDir, "merman-text", textLines, { feature, state: "images-off", width: narrow });
		console.log(JSON.stringify({ ok: true, feature, outDir, timelineBytes: timelinePng.length }));
		process.exit(0);
	}

	if (feature === "quicklook") {
		assert.equal(process.platform, "darwin", "the Quick Look preview exists only on macOS");
		assert.ok(!process.env.SSH_CONNECTION && !process.env.SSH_TTY, "over SSH the panel opens on a screen nobody watches");
		for (const bin of ["/usr/bin/swiftc", "/usr/bin/clang"]) {
			assert.ok(existsSync(bin), `${bin} must exist; install the Xcode command line tools`);
		}
		assert.ok(existsSync(runDir), `run launch --run-id ${args["run-id"]} first`);
		mkdirSync(outDir, { recursive: true });
		// The tests build the helper and the probe under TMPDIR, so cleanup removes them with the run directory.
		const run = spawnSync(process.execPath, ["--test", "--test-reporter=spec", join(repoRoot, "test/prism-quicklook.test.ts")], {
			cwd: repoRoot,
			env: { ...process.env, TMPDIR: runDir, QLF_EVIDENCE_DIR: outDir },
			encoding: "utf8",
		});
		const log = stripAnsi(`${run.stdout}${run.stderr}`);
		writeFileSync(join(outDir, "quicklook-tests.txt"), log);
		const count = (key) => Number(log.match(new RegExp(`ℹ ${key} (\\d+)`))?.[1] ?? Number.NaN);
		const tests = { pass: count("pass"), fail: count("fail"), skipped: count("skipped") };
		// A skipped test proves nothing; the zoom test skips when the terminal may not record the screen.
		const ok = run.status === 0 && tests.pass > 0 && tests.fail === 0 && tests.skipped === 0;
		console.log(JSON.stringify({ ok, feature, outDir, ...tests }));
		process.exit(ok ? 0 : 1);
	}

	throw new Error(`Unknown --feature: ${feature}`);
}

console.error("Usage: control-prism.mjs <launch|doctor|drive|cleanup> --run-id <id> [...]");
process.exit(1);
