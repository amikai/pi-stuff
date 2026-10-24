/**
 * Recap — shows an at-a-glance session status summary above the prompt editor
 * when the agent settles, sharing the main session's prompt-cache prefix.
 *
 * Files under <agentDir>:
 *   recap.json              settings (enabled, model override)
 *   recap/<sessionId>.json  latest recap record for the session
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { buildSessionContext, convertToLlm, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";

const WIDGET = "recap";
const STAR = "✦";
const DOT = "·";

export const RECAP_IDLE_MS = 5_000;
export const RECAP_MIN_GAP_MS = 60_000;
export const RECAP_MAX_TOKENS = 1_500;
export const RECAP_INPUT_BUDGET = 5_000;
export const RECAP_USER_SHARE = 0.3;

export const RECAP_PROMPT =
	"Summarize where this coding-agent session stands. Output exactly four lines, no markdown, no extra text:\n\n" +
	"goal: <overall objective of the session, under 15 words>\n" +
	"now: <what is happening right now or what it is waiting on, under 15 words>\n" +
	"next: <the one next action and who takes it, under 15 words>\n" +
	"waiting: <yes | no>\n\n" +
	'"goal" is the overall objective of the whole session at the project/problem level.\n' +
	'"now" is what is happening right now or what it is waiting on.\n' +
	'"next" is the one next action and who takes it.\n' +
	'"waiting" is "yes" only when the assistant\'s latest reply asks the user to choose, approve, answer a question, or perform a specific action before work can continue; "no" otherwise.\n' +
	"Items listed as not done, unverified, or out of scope are limitations, not current work.\n" +
	'Refer to the assistant in the first person ("I") and to the user in the second person ("you").\n' +
	"Write the values in the same language as the conversation; Chinese means Traditional Chinese (繁體中文), never Simplified.\n" +
	"Skip root-cause narrative, fix internals, secondary to-dos, and tangents.\n" +
	"Do not call any tools. Output only the four plain-text lines.";

export type RecapFields = {
	goal: string;
	now: string;
	next: string;
	waiting: boolean;
};

export type RecapRecord = RecapFields & {
	version: 1;
	sessionId: string;
	at: number;
	model: string;
	fingerprint: string;
};

export type RecapSettings = {
	enabled: boolean;
	model: string;
};

export type RecapState =
	| { phase: "idle" }
	| { phase: "scheduled"; timer: ReturnType<typeof setTimeout>; scheduledAt: number }
	| { phase: "running"; controller: AbortController; startedAt: number }
	| { phase: "done"; record: RecapRecord; shownAt: number }
	| { phase: "error"; message: string };

export type RecapReply =
	| { ok: true; fields: RecapFields; model: string }
	| {
			ok: false;
			reason: "aborted" | "no_model" | "no_auth" | "cache_stale" | "api_error" | "parse_failed";
			detail?: string;
	  };

const settingsPath = () => join(getAgentDir(), "recap.json");
const sessionRecordPath = (sessionId: string) => join(getAgentDir(), "recap", `${sessionId}.json`);

const SETTINGS_DEFAULTS: RecapSettings = { enabled: true, model: "" };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadSettings(): RecapSettings {
	try {
		const raw: unknown = JSON.parse(readFileSync(settingsPath(), "utf8"));
		if (!isRecord(raw)) return { ...SETTINGS_DEFAULTS };
		return {
			enabled: raw.enabled !== false,
			model: typeof raw.model === "string" ? raw.model : "",
		};
	} catch {
		return { ...SETTINGS_DEFAULTS };
	}
}

export function writeRecord(record: RecapRecord): void {
	if (!/^[A-Za-z0-9-]+$/.test(record.sessionId)) return;
	try {
		const dir = join(getAgentDir(), "recap");
		mkdirSync(dir, { recursive: true });
		writeFileSync(sessionRecordPath(record.sessionId), `${JSON.stringify(record, null, 2)}\n`);
	} catch {
		// The overlay still shows the in-memory record.
	}
}

export function readRecord(sessionId: string): RecapRecord | null {
	if (!/^[A-Za-z0-9-]+$/.test(sessionId)) return null;
	try {
		const raw: unknown = JSON.parse(readFileSync(sessionRecordPath(sessionId), "utf8"));
		if (
			!isRecord(raw) ||
			raw.version !== 1 ||
			typeof raw.sessionId !== "string" ||
			typeof raw.at !== "number" ||
			typeof raw.model !== "string" ||
			typeof raw.fingerprint !== "string" ||
			typeof raw.goal !== "string" ||
			typeof raw.now !== "string" ||
			typeof raw.next !== "string" ||
			typeof raw.waiting !== "boolean"
		) {
			return null;
		}
		return {
			version: 1,
			sessionId: raw.sessionId,
			at: raw.at,
			model: raw.model,
			fingerprint: raw.fingerprint,
			goal: raw.goal,
			now: raw.now,
			next: raw.next,
			waiting: raw.waiting,
		};
	} catch {
		return null;
	}
}

export function delayFor(now: number, lastRunAt: number | null): number {
	if (lastRunAt === null) return RECAP_IDLE_MS;
	return Math.max(RECAP_IDLE_MS, lastRunAt + RECAP_MIN_GAP_MS - now);
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part: unknown) => {
			if (isRecord(part) && part.type === "text" && typeof part.text === "string") return part.text;
			return "";
		})
		.filter((s) => s !== "")
		.join("\n");
}

export function fingerprintOf(messages: unknown[]): string {
	if (!Array.isArray(messages) || messages.length === 0) return "";
	const last = messages.at(-1);
	if (!isRecord(last)) return "";
	const role = typeof last.role === "string" ? last.role : "";
	const contentLen =
		typeof last.text === "string"
			? last.text.length
			: typeof last.content === "string"
				? last.content.length
				: Array.isArray(last.content)
					? textOf(last.content).length
					: 0;
	const toolCount = Array.isArray(last.toolUses)
		? last.toolUses.length
		: Array.isArray(last.tool_calls)
			? last.tool_calls.length
			: Array.isArray(last.content)
				? last.content.filter((p) => isRecord(p) && p.type === "toolCall").length
				: 0;
	return `${messages.length}:${role}:${contentLen}:${toolCount}`;
}

export function isCacheStale(
	model: { promptCache?: { short?: number } } | undefined,
	lastTurnEndAt: number | null,
	now = Date.now(),
): boolean {
	if (lastTurnEndAt === null) return false;
	const ttlMs = (model?.promptCache?.short ?? 300) * 1000;
	return now - lastTurnEndAt > ttlMs * 0.9;
}

export function estimateTokens(text: string): number {
	let cjk = 0;
	for (const ch of text) {
		if (/[　-鿿가-힯＀-￯]/.test(ch)) cjk += 1;
	}
	return cjk + Math.ceil((text.length - cjk) / 3);
}

const cleanText = (text: string) => text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "").trim();
const clip = (text: string, max: number) => (text.length <= max ? text : text.slice(0, max));

function extractMessage(m: unknown): {
	role: string;
	text: string;
	toolCalls: { name: string; args?: unknown }[];
	isToolResult: boolean;
} {
	if (!isRecord(m)) return { role: "", text: "", toolCalls: [], isToolResult: false };
	const role = typeof m.role === "string" ? m.role : "";
	let text = "";
	const toolCalls: { name: string; args?: unknown }[] = [];
	const isToolResult =
		role === "toolResult" || (role === "user" && Array.isArray(m.toolResults) && m.toolResults.length > 0);

	if (typeof m.text === "string") {
		text = m.text;
	} else if (m.content !== undefined) {
		text = textOf(m.content);
	}

	if (Array.isArray(m.toolUses)) {
		for (const u of m.toolUses) {
			if (isRecord(u)) {
				const name = typeof u.tool === "string" ? u.tool : typeof u.name === "string" ? u.name : "tool";
				toolCalls.push({ name, args: u.text ?? u.arguments });
			}
		}
	} else if (Array.isArray(m.content)) {
		for (const p of m.content) {
			if (isRecord(p) && p.type === "toolCall") {
				toolCalls.push({ name: typeof p.name === "string" ? p.name : "tool", args: p.arguments });
			}
		}
	} else if (Array.isArray(m.tool_calls)) {
		for (const tc of m.tool_calls) {
			if (isRecord(tc) && isRecord(tc.function)) {
				toolCalls.push({
					name: typeof tc.function.name === "string" ? tc.function.name : "tool",
					args: tc.function.arguments,
				});
			}
		}
	}

	return { role, text, toolCalls, isToolResult };
}

const isHumanTurn = (message: unknown) => {
	const { role, text, isToolResult } = extractMessage(message);
	if (role !== "user" || isToolResult) return false;
	const cleaned = cleanText(text);
	return cleaned.length > 0 && !cleaned.startsWith("<task-notification");
};

export function userMessagesWithin(messages: unknown[], budget: number): string {
	const kept: string[] = [];
	let used = 0;
	const human = messages.filter(isHumanTurn);
	for (let i = human.length - 1; i >= 0; i--) {
		const { text } = extractMessage(human[i]);
		const line = `- ${clip(cleanText(text).replace(/\s+/g, " "), 300)}`;
		const cost = estimateTokens(line);
		if (used + cost > budget) break;
		kept.push(line);
		used += cost;
	}
	const omitted = human.length - kept.length;
	return [...(omitted > 0 ? [`(… ${omitted} earlier messages omitted …)`] : []), ...kept.reverse()].join("\n");
}

function lineOf(message: unknown): string {
	const { role, text, toolCalls, isToolResult } = extractMessage(message);
	if (role === "user" && isToolResult) return "";
	if (role === "system") return "";
	const head = role === "user" ? "User" : "Assistant";
	const cleaned = clip(cleanText(text), 3000);
	const tools = toolCalls.map((u) => {
		const argStr = typeof u.args === "string" ? u.args : JSON.stringify(u.args ?? "");
		return `  [${u.name}] ${clip(argStr.replace(/\s+/g, " "), 200)}`;
	});
	return [cleaned.length > 0 ? `${head}: ${cleaned}` : null, ...tools]
		.filter((line): line is string => line !== null)
		.join("\n");
}

export function tailWithin(messages: unknown[], budget: number): string {
	const kept: string[] = [];
	let used = 0;
	for (let i = messages.length - 1; i >= 0; i--) {
		const line = lineOf(messages[i]);
		if (line.length === 0) continue;
		const cost = estimateTokens(line);
		if (used + cost > budget) break;
		kept.push(line);
		used += cost;
	}
	return kept.reverse().join("\n\n");
}

export function recapInput(messages: unknown[], budget = RECAP_INPUT_BUDGET): string {
	const userBudget = Math.floor(budget * RECAP_USER_SHARE);
	return `<user_messages>\n${userMessagesWithin(messages, userBudget)}\n</user_messages>\n\n<recent>\n${tailWithin(messages, budget - userBudget)}\n</recent>`;
}

const LABEL_RE = /^(goal|now|next|waiting)\s*:\s*/i;
const QUOTES: [string, string][] = [
	['"', '"'],
	["'", "'"],
	["“", "”"],
	["‘", "’"],
	["`", "`"],
];

function unquote(text: string): string {
	const t = text.trim();
	const pair = QUOTES.find(([open, close]) => t.length >= 2 && t.startsWith(open) && t.endsWith(close));
	return pair ? t.slice(1, -1).trim() : t;
}

export function parseReply(reply: string): RecapFields | null {
	const fields: Partial<RecapFields> = {};
	for (const raw of reply.split("\n")) {
		const line = raw
			.replace(/^\s*[-*•]\s+/, "")
			.replace(/\*\*(goal|now|next|waiting)(\s*:)?\s*\*\*/gi, "$1$2")
			.trim();
		const m = LABEL_RE.exec(line);
		if (!m) continue;
		const key = m[1].toLowerCase();
		const value = unquote(line.slice(m[0].length).trim());
		if (key === "waiting") {
			fields.waiting = /^(?:yes|true)\b/i.test(value);
		} else if (key === "goal" || key === "now" || key === "next") {
			fields[key] = value;
		}
	}
	if (!fields.now && !fields.goal && !fields.next) return null;
	return {
		goal: fields.goal ?? "",
		now: fields.now ?? "",
		next: fields.next ?? "",
		waiting: fields.waiting ?? false,
	};
}

export function formatRecapLine(theme: Theme, fields: RecapFields): string {
	const star = theme.fg("accent", STAR);
	const label = fields.waiting
		? theme.bold(theme.fg("accent", "recap (waiting): "))
		: theme.bold(theme.fg("dim", "recap: "));
	const progress = [fields.now, fields.next].filter((s) => s !== "").join(" → ");
	const summary = [fields.goal, progress].filter((s) => s !== "").join(` ${DOT} `);
	return `${star} ${label}${theme.fg("dim", summary)}`;
}

export async function runSideCall(
	ctx: ExtensionContext,
	settings: RecapSettings,
	llmMessages: ReturnType<typeof convertToLlm>,
	signal: AbortSignal,
	force: boolean,
	lastTurnEndAt: number | null,
	warnedModels?: Set<string>,
): Promise<RecapReply> {
	let model = ctx.model;
	let isCrossModel = false;
	if (settings.model && settings.model !== "") {
		const at = settings.model.indexOf("/");
		const found =
			at > 0 ? ctx.modelRegistry.find(settings.model.slice(0, at), settings.model.slice(at + 1)) : undefined;
		if (!found) {
			if (!warnedModels?.has(settings.model)) {
				warnedModels?.add(settings.model);
				ctx.ui.notify(`recap: model "${settings.model}" not found; using the session's model.`, "warning");
			}
		} else {
			model = found;
			if (ctx.model && (found.provider !== ctx.model.provider || found.id !== ctx.model.id)) {
				isCrossModel = true;
			}
		}
	}
	if (!model) return { ok: false, reason: "no_model" };
	if (!ctx.modelRegistry.hasConfiguredAuth(model)) return { ok: false, reason: "no_auth" };

	if (!isCrossModel && !force && isCacheStale(model, lastTurnEndAt)) {
		return { ok: false, reason: "cache_stale" };
	}

	const sm = ctx.sessionManager;
	// Keep thinking enabled ("low") only when the main session has thinking on,
	// so Anthropic adaptive-thinking cache prefixes still match without burning
	// high-effort thinking tokens or exhausting maxOutputTokens on Gemini.
	const reasoning = ctx.thinkingLevel === "off" ? undefined : ("low" as const);
	const modelName = `${model.provider}/${model.id}`;

	// Same-model calls omit systemPrompt so normalizeContext does not prepend a
	// second system message and break the main session's cached prefix; transport
	// is pinned to SSE so Codex WebSocket continuation state is untouched.
	const streamResultPromise = !isCrossModel
		? ctx.modelRegistry
				.streamSimple(
					model,
					{
						messages: [
							...llmMessages,
							{
								role: "user" as const,
								content: [{ type: "text" as const, text: RECAP_PROMPT }],
								timestamp: Date.now(),
							},
						],
					},
					{
						signal,
						maxTokens: RECAP_MAX_TOKENS,
						sessionId: sm.getSessionId(),
						transport: "sse" as const,
						reasoning,
					},
				)
				.result()
		: ctx.modelRegistry
				.streamSimple(
					model,
					{
						systemPrompt: RECAP_PROMPT,
						messages: [
							{
								role: "user" as const,
								content: [{ type: "text" as const, text: recapInput(llmMessages, RECAP_INPUT_BUDGET) }],
								timestamp: Date.now(),
							},
						],
					},
					{
						signal,
						maxTokens: RECAP_MAX_TOKENS,
						sessionId: sm.getSessionId(),
						transport: "sse" as const,
						reasoning: "low" as const,
						cacheRetention: "none",
					},
				)
				.result();

	const reply = await streamResultPromise;
	if (reply.stopReason === "error" || reply.stopReason === "aborted") {
		return {
			ok: false,
			reason: reply.stopReason === "aborted" ? "aborted" : "api_error",
			detail: reply.errorMessage ?? undefined,
		};
	}

	const text = reply.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n")
		.trim();

	const fields = parseReply(text);
	if (!fields) {
		return { ok: false, reason: "parse_failed", detail: text.slice(0, 200) };
	}

	return { ok: true, fields, model: modelName };
}

export default function recap(pi: ExtensionAPI): void {
	let settings = loadSettings();
	let state: RecapState = { phase: "idle" };
	let lastRunAt: number | null = null;
	let lastFingerprint = "";
	let lastTurnMessages: Parameters<typeof convertToLlm>[0] | null = null;
	let lastRequestMessages: Parameters<typeof convertToLlm>[0] | null = null;
	let lastTurnEndAt: number | null = null;
	let generation = 0;
	let uiCtx: ExtensionContext | undefined;
	const warnedModels = new Set<string>();

	function render(ctx = uiCtx): void {
		if (!ctx || ctx.mode !== "tui") return;
		const record = state.phase === "done" ? state.record : null;
		if (!settings.enabled || !record) {
			ctx.ui.setWidget(WIDGET, undefined);
			return;
		}
		ctx.ui.setWidget(WIDGET, (_tui, theme) => {
			const box = new Container();
			box.addChild(new Text(formatRecapLine(theme, record), 0, 0));
			return box;
		});
	}

	function clearWidget(ctx = uiCtx): void {
		if (!ctx || ctx.mode !== "tui") return;
		ctx.ui.setWidget(WIDGET, undefined);
	}

	function cancelTimer(): void {
		if (state.phase === "scheduled") {
			clearTimeout(state.timer);
			state = { phase: "idle" };
		}
	}

	function cancelInFlight(): void {
		if (state.phase === "running") {
			state.controller.abort();
			state = { phase: "idle" };
		}
	}

	function cancelPending(): void {
		generation++;
		cancelTimer();
		cancelInFlight();
	}

	function clearForActiveTurn(): void {
		cancelPending();
		state = { phase: "idle" };
		clearWidget();
	}

	function schedule(ctx: ExtensionContext): void {
		uiCtx = ctx;
		cancelPending();
		settings = loadSettings();
		if (!settings.enabled || ctx.mode !== "tui") {
			if (!settings.enabled) clearWidget(ctx);
			return;
		}
		const delay = delayFor(Date.now(), lastRunAt);
		const timer = setTimeout(() => void fire(ctx, false), delay);
		timer.unref?.();
		state = { phase: "scheduled", timer, scheduledAt: Date.now() };
	}

	async function fire(ctx: ExtensionContext, force = false): Promise<void> {
		uiCtx = ctx;
		settings = loadSettings();
		if (!settings.enabled) {
			clearWidget(ctx);
			return;
		}
		if (ctx.mode !== "tui") return;
		if (state.phase === "running") {
			if (force) {
				ctx.ui.notify("A recap is already running.", "info");
			}
			return;
		}
		if (!force && ctx.ui.getEditorText().trim().length > 0) {
			state = { phase: "idle" };
			return;
		}

		const sm = ctx.sessionManager;
		const llmMessages =
			lastTurnMessages !== null
				? convertToLlm(lastTurnMessages)
				: convertToLlm(buildSessionContext(sm.getEntries(), sm.getLeafId()).messages);

		const hasConversation = llmMessages.some((m) => m.role === "user" || m.role === "assistant");
		if (!hasConversation) {
			state = { phase: "idle" };
			if (force) {
				ctx.ui.notify("Nothing in the session to recap yet.", "info");
			}
			return;
		}

		const fp = fingerprintOf(llmMessages);
		if (!force && fp === lastFingerprint && lastFingerprint !== "") {
			state = { phase: "idle" };
			return;
		}

		const controller = new AbortController();
		const currentGen = ++generation;
		state = { phase: "running", controller, startedAt: Date.now() };

		const reply = await runSideCall(
			ctx,
			settings,
			llmMessages,
			controller.signal,
			force,
			lastTurnEndAt,
			warnedModels,
		);

		if (currentGen !== generation || state.phase !== "running" || state.controller !== controller) {
			return;
		}

		if (!reply.ok) {
			state = { phase: "error", message: reply.reason };
			return;
		}

		const record: RecapRecord = {
			version: 1,
			sessionId: sm.getSessionId(),
			at: Date.now(),
			model: reply.model,
			fingerprint: fp,
			goal: reply.fields.goal,
			now: reply.fields.now,
			next: reply.fields.next,
			waiting: reply.fields.waiting,
		};

		lastRunAt = Date.now();
		lastFingerprint = fp;
		state = { phase: "done", record, shownAt: Date.now() };
		writeRecord(record);
		render(ctx);
	}

	pi.registerCommand("recap", {
		description: "Refresh the session recap line above the prompt",
		handler: async (args, ctx) => {
			if (args.trim()) {
				ctx.ui.notify("Usage: /recap", "warning");
				return;
			}
			uiCtx = ctx;
			settings = loadSettings();
			if (!settings.enabled) {
				ctx.ui.notify("Recap is off. Set enabled to true in recap.json to enable.", "warning");
				return;
			}
			if (ctx.mode !== "tui") {
				ctx.ui.notify("Recap needs the interactive terminal.", "warning");
				return;
			}
			cancelTimer();
			void fire(ctx, true);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		uiCtx = ctx;
		settings = loadSettings();
		generation++;
		cancelTimer();
		cancelInFlight();
		clearWidget(ctx);
		state = { phase: "idle" };
		lastRunAt = null;
		lastFingerprint = "";
		lastTurnMessages = null;
		lastRequestMessages = null;
		lastTurnEndAt = null;
		warnedModels.clear();

		const sessionId = ctx.sessionManager.getSessionId();
		const prior = readRecord(sessionId);
		if (prior) {
			lastFingerprint = prior.fingerprint;
			state = { phase: "done", record: prior, shownAt: Date.now() };
			render(ctx);
		}
	});

	pi.on("session_shutdown", () => {
		generation++;
		cancelTimer();
		cancelInFlight();
		clearWidget();
		uiCtx = undefined;
		state = { phase: "idle" };
		lastTurnMessages = null;
		lastRequestMessages = null;
	});

	pi.on("before_agent_start", () => {
		clearForActiveTurn();
	});

	pi.on("agent_start", () => {
		clearForActiveTurn();
	});

	pi.on("turn_start", () => {
		clearForActiveTurn();
	});

	pi.on("context_with_system", (event) => {
		if (Array.isArray(event?.messages)) {
			lastRequestMessages = event.messages;
		}
	});

	pi.on("turn_end", (event) => {
		lastTurnEndAt = Date.now();
		if (lastRequestMessages !== null) {
			lastTurnMessages = [
				...lastRequestMessages,
				...(event?.message ? [event.message] : []),
				...(event?.toolResults ?? []),
			];
		}
	});

	pi.on("agent_settled", (_event, ctx) => {
		schedule(ctx);
	});

	pi.on("input", (event) => {
		if (event.source === "extension") return;
		clearForActiveTurn();
	});
}
