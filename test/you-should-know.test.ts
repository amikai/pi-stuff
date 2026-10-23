import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { pathToFileURL } from "node:url";

// Resolve @earendil-works/* from the installed pi package so the repo needs no local node_modules.
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

const { initTheme, SessionManager } = await import("@earendil-works/pi-coding-agent");
initTheme();
const { Editor } = await import("@earendil-works/pi-tui");
const { default: youShouldKnow } = await import("../extensions/you-should-know/index.ts");

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as any;

function createHarness(options?: {
	onStream?: (model: any, context: any, opts: any) => Promise<{ text?: string; stopReason?: string; errorMessage?: string }>;
	columns?: number;
}) {
	const dir = mkdtempSync(join(tmpdir(), "ysk-unit-"));
	process.env.PI_CODING_AGENT_DIR = dir;
	process.env.PI_YOU_SHOULD_KNOW_DEBUG = "1";

	const handlers = new Map<string, ((...args: any[]) => any)[]>();
	const commands = new Map<string, (args: string, ctx: any) => Promise<void>>();
	const notifications: { text: string; level: string }[] = [];
	const streamCalls: { model: string; systemPrompt: string; prompt: string; reasoning?: string }[] = [];

	let editorText = "";
	let inputListener: ((data: string) => any) | undefined;
	let widgetComponent: any = null;
	let overlayComponent: any = null;
	let overlayOptionsFn: (() => any) | undefined;

	const focusedEditor = Object.create(Editor.prototype);
	const fakeTui = {
		terminal: { columns: options?.columns ?? 140, rows: 40 },
		getFocusedComponent: () => focusedEditor,
		requestRender: () => {},
	} as any;

	const models = new Map([
		["faux/faux-1", { provider: "faux", id: "faux-1" }],
		["faux/faux-2", { provider: "faux", id: "faux-2" }],
	]);

	let sm = SessionManager.inMemory("/tmp");

	const ctx = {
		mode: "tui",
		model: models.get("faux/faux-1"),
		sessionManager: sm,
		modelRegistry: {
			find: (provider: string, id: string) => models.get(`${provider}/${id}`),
			hasConfiguredAuth: () => true,
			streamSimple: (model: any, context: any, opts: any) => ({
				result: async () => {
					const prompt = context.messages?.[0]?.content?.[0]?.text ?? "";
					streamCalls.push({
						model: `${model.provider}/${model.id}`,
						systemPrompt: context.systemPrompt ?? "",
						prompt,
						reasoning: opts?.reasoning,
					});
					const custom = options?.onStream
						? await options.onStream(model, context, opts)
						: { text: "learn: none", stopReason: "stop" };
					return {
						stopReason: custom.stopReason ?? "stop",
						errorMessage: custom.errorMessage,
						content: custom.text !== undefined ? [{ type: "text", text: custom.text }] : [],
						usage: { input: 10, output: 5 },
					};
				},
			}),
		},
		ui: {
			setWidget: (_id: string, factory?: (t: any, th: any) => any) => {
				widgetComponent = factory ? factory(fakeTui, theme) : null;
			},
			onTerminalInput: (fn: (data: string) => any) => {
				inputListener = fn;
				return () => {
					if (inputListener === fn) inputListener = undefined;
				};
			},
			getEditorText: () => editorText,
			setEditorText: (text: string) => {
				editorText = text;
			},
			notify: (text: string, level: string) => {
				notifications.push({ text, level });
			},
			custom: async (factory: any, opts: any) => {
				overlayOptionsFn = opts?.overlayOptions;
				return new Promise<void>((resolveDone) => {
					overlayComponent = factory(fakeTui, theme, {}, () => {
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
		registerCommand: (name: string, def: { handler: (args: string, ctx: any) => Promise<void> }) => {
			commands.set(name, def.handler);
		},
	} as any;

	youShouldKnow(pi);

	const emit = async (event: string, payload: any = {}) => {
		for (const h of handlers.get(event) ?? []) {
			await h(payload, ctx);
		}
	};

	const readLog = () => {
		const p = join(dir, "you-should-know.log");
		if (!existsSync(p)) return [];
		return readFileSync(p, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l));
	};

	const readStore = () => JSON.parse(readFileSync(join(dir, "you-should-know.json"), "utf8"));
	const writeStore = (data: Record<string, unknown>) =>
		writeFileSync(join(dir, "you-should-know.json"), `${JSON.stringify(data, null, 2)}\n`);

	const renderWidget = (width = 120) => (widgetComponent ? widgetComponent.render(width).join("\n") : "");
	const renderOverlay = (width = 80) => (overlayComponent ? overlayComponent.render(width).join("\n") : "");
	const clickChoice = (labelText: string, width = 120) => {
		if (!widgetComponent) return;
		const lines: string[] = widgetComponent.render(width);
		// Find the ChoiceRow child inside the card container that rendered labelText
		for (const child of widgetComponent.children ?? []) {
			for (const sub of child.children ?? [child]) {
				if (typeof sub.handleMouse === "function") {
					const subLines: string[] = sub.render(width);
					for (let y = 0; y < subLines.length; y++) {
						const x = subLines[y].indexOf(labelText);
						if (x !== -1) {
							sub.handleMouse({ button: "left", type: "press", x, y });
							sub.handleMouse({ button: "left", type: "click", x, y });
							return;
						}
					}
				}
			}
		}
		void lines;
	};

	const flush = () => new Promise((r) => setTimeout(r, 15));

	return {
		dir,
		ctx,
		emit,
		commands,
		notifications,
		streamCalls,
		readLog,
		readStore,
		writeStore,
		renderWidget,
		renderOverlay,
		clickChoice,
		getOverlayOptions: () => overlayOptionsFn?.(),
		getOverlay: () => overlayComponent,
		getWidget: () => widgetComponent,
		pressKey: (key: string) => inputListener?.(key),
		setEditorText: (t: string) => {
			editorText = t;
		},
		getEditorText: () => editorText,
		newSession: async () => {
			await emit("session_shutdown");
			sm = SessionManager.inMemory("/tmp");
			ctx.sessionManager = sm;
			await emit("session_start");
		},
		addTurn: (userText: string, assistantText: string, toolOutput?: string) => {
			sm.appendMessage({ role: "user", content: [{ type: "text", text: userText }], timestamp: Date.now() });
			if (toolOutput !== undefined) {
				sm.appendMessage({
					role: "assistant",
					content: [{ type: "toolCall", id: "tc1", name: "bash", arguments: { command: "echo hi".repeat(100) } }],
					timestamp: Date.now(),
				} as any);
				sm.appendMessage({
					role: "toolResult",
					toolCallId: "tc1",
					toolName: "bash",
					content: [{ type: "text", text: toolOutput }],
					timestamp: Date.now(),
				} as any);
			}
			sm.appendMessage({ role: "assistant", content: [{ type: "text", text: assistantText }], timestamp: Date.now() });
		},
		flush,
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

test("1. checks run only at steps 6 and 12 (1-based) and survive mid-prompt retry agent_start", async () => {
	const h = createHarness();
	cleanupFn = h.cleanup;
	await h.emit("session_start");
	h.addTurn("do work", "working");

	await h.emit("before_agent_start");
	await h.emit("agent_start");
	for (let i = 1; i <= 4; i++) await h.emit("turn_end", { turnIndex: i - 1 });
	// Simulate an auto-compaction / retry loop within the same prompt:
	await h.emit("agent_start");
	for (let i = 5; i <= 13; i++) await h.emit("turn_end", { turnIndex: i - 5 });
	await h.emit("agent_settled");
	await h.flush();

	const checks = h.readLog().filter((e) => e.event === "check");
	assert.deepEqual(
		checks.map((c) => ({ step: c.step, outcome: c.outcome })),
		[
			{ step: 6, outcome: "none" },
			{ step: 12, outcome: "none" },
		],
	);
});

test("2-4. card choices: Knew this already dedupes, What is this toggles, Learn more & Chat in main session", async () => {
	let n = 0;
	const h = createHarness({
		onStream: async () => {
			n++;
			if (n <= 2) {
				return {
					text: "learn: SQLite WAL mode keeps readers unblocked.\ntag: Heads up\nexplain:\n**Readers do not block**\nExplanation text.",
				};
			}
			return {
				text: "learn: Another distinct note.\ntag: You should know\nexplain:\n**Second title**\nSecond body.",
			};
		},
	});
	cleanupFn = h.cleanup;
	await h.emit("session_start");
	h.addTurn("setup db", "done");

	// Run 1 -> offer at step 6
	await h.emit("before_agent_start");
	for (let i = 1; i <= 6; i++) await h.emit("turn_end", { turnIndex: i - 1 });
	await h.flush();
	assert.match(h.renderWidget(), /Heads up · SQLite WAL mode keeps readers unblocked\./);

	// Press 3 -> toggle What is this / Return to topic
	h.pressKey("3");
	assert.match(h.renderWidget(), /Return to topic/);
	h.pressKey("3");
	assert.match(h.renderWidget(), /What is this/);

	// Press 2 -> Knew this already (adds to known)
	h.pressKey("2");
	assert.equal(h.readStore().known.length, 1);

	// Run 2 -> same note is deduped
	await h.emit("input", { source: "user" });
	await h.emit("before_agent_start");
	for (let i = 1; i <= 6; i++) await h.emit("turn_end", { turnIndex: i - 1 });
	await h.flush();
	const lastCheck = h.readLog().filter((e) => e.event === "check").at(-1);
	assert.equal(lastCheck.outcome, "deduped");

	// Run 3 -> new note, press 1 (Learn more), then press 2 (Chat in main session)
	await h.emit("input", { source: "user" });
	await h.emit("before_agent_start");
	for (let i = 1; i <= 6; i++) await h.emit("turn_end", { turnIndex: i - 1 });
	await h.flush();
	h.pressKey("1");
	assert.match(h.renderWidget(), /Chat in main session/);

	// With non-empty editor, key "2" is not intercepted, and clicking "Chat in main session" warns
	h.setEditorText("draft prompt");
	assert.equal(h.pressKey("2"), undefined);
	h.clickChoice("Chat in main session");
	assert.equal(h.notifications.at(-1)?.level, "warning");
	assert.equal(h.getEditorText(), "draft prompt");

	// Clear editor and press 2 -> quotes note into editor
	h.setEditorText("");
	h.pressKey("2");
	assert.match(h.getEditorText(), /^Here is a note offered by a side agent:/);
});

test("6-7. typing past 3 offers backs off checks; pressing 4 twice disables checks", async () => {
	let n = 0;
	const h = createHarness({
		onStream: async () => ({
			text: `learn: Unique note number ${++n} for backoff.\ntag: Heads up\nexplain:\n**Title**\nBody.`,
		}),
	});
	cleanupFn = h.cleanup;
	await h.emit("session_start");
	h.addTurn("work", "done");

	for (let offer = 1; offer <= 3; offer++) {
		await h.emit("before_agent_start");
		for (let i = 1; i <= 6; i++) await h.emit("turn_end", { turnIndex: i - 1 });
		await h.flush();
		// Extension input does not count as typing past
		await h.emit("input", { source: "extension" });
		// First user prompt survives
		await h.emit("input", { source: "user" });
		assert.match(h.renderWidget(), /Unique note number/);
		// Second user prompt clears it and counts as typed past
		await h.emit("input", { source: "user" });
	}

	assert.equal(h.readStore().typedPastInARow, 3);
	assert.equal(h.readStore().looksToSkip, 1);

	// Next check at step 6 logs "backing off" and decrements looksToSkip to 0
	await h.emit("before_agent_start");
	for (let i = 1; i <= 6; i++) await h.emit("turn_end", { turnIndex: i - 1 });
	const skip = h.readLog().filter((e) => e.event === "skip").at(-1);
	assert.equal(skip.reason, "backing off");
	assert.equal(h.readStore().looksToSkip, 0);

	// Step 12 in the same prompt now runs a check and shows an offer
	for (let i = 7; i <= 12; i++) await h.emit("turn_end", { turnIndex: i - 1 });
	await h.flush();
	assert.match(h.renderWidget(), /Disable/);

	// Press 4 twice to disable
	h.pressKey("4");
	assert.match(h.renderWidget(), /Press again to disable/);
	h.pressKey("4");
	assert.equal(h.readStore().enabled, false);

	// Next run logs disabled
	await h.emit("input", { source: "user" });
	await h.emit("before_agent_start");
	for (let i = 1; i <= 6; i++) await h.emit("turn_end", { turnIndex: i - 1 });
	assert.equal(h.readLog().filter((e) => e.event === "skip").at(-1).reason, "disabled");
});

test("8. long tool output is cut at both ends and payload directory is capped at 100 files", async () => {
	const h = createHarness();
	cleanupFn = h.cleanup;
	await h.emit("session_start");

	// Pre-populate 105 old payload files
	const payloadDir = join(h.dir, "you-should-know-payloads");
	mkdirSync(payloadDir, { recursive: true });
	for (let i = 0; i < 105; i++) {
		const p = join(payloadDir, `old-${i}.txt`);
		writeFileSync(p, "old");
		const t = new Date(Date.now() - (200 - i) * 1000);
		utimesSync(p, t, t);
	}

	const longOutput = `START_MARKER_${"x".repeat(2000)}_END_MARKER`;
	h.addTurn("long steps 6", "done", longOutput);

	await h.emit("before_agent_start");
	for (let i = 1; i <= 6; i++) await h.emit("turn_end", { turnIndex: i - 1 });
	await h.flush();

	const checkEntry = h.readLog().find((e) => e.event === "check");
	assert.ok(checkEntry?.payload);
	const payloadText = readFileSync(checkEntry.payload, "utf8");
	assert.match(payloadText, /START_MARKER_.*…\[\d+ chars cut\]….*_END_MARKER/);
	assert.equal(readdirSync(payloadDir).filter((f) => f.endsWith(".txt")).length, 100);
});

test("stale check across prompts: a slow check from a previous prompt logs stale and does not show", async () => {
	let resolveSlow!: (v: { text: string }) => void;
	const h = createHarness({
		onStream: () =>
			new Promise((r) => {
				resolveSlow = r;
			}),
	});
	cleanupFn = h.cleanup;
	await h.emit("session_start");
	h.addTurn("first prompt", "working");

	await h.emit("before_agent_start");
	for (let i = 1; i <= 6; i++) await h.emit("turn_end", { turnIndex: i - 1 });

	// User starts a new prompt before the check finishes
	await h.emit("input", { source: "user" });
	await h.emit("before_agent_start");

	resolveSlow({ text: "learn: Late note from old prompt.\ntag: Heads up\nexplain:\n**Late**\nBody." });
	await h.flush();

	const checkEntry = h.readLog().find((e) => e.event === "check");
	assert.equal(checkEntry.outcome, "stale");
	assert.doesNotMatch(h.renderWidget(), /Late note from old prompt/);
});

test("9-13. retell: empty session, caching, prompt override invalidation, live settings, and mode switch while busy", async () => {
	let slowMode: string | null = null;
	let retellCount = 0;
	const h = createHarness({
		columns: 100,
		onStream: async (_model, context) => {
			const blob = JSON.stringify(context);
			if (blob.includes("Retell only what is in the transcript")) {
				retellCount++;
				const mode = blob.includes("has lost track") ? "lost" : "plain";
				if (slowMode === mode) await new Promise((r) => setTimeout(r, 80));
				const override = blob.includes("OVERRIDE-MARKER") ? " (override)" : "";
				return { text: `**Faux ${mode} retell ${retellCount}${override}**\n\nBody line.` };
			}
			return { text: "learn: Unique note.\ntag: Heads up\nexplain:\n**Title**\nBody." };
		},
	});
	cleanupFn = h.cleanup;
	await h.emit("session_start");

	// Empty session retell does not call the model
	await h.commands.get("plain")!("", h.ctx);
	await h.flush();
	assert.equal(retellCount, 0);
	assert.match(h.renderOverlay(), /Nothing in the session to retell yet\./);

	// Add conversation and run /plain -> calls model, then second /plain hits cache
	h.addTurn("explain how this works", "it works like this");
	await h.commands.get("plain")!("", h.ctx);
	await h.flush();
	assert.equal(retellCount, 1);
	assert.match(h.renderOverlay(), /Faux plain retell 1/);

	await h.commands.get("plain")!("", h.ctx);
	await h.flush();
	assert.equal(retellCount, 1);
	assert.match(h.renderOverlay(), /cache hit/);

	// Write prompt override for lost.md -> takes effect immediately without needing a new prompt
	await h.commands.get("lost")!("", h.ctx);
	await h.flush();
	assert.equal(retellCount, 2);
	assert.doesNotMatch(h.renderOverlay(), /\(override\)/);

	const promptsDir = join(h.dir, "you-should-know-prompts");
	mkdirSync(promptsDir, { recursive: true });
	writeFileSync(join(promptsDir, "lost.md"), "The person has lost track. OVERRIDE-MARKER");
	await h.commands.get("lost")!("", h.ctx);
	await h.flush();
	assert.equal(retellCount, 3);
	assert.match(h.renderOverlay(), /Faux lost retell 3 \(override\)/);

	// Live settings edit on disk (without /new) is picked up and not overwritten when state saves
	h.writeStore({ model: "faux/faux-2", yskModel: "missing/model", buttons: false });
	await h.emit("before_agent_start");
	for (let i = 1; i <= 6; i++) await h.emit("turn_end", { turnIndex: i - 1 });
	await h.flush();
	assert.equal(h.readStore().model, "faux/faux-2");
	assert.equal(h.readStore().buttons, false);
	assert.ok(h.notifications.some((n) => n.text.includes('model "missing/model" not found')));

	// At 100 columns (< 120), overlay is full width at bottom-center
	assert.deepEqual(h.getOverlayOptions(), {
		anchor: "bottom-center",
		width: "100%",
		maxHeight: "60%",
		margin: { bottom: 6 },
	});

	// Slow retell: pressing same mode (/lost) does not start a second call; pressing /plain switches
	h.addTurn("another turn", "another answer");
	slowMode = "lost";
	void h.commands.get("lost")!("", h.ctx);
	await new Promise((r) => setTimeout(r, 10));
	assert.equal(retellCount, 4);
	// Same mode while busy -> no new call
	void h.commands.get("lost")!("", h.ctx);
	await new Promise((r) => setTimeout(r, 10));
	assert.equal(retellCount, 4);
	// Other mode while busy -> aborts /lost and starts /plain
	await h.commands.get("plain")!("", h.ctx);
	await new Promise((r) => setTimeout(r, 100));
	assert.equal(retellCount, 5);
	assert.match(h.renderOverlay(), /Faux plain retell 5/);
});

test("Hovering a widget button highlights it, and only one component is highlighted at a time", async () => {
	const { EL, h: el } = await import("../extensions/prismantis/core/jsx.ts");
	const { PrismantisComponent } = await import("../extensions/prismantis/renderer.ts");
	const { clearHover } = await import("../extensions/lib/pointer-hover.ts");
	const INVERSE = "\x1b[7m";
	const h = createHarness();
	await h.emit("session_start");
	const row = h.getWidget().children.find((c: any) => typeof c.handleMouse === "function");
	const rendered = row.render(120) as string[];
	const x = rendered[0].indexOf("[Plain words]");
	assert.ok(x >= 0, "the widget shows the Plain words button");
	assert.ok(!rendered.join("").includes(INVERSE), "no highlight before any pointer move");

	const move = (x: number, y: number) => ({ button: "none", type: "move", x, y });
	assert.deepEqual(row.handleMouse(move(x + 2, 0)), { handled: true, render: true });
	const lit = row.render(120)[0] as string;
	assert.ok(lit.includes(`${INVERSE}[Plain words]`), "the hovered button is inverse");
	assert.ok(!lit.includes(`${INVERSE}[Lost track]`), "the other button is not");
	assert.equal(row.handleMouse(move(x + 3, 0)), undefined, "moving within the same button changes nothing");

	assert.deepEqual(row.handleMouse(move(119, 0)), { handled: true, render: true });
	assert.ok(!row.render(120).join("").includes(INVERSE), "moving to empty space clears the highlight");

	const tree = el(EL.Box, { flexDirection: "column" }, el(EL.Button, { variant: "secondary", label: "⧉ source", onPress: () => {} }));
	const prism = new PrismantisComponent(() => tree);
	prism.render(40);
	row.handleMouse(move(x + 2, 0));
	assert.deepEqual(prism.handleMouse(move(3, 0)), { handled: true, render: true });
	assert.ok(!row.render(120).join("").includes(INVERSE), "entering a prismantis button clears the widget button");
	assert.ok(prism.render(40).join("").includes(INVERSE), "the prismantis button is highlighted");
	row.handleMouse(move(x + 2, 0));
	assert.ok(!prism.render(40).join("").includes(INVERSE), "entering a widget button clears the prismantis button");
	assert.ok(row.render(120).join("").includes(`${INVERSE}[Plain words]`));
	clearHover();
});
