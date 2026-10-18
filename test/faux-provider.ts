/**
 * Test-only provider for driving you-should-know in a real pi TUI.
 *
 * Main agent: a prompt containing "steps N" makes it call bash N times, then
 * answer "done". Side agent: the propose call returns the text of
 * $YSK_CTRL/side.txt ("{n}" becomes a call counter); the explain call returns
 * a fixed explanation. Every side call is appended to $YSK_CTRL/calls.log.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

const CTRL = process.env.YSK_CTRL ?? "";

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("\n");
}

export default function (pi: any) {
	const faux = fauxProvider({
		provider: "faux",
		models: [{ id: "faux-1", contextWindow: 200_000, maxTokens: 8_000 }],
		tokensPerSecond: 100_000,
	});
	let proposeCalls = 0;
	const respond = (context: any) => {
		const messages: any[] = context?.messages ?? [];
		const blob = JSON.stringify(context ?? {});
		if (blob.includes("You are a side agent")) {
			const kind = blob.includes("## Your job") ? "propose" : "explain";
			let text = "**Faux explanation title**\nThis is the faux explanation body.";
			if (kind === "propose") {
				proposeCalls++;
				let raw = "learn: none";
				try {
					raw = readFileSync(join(CTRL, "side.txt"), "utf8");
				} catch {}
				text = raw.replaceAll("{n}", String(proposeCalls));
			}
			try {
				appendFileSync(join(CTRL, "calls.log"), `${JSON.stringify({ at: new Date().toISOString(), kind, n: proposeCalls, chars: blob.length })}\n`);
			} catch {}
			return fauxAssistantMessage(text);
		}
		let lastUser = -1;
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i]?.role === "user") {
				lastUser = i;
				break;
			}
		}
		const want = Number(/steps (\d+)/.exec(lastUser === -1 ? "" : textOf(messages[lastUser].content))?.[1] ?? 0);
		const done = messages.slice(lastUser + 1).filter((m) => m?.role === "toolResult").length;
		if (done < want) {
			return fauxAssistantMessage(fauxToolCall("bash", { command: `echo step ${done + 1}` }), { stopReason: "toolUse" });
		}
		return fauxAssistantMessage(fauxText(`done after ${done} steps`));
	};
	faux.setResponses(Array.from({ length: 5_000 }, () => respond));
	pi.registerProvider(faux.provider);
}
