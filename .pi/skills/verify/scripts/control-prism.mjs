#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
const { matchesKey, visibleWidth } = await import("@earendil-works/pi-tui");

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
		await cmdHandler.handler("demo-rtl", rt.ctx);
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

	throw new Error(`Unknown --feature: ${feature}`);
}

console.error("Usage: control-prism.mjs <launch|doctor|drive|cleanup> --run-id <id> [...]");
process.exit(1);
