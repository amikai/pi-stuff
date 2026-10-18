/**
 * Test-only provider for driving you-should-know in a real pi TUI.
 *
 * Main agent: a prompt containing "steps N" makes it call bash N times, then
 * answer "done"; with "long" in the prompt each call prints 3,000 lines.
 * Side agent: the propose call returns the text of $YSK_CTRL/side.txt ("{n}"
 * becomes a call counter); the explain call returns a fixed explanation.
 * Retell: answers with the mode and a call counter, plus 40 lines to scroll
 * through; a prompt override containing OVERRIDE-MARKER is marked in the
 * title; with $YSK_CTRL/slow present it takes 5 seconds. Every side and
 * retell call is appended to $YSK_CTRL/calls.log.
 * Models: faux/faux-1 and faux/faux-2, to tell model settings apart.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
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
		models: [
			{ id: "faux-1", contextWindow: 200_000, maxTokens: 8_000 },
			{ id: "faux-2", contextWindow: 200_000, maxTokens: 8_000 },
		],
		tokensPerSecond: 100_000,
	});
	let proposeCalls = 0;
	let retellCalls = 0;
	const respond = async (context: any) => {
		const messages: any[] = context?.messages ?? [];
		const blob = JSON.stringify(context ?? {});
		if (blob.includes("Retell only what is in the transcript")) {
			retellCalls++;
			// With $YSK_CTRL/slow present a retell takes 5 seconds, long enough to press again while it runs.
			if (existsSync(join(CTRL, "slow"))) await new Promise((resolve) => setTimeout(resolve, 5_000));
			const mode = blob.includes("has lost track") ? "lost" : "plain";
			try {
				appendFileSync(join(CTRL, "calls.log"), `${JSON.stringify({ at: new Date().toISOString(), kind: "retell", mode, n: retellCalls, chars: blob.length })}\n`);
			} catch {}
			const body = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of the faux retell.`).join("\n\n");
			// A prompt override containing this word shows up in the title, so the override is visible.
			const override = blob.includes("OVERRIDE-MARKER") ? " (override)" : "";
			return fauxAssistantMessage(`**Faux ${mode} retell ${retellCalls}${override}**\n\n${body}`);
		}
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
			// "long" in the prompt makes every step print 3,000 lines, to exercise transcript cutting.
			const long = /\blong\b/.test(textOf(messages[lastUser]?.content));
			const command = long ? `seq 1 3000; echo end of step ${done + 1}` : `echo step ${done + 1}`;
			return fauxAssistantMessage(fauxToolCall("bash", { command }), { stopReason: "toolUse" });
		}
		return fauxAssistantMessage(fauxText(`done after ${done} steps`));
	};
	faux.setResponses(Array.from({ length: 5_000 }, () => respond));
	pi.registerProvider(faux.provider);
}
