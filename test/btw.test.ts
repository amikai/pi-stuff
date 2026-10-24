import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const whichPi = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
const piPkg = realpathSync(resolve(dirname(realpathSync(whichPi)), "../@earendil-works/pi-coding-agent/package.json"));
const parentURL = pathToFileURL(piPkg).href;
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith("@earendil-works/")) return nextResolve(specifier, { ...context, parentURL });
		return nextResolve(specifier, context);
	},
});

const { initTheme, getMarkdownTheme } = await import("@earendil-works/pi-coding-agent");
const { KeybindingsManager, TUI_KEYBINDINGS, ProcessTerminal, Markdown, CURSOR_MARKER, visibleWidth } = await import("@earendil-works/pi-tui");
const { theme } = await import(pathToFileURL(resolve(dirname(piPkg), "dist/modes/interactive/theme/theme.js")).href);
const { BtwOverlay } = await import("../extensions/btw.ts");
initTheme();

class TestTerminal extends ProcessTerminal {
	height = 30;
	override get rows(): number { return this.height; }
	override get columns(): number { return 100; }
}

function createView(initial: { question: string; answer: string }[] = []) {
	const exchanges = [...initial];
	let pending: { question: string; answer: string } | null = null;
	let submits: string[] = [];
	let dismisses = 0;
	const terminal = new TestTerminal();
	const tui = { terminal, requestRender: () => {} };
	const overlay = new BtwOverlay(tui, theme, new KeybindingsManager(TUI_KEYBINDINGS), (width, _theme, selected) => {
		const total = exchanges.length + (pending ? 1 : 0);
		if (!total) return { total, index: 0, lines: ["No BTW messages yet. Type a question below."] };
		const index = selected === "latest" ? total - 1 : Math.max(0, Math.min(total - 1, selected));
		const entry = exchanges[index] ?? pending;
		if (!entry) throw new Error("Missing exchange");
		const lines = [`You: ${entry.question}`, "", ...new Markdown(entry.answer, 0, 0, getMarkdownTheme()).render(width)];
		return { total, index, lines };
	}, () => "Ready", (value) => { submits.push(value); }, () => { dismisses++; });
	overlay.focused = true;
	const render = (width = 72) => overlay.render(width);
	const press = (key: string) => { overlay.handleInput(key); return render(); };
	return { overlay, terminal, exchanges, render, press, get pending() { return pending; }, set pending(value: { question: string; answer: string } | null) { pending = value; }, get submits() { return submits; }, get dismisses() { return dismisses; } };
}

const text = (lines: string[]) => lines.join("\n");

test("browse all exchanges without wrapping and start each selected answer at top", () => {
	const view = createView(Array.from({ length: 9 }, (_, i) => ({ question: `question-${i + 1}`, answer: `answer-${i + 1}` })));
	assert.match(text(view.render()), /9\/9/);
	for (let i = 0; i < 12; i++) view.press("\x1b[Z");
	assert.match(text(view.render()), /1\/9/);
	assert.match(text(view.render()), /answer-1/);
	view.press("\x1b[1;2D");
	assert.match(text(view.render()), /1\/9/);
	view.press("\x1b[1;2C");
	assert.match(text(view.render()), /2\/9/);
	for (let i = 0; i < 12; i++) view.press("\t");
	assert.match(text(view.render()), /9\/9/);
	assert.doesNotMatch(text(view.render()), /answer-1/);
});

test("rapid history and scroll keys accumulate before the next render", () => {
	const answer = Array.from({ length: 65 }, (_, i) => `burst-line-${String(i).padStart(2, "0")}`).join("\n\n");
	const view = createView(Array.from({ length: 9 }, (_, i) => ({ question: `question-${i + 1}`, answer })));
	view.render();
	for (let i = 0; i < 8; i++) view.overlay.handleInput("\x1b[1;2D");
	assert.match(text(view.render()), /1\/9/);
	for (let i = 0; i < 8; i++) view.overlay.handleInput("\t");
	assert.match(text(view.render()), /9\/9/);
	for (let i = 0; i < 100; i++) view.overlay.handleInput("\x1b[B");
	assert.match(text(view.render()), /burst-line-64/);
	for (let i = 0; i < 100; i++) view.overlay.handleInput("\x1b[A");
	assert.match(text(view.render()), /burst-line-00/);
});

test("navigation reads the selected answer and newly pending slot before a render", () => {
	const answer = Array.from({ length: 65 }, (_, i) => `mixed-line-${i}`).join("\n\n");
	const view = createView([{ question: "long", answer }, { question: "short", answer: "short answer" }]);
	view.render();
	view.overlay.handleInput("\x1b[Z");
	view.overlay.handleInput("\x1b[B");
	view.overlay.handleInput("\x1b[B");
	assert.match(text(view.render()), /Lines 7-/);
	assert.doesNotMatch(text(view.render()), /mixed-line-0\b/);
	const pending = createView([{ question: "old", answer: "old answer" }]);
	pending.render();
	pending.pending = { question: "live", answer };
	pending.overlay.handleInput("\x1b[Z");
	assert.match(text(pending.render()), /1\/2/);
	assert.match(text(pending.render()), /old answer/);
	assert.doesNotMatch(text(pending.render()), /mixed-line-/);
});

test("scroll three lines per key, clamp at both ends, and preserve numeric offset during growth", () => {
	const answer = Array.from({ length: 65 }, (_, i) => `line-${String(i).padStart(2, "0")}`).join("\n\n");
	const view = createView([{ question: "long", answer }]);
	const bottom = text(view.render()).match(/Lines (\d+)-/);
	assert.ok(bottom);
	assert.match(text(view.render()), /line-64/);
	view.press("\x1b[A");
	const up = text(view.render()).match(/Lines (\d+)-/);
	assert.ok(up);
	assert.equal(Number(bottom[1]) - Number(up[1]), 3);
	const pinned = text(view.render());
	view.exchanges[0].answer += "\n\nline-65";
	assert.match(text(view.render()), /line-61/);
	assert.doesNotMatch(text(view.render()), /line-65/);
	for (let i = 0; i < 100; i++) view.press("\x1b[A");
	assert.match(text(view.render()), /Lines 1-/);
	assert.match(text(view.render()), /line-00/);
	view.press("\x1b[6~");
	assert.match(text(view.render()), /Lines 19-/);
	view.press("\x1b[5~");
	assert.match(text(view.render()), /Lines 1-/);
	for (let i = 0; i < 100; i++) view.press("\x1b[B");
	assert.match(text(view.render()), /line-65/);
	assert.notEqual(pinned, text(view.render()));
});

test("draft, literal brackets, cursor edit, submit and dismiss use real Input bindings", () => {
	const view = createView([{ question: "first", answer: "done" }, { question: "second", answer: "done" }]);
	view.render();
	for (const key of "a[]b") view.press(key);
	view.press("\x1b[D");
	view.press("X");
	assert.equal(view.overlay.getDraft(), "a[]Xb");
	view.press("\x1b[Z");
	assert.equal(view.overlay.getDraft(), "a[]Xb");
	assert.match(text(view.render()), /1\/2/);
	assert.ok(text(view.render()).includes(CURSOR_MARKER));
	view.press("\r");
	assert.deepEqual(view.submits, ["a[]Xb"]);
	view.press("\x1b");
	assert.equal(view.dismisses, 1);
});

test("pinned history stays fixed through pending growth and completion in the same slot", () => {
	const view = createView([{ question: "old", answer: "old answer" }]);
	view.pending = { question: "new", answer: "start" };
	view.render();
	view.press("\x1b[Z");
	view.press("d");
	view.pending.answer = "start\n\nstreamed continuation";
	assert.match(text(view.render()), /old answer/);
	assert.doesNotMatch(text(view.render()), /streamed continuation/);
	assert.equal(view.overlay.getDraft(), "d");
	view.press("\t");
	assert.match(text(view.render()), /2\/2/);
	assert.match(text(view.render()), /start/);
	view.pending = null;
	view.exchanges.push({ question: "new", answer: "start\n\nfinished continuation" });
	assert.match(text(view.render()), /2\/2/);
	assert.match(text(view.render()), /finished continuation/);
	assert.equal(view.overlay.getDraft(), "d");
});

test("latest follows streaming until scrolled up, then keeps its line through completion and resize", () => {
	const view = createView();
	const answer = Array.from({ length: 45 }, (_, i) => `token-${String(i).padStart(2, "0")}`).join("\n\n");
	view.pending = { question: "stream", answer };
	assert.match(text(view.render()), /token-44/);
	view.pending.answer += "\n\ntoken-45";
	assert.match(text(view.render()), /token-45/);
	view.press("\x1b[A");
	const before = text(view.render()).match(/Lines (\d+)-/);
	assert.ok(before);
	view.pending.answer += "\n\ntoken-46";
	assert.equal(text(view.render()).match(/Lines (\d+)-/)?.[1], before[1]);
	view.exchanges.push({ question: "stream", answer: view.pending.answer });
	view.pending = null;
	assert.equal(text(view.render()).match(/Lines (\d+)-/)?.[1], before[1]);
	view.terminal.height = 12;
	const resized = view.render();
	assert.ok(resized.at(-1)?.includes("╯"));
	assert.match(text(resized), /1\/1/);
});

test("empty/reset/reopen and resize keep a complete border and cursor", () => {
	const view = createView();
	view.render();
	for (const key of ["\x1b[Z", "\t", "\x1b[A", "\x1b[B"]) view.press(key);
	assert.match(text(view.render()), /0\/0/);
	view.exchanges.push({ question: "first", answer: Array.from({ length: 80 }, (_, i) => `answer-${i}`).join("\n\n") });
	view.render();
	view.press("\x1b[A");
	view.exchanges.length = 0;
	view.overlay.resetView();
	assert.match(text(view.render()), /0\/0/);
	view.exchanges.push({ question: "restored", answer: "restored answer" });
	assert.match(text(view.render()), /1\/1/);
	for (const width of [7, 20, 72, 100]) {
		view.terminal.height = 12;
		const lines = view.render(width);
		assert.equal(lines.length, 10);
		const topBorder = lines[0]?.replace(/\x1b\[[0-9;]*m/g, "");
		const border = lines.at(-1)?.replace(/\x1b\[[0-9;]*m/g, "");
		assert.ok(topBorder?.startsWith("╭─"));
		assert.ok(topBorder?.endsWith("╮"));
		assert.ok(border?.startsWith("╰─"));
		assert.ok(border?.endsWith("╯"));
		assert.ok(lines.every((line) => visibleWidth(line) === width), `width ${width}`);
		assert.ok(lines.some((line) => line.includes(CURSOR_MARKER)));
	}
	const reopened = createView(view.exchanges);
	assert.match(text(reopened.render()), /restored answer/);
});
