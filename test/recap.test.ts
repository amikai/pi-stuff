import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
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

const { initTheme, SessionManager } = await import("@earendil-works/pi-coding-agent");
initTheme();

const {
	default: recapExtension,
	delayFor,
	estimateTokens,
	fingerprintOf,
	formatRecapLine,
	isCacheStale,
	parseReply,
	readRecord,
	recapInput,
	RECAP_IDLE_MS,
	RECAP_MAX_TOKENS,
	RECAP_PROMPT,
} = await import("../extensions/recap/index.ts");

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => `**${text}**`,
} as any;

function createHarness(options?: {
	onStream?: (model: any, context: any, opts: any) => Promise<{ text?: string; stopReason?: string; errorMessage?: string }>;
	thinkingLevel?: string;
	initialSettings?: { enabled?: boolean; model?: string };
	agentDir?: string;
	sessionId?: string;
}) {
	const dir = options?.agentDir ?? mkdtempSync(join(tmpdir(), "recap-unit-"));
	process.env.PI_CODING_AGENT_DIR = dir;

	if (options?.initialSettings) {
		writeFileSync(
			join(dir, "recap.json"),
			JSON.stringify({ enabled: true, model: "", ...options.initialSettings }, null, 2),
		);
	}

	const handlers = new Map<string, ((...args: any[]) => any)[]>();
	const commands = new Map<string, (args: string, ctx: any) => Promise<void>>();
	const notifications: { text: string; level: string }[] = [];
	const streamCalls: {
		model: string;
		systemPrompt?: string;
		messages: any[];
		opts: any;
	}[] = [];

	let editorText = "";
	let widgetComponent: any = null;

	const fakeTui = {
		terminal: { columns: 120, rows: 40 },
		requestRender: () => {},
	} as any;

	const models = new Map([
		["faux/faux-1", { provider: "faux", id: "faux-1", promptCache: { short: 300 } }],
		["faux/faux-2", { provider: "faux", id: "faux-2", promptCache: { short: 300 } }],
	]);

	const sm = SessionManager.inMemory("/tmp");
	if (options?.sessionId) {
		sm.getSessionId = () => options.sessionId!;
	}

	const ctx = {
		mode: "tui",
		model: models.get("faux/faux-1"),
		thinkingLevel: options?.thinkingLevel ?? "off",
		sessionManager: sm,
		modelRegistry: {
			find: (provider: string, id: string) => models.get(`${provider}/${id}`),
			hasConfiguredAuth: () => true,
			streamSimple: (model: any, context: any, opts: any) => ({
				result: async () => {
					streamCalls.push({
						model: `${model.provider}/${model.id}`,
						systemPrompt: context.systemPrompt,
						messages: context.messages,
						opts,
					});
					const custom = options?.onStream
						? await options.onStream(model, context, opts)
						: {
								text: "goal: Test objective\nnow: Running tests\nnext: Check results\nwaiting: no",
								stopReason: "stop",
							};
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
			getEditorText: () => editorText,
			setEditorText: (text: string) => {
				editorText = text;
			},
			notify: (text: string, level: string) => {
				notifications.push({ text, level });
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

	recapExtension(pi);

	const emit = async (event: string, payload: any = {}) => {
		for (const h of handlers.get(event) ?? []) {
			await h(payload, ctx);
		}
	};

	const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));

	return {
		dir,
		ctx,
		sm,
		emit,
		commands,
		notifications,
		streamCalls,
		getWidget: () => widgetComponent,
		renderWidget: (width = 120) => (widgetComponent ? widgetComponent.render(width).join("\n") : ""),
		setEditorText: (t: string) => {
			editorText = t;
		},
		flush,
	};
}

test("delayFor calculates initial idle delay and minimum 60s gap", () => {
	assert.equal(delayFor(1000, null), RECAP_IDLE_MS);
	assert.equal(delayFor(10_000, 0), 50_000);
	assert.equal(delayFor(100_000, 0), RECAP_IDLE_MS);
});

test("estimateTokens accounts for CJK and ASCII characters", () => {
	assert.equal(estimateTokens("你好"), 2);
	assert.equal(estimateTokens("abcdef"), 2);
	assert.equal(estimateTokens("你好abc"), 3);
	assert.equal(estimateTokens(""), 0);
});

test("fingerprintOf detects changes in messages count, role, content and tools", () => {
	assert.equal(fingerprintOf([]), "");
	const m1 = [{ role: "user", content: [{ type: "text", text: "hello" }] }];
	const fp1 = fingerprintOf(m1);
	assert.ok(fp1.startsWith("1:user:"));

	const m2 = [...m1, { role: "assistant", content: [{ type: "text", text: "hi there" }] }];
	assert.notEqual(fingerprintOf(m2), fp1);

	const m3 = [
		...m1,
		{
			role: "assistant",
			content: [
				{ type: "text", text: "hi there" },
				{ type: "toolCall", name: "bash", arguments: {} },
			],
		},
	];
	assert.notEqual(fingerprintOf(m3), fingerprintOf(m2));
});

test("isCacheStale guards against TTL expiration at 90%", () => {
	const model = { promptCache: { short: 300 } };
	assert.equal(isCacheStale(model, null), false);
	const now = 1_000_000;
	assert.equal(isCacheStale(model, now - 260_000, now), false);
	assert.equal(isCacheStale(model, now - 275_000, now), true);
});

test("parseReply parses plain text lines with tolerant stripping of bold, bullets, quotes and case", () => {
	const reply = `
- **goal:** "Build the recap extension"
* **now:** Testing parseReply tolerance
- **next:** 'Run the unit test suite'
**waiting:** yes
`;
	const parsed = parseReply(reply);
	assert.deepEqual(parsed, {
		goal: "Build the recap extension",
		now: "Testing parseReply tolerance",
		next: "Run the unit test suite",
		waiting: true,
	});

	assert.equal(parseReply("now: working\nwaiting: true")?.waiting, true);
	assert.equal(parseReply("now: working\nwaiting: no")?.waiting, false);
	assert.equal(parseReply("now: working\nwaiting: false")?.waiting, false);
	assert.equal(parseReply("waiting: yes"), null);
	assert.equal(parseReply("invalid garbage reply"), null);
});

test("recapInput produces 30% user messages and 70% recent tail within budget", () => {
	const messages = [
		{ role: "user", content: [{ type: "text", text: "User prompt 1" }] },
		{ role: "assistant", content: [{ type: "text", text: "Assistant reply 1" }] },
		{ role: "user", content: [{ type: "text", text: "User prompt 2" }] },
		{ role: "assistant", content: [{ type: "text", text: "Assistant reply 2" }] },
	];
	const input = recapInput(messages, 5000);
	assert.ok(input.includes("<user_messages>"));
	assert.ok(input.includes("- User prompt 1"));
	assert.ok(input.includes("- User prompt 2"));
	assert.ok(input.includes("</user_messages>"));
	assert.ok(input.includes("<recent>"));
	assert.ok(input.includes("User: User prompt 2"));
	assert.ok(input.includes("Assistant: Assistant reply 2"));
	assert.ok(input.includes("</recent>"));
});

test("formatRecapLine formats single-line recap above prompt with waiting indicator", () => {
	const lineNo = formatRecapLine(theme, {
		goal: "Build recap extension",
		now: "Writing tests",
		next: "Verify suite",
		waiting: false,
	});
	assert.ok(lineNo.includes("✦ **recap: **Build recap extension · Writing tests → Verify suite"));

	const lineYes = formatRecapLine(theme, {
		goal: "Build recap extension",
		now: "Waiting for user input",
		next: "You confirm approach",
		waiting: true,
	});
	assert.ok(lineYes.includes("✦ **recap (waiting): **Build recap extension · Waiting for user input → You confirm approach"));
});

test("same-model path preserves LLM message prefix, passes sessionId and transport sse without systemPrompt", async () => {
	const h = createHarness({ thinkingLevel: "high" });
	await h.emit("session_start");

	const turn1Messages = [
		{ role: "system", content: "You are a coding assistant" },
		{ role: "user", content: [{ type: "text", text: "Initial user request" }] },
	];

	await h.emit("context_with_system", { messages: turn1Messages });
	await h.emit("turn_end", {
		message: { role: "assistant", content: [{ type: "text", text: "Assistant first reply" }] },
	});

	await h.commands.get("recap")!("", h.ctx);
	await h.flush();

	assert.equal(h.streamCalls.length, 1);
	const call = h.streamCalls[0];

	assert.equal(call.systemPrompt, undefined);
	assert.equal(call.messages.length, 4);
	assert.equal(call.messages[0].role, "system");
	assert.equal(call.messages[1].role, "user");
	assert.equal(call.messages[2].role, "assistant");
	assert.equal(call.messages[3].role, "user");
	assert.equal(call.messages[3].content[0].text, RECAP_PROMPT);
	assert.equal(call.opts.sessionId, h.sm.getSessionId());
	assert.equal(call.opts.transport, "sse");
	assert.equal(call.opts.reasoning, "low");
	assert.equal(call.opts.maxTokens, RECAP_MAX_TOKENS);
	assert.equal(call.opts.cacheRetention, undefined);

	assert.ok(h.getWidget() !== null);
	assert.ok(h.renderWidget().includes("Test objective · Running tests → Check results"));

	await h.commands.get("recap")!("hide", h.ctx);
	assert.equal(h.getWidget(), null);
});

test("cross-model path uses 5000-token slice with systemPrompt and cacheRetention none", async () => {
	const h = createHarness({
		initialSettings: { enabled: true, model: "faux/faux-2" },
	});
	await h.emit("session_start");

	const turnMessages = [
		{ role: "system", content: "System prompt" },
		{ role: "user", content: [{ type: "text", text: "Long prompt ".repeat(20) }] },
	];
	await h.emit("context_with_system", { messages: turnMessages });
	await h.emit("turn_end", {
		message: { role: "assistant", content: [{ type: "text", text: "Long reply ".repeat(20) }] },
	});

	await h.commands.get("recap")!("", h.ctx);
	await h.flush();

	assert.equal(h.streamCalls.length, 1);
	const call = h.streamCalls[0];

	assert.equal(call.model, "faux/faux-2");
	assert.equal(call.systemPrompt, RECAP_PROMPT);
	assert.equal(call.opts.cacheRetention, "none");
	assert.equal(call.messages.length, 1);
	assert.equal(call.messages[0].role, "user");
	assert.ok(call.messages[0].content[0].text.includes("<user_messages>"));
	assert.ok(call.messages[0].content[0].text.includes("<recent>"));
});

test("draft text in editor skips automatic recap", async () => {
	const h = createHarness();
	await h.emit("session_start");
	h.setEditorText("drafting a message...");

	await h.emit("agent_settled");
	await h.flush(10);

	assert.equal(h.streamCalls.length, 0);
	assert.equal(h.getWidget(), null);
});

test("disabled recap skips side call and clears widget", async () => {
	const h = createHarness({ initialSettings: { enabled: false } });
	await h.emit("session_start");

	await h.emit("agent_settled");
	await h.flush(10);
	assert.equal(h.streamCalls.length, 0);

	await h.commands.get("recap")!("on", h.ctx);
	assert.ok(h.notifications.some((n) => n.text.includes("Recap is on")));

	await h.commands.get("recap")!("off", h.ctx);
	assert.ok(h.notifications.some((n) => n.text.includes("Recap is off")));
	assert.equal(h.getWidget(), null);
});

test("fingerprint unchanged skips automatic rerun", async () => {
	const h = createHarness();
	await h.emit("session_start");

	const turn = [
		{ role: "system", content: "system" },
		{ role: "user", content: [{ type: "text", text: "hello" }] },
	];
	await h.emit("context_with_system", { messages: turn });
	await h.emit("turn_end", {
		message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
	});

	await h.commands.get("recap")!("", h.ctx);
	await h.flush();
	assert.equal(h.streamCalls.length, 1);

	await h.emit("agent_settled");
	await h.flush(10);
	assert.equal(h.streamCalls.length, 1);
});

test("new agent or turn start cancels pending timers and in-flight calls", async () => {
	let streamStarted = false;
	const h = createHarness({
		onStream: async (_m, _c, opts) => {
			streamStarted = true;
			return new Promise((resolve) => {
				opts.signal?.addEventListener("abort", () => {
					resolve({ stopReason: "aborted" });
				});
			});
		},
	});
	await h.emit("session_start");
	await h.emit("context_with_system", {
		messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
	});
	await h.emit("turn_end", {
		message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
	});

	void h.commands.get("recap")!("", h.ctx);
	await h.flush(15);
	assert.equal(streamStarted, true);

	await h.emit("turn_start");
	await h.flush(15);

	assert.equal(readRecord(h.sm.getSessionId()), null);
});

test("session record persists and restores on session_start, and empty session skips recap", async () => {
	const h = createHarness();
	await h.emit("session_start");

	await h.commands.get("recap")!("now", h.ctx);
	await h.flush();
	assert.equal(h.streamCalls.length, 0);
	assert.ok(h.notifications.some((n) => n.text.includes("Nothing in the session")));

	await h.emit("context_with_system", {
		messages: [{ role: "user", content: [{ type: "text", text: "start task" }] }],
	});
	await h.emit("turn_end", {
		message: { role: "assistant", content: [{ type: "text", text: "working on it" }] },
	});

	await h.commands.get("recap")!("now", h.ctx);
	await h.flush();

	const record = readRecord(h.sm.getSessionId());
	assert.ok(record !== null);
	assert.equal(record.goal, "Test objective");
	assert.equal(record.now, "Running tests");

	const h2 = createHarness({ agentDir: h.dir, sessionId: h.sm.getSessionId() });
	await h2.emit("session_start");
	assert.ok(h2.getWidget() !== null);
	assert.ok(h2.renderWidget().includes("Test objective · Running tests → Check results"));

	await h2.emit("input", { source: "user" });
	assert.equal(h2.getWidget(), null);
});
