import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
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

process.env.FORCE_COLOR ??= "3";

const {
	AssistantMessageComponent,
	initTheme,
	SessionManager,
} = await import("@earendil-works/pi-coding-agent");
const { setTheme, theme: activePiGlobalTheme } = await import(
	pathToFileURL(resolve(dirname(piPkg), "dist/modes/interactive/theme/theme.js")).href
);
const {
	matchesKey,
	resetCapabilitiesCache,
	setCapabilityOverrides,
	stripTerminalSequences,
	visibleWidth,
} = await import("@earendil-works/pi-tui");
const isImageLine = (line: string) => line.includes("\x1b_G") || line.includes("\x1b]1337;File=");
initTheme("dark");

const { default: prismExtension } = await import("../extensions/prism/index.ts");
const {
	BuiltInDocumentComponent,
	decodeDocument,
	diagramCodeSpan,
	ENTRY_TYPE,
	getBuiltInRenderCompletions,
	isSectionId,
	makeDocument,
	makeHelpDocument,
	parseCommandArgs,
	default: piBuiltInRenderExtension,
	SECTIONS,
	transformBuiltInMermaid,
} = await import("../extensions/pi-built-in-render/index.ts");

const SECTION_IDS = [
	"markdown",
	"lists",
	"quotes",
	"tables",
	"code",
	"math",
	"mermaid",
	"diff",
	"image",
] as const;

function invokeExtension(ext: unknown, api: unknown): void {
	if (typeof ext === "function") {
		Reflect.apply(ext, undefined, [api]);
	}
}

function createAssistantMessageComponent(text: string) {
	return Reflect.construct(AssistantMessageComponent, [
		{
			role: "assistant",
			content: [{ type: "text", text }],
			timestamp: 1000,
		},
	]);
}

function createDualHarness(initialPrismConfig?: Record<string, unknown>) {
	const dir = mkdtempSync(join(tmpdir(), "pi-built-in-render-unit-"));
	process.env.PI_CODING_AGENT_DIR = dir;
	if (initialPrismConfig) {
		writeFileSync(join(dir, "prism.json"), `${JSON.stringify(initialPrismConfig, null, 2)}\n`);
	}

	const handlers = new Map<string, ((...args: any[]) => any)[]>();
	const commands = new Map<
		string,
		{
			handler: (args: string, ctx: any) => Promise<void>;
			getArgumentCompletions?: (prefix: string) => any;
		}
	>();
	const messageRenderers = new Map<string, (msg: any, opts: any, theme: any) => any>();
	const entryRenderers = new Map<string, (entry: any, opts: any, theme: any) => any>();
	const markdownTransformers: ((md: string, ctx: any) => string)[] = [];
	const notifications: { text: string; level: string }[] = [];
	const sentCustomMessages: any[] = [];
	const appendedEntries: { customType: string; data: unknown }[] = [];

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
			setTheme: () => ({ success: true }),
			setWorkingIndicator: () => {},
			setWidget: () => {},
			custom: async (factory: any) => {
				const fakeTui = {
					terminal: { columns: 100, rows: 40 },
					requestRender: () => {},
				};
				factory(fakeTui, activePiGlobalTheme, { matches: matchesKey }, () => {});
			},
		},
	};

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
		registerToolRenderer: () => {},
		registerMarkdownTransformer: (transformer: any) => {
			markdownTransformers.push(transformer);
		},
		sendMessage: (msg: any) => {
			sentCustomMessages.push(msg);
		},
		appendEntry: (customType: string, data: unknown) => {
			appendedEntries.push({ customType, data });
		},
	};

	invokeExtension(prismExtension, pi);
	invokeExtension(piBuiltInRenderExtension, pi);

	const emit = async (event: string, payload: any = {}) => {
		let currentPayload = payload;
		let lastResult: any;
		for (const handler of handlers.get(event) ?? []) {
			const res = await handler(currentPayload, ctx);
			if (res !== undefined) {
				lastResult = res;
				if (event === "context" && res.messages) {
					currentPayload = { ...currentPayload, messages: res.messages };
				}
			}
		}
		return lastResult;
	};

	return {
		dir,
		ctx,
		emit,
		commands,
		messageRenderers,
		entryRenderers,
		markdownTransformers,
		notifications,
		sentCustomMessages,
		appendedEntries,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

let cleanupFn: (() => void) | undefined;
beforeEach(() => {
	cleanupFn = undefined;
	setTheme("dark");
	setCapabilityOverrides({});
	resetCapabilitiesCache();
});
afterEach(() => {
	setCapabilityOverrides({});
	resetCapabilitiesCache();
	setTheme("dark");
	cleanupFn?.();
});

test("1. parseCommandArgs and isSectionId validate default, aliases, all 9 sections, help flags, unknown sections, and multi-token inputs", () => {
	assert.deepEqual(Object.keys(SECTIONS), [...SECTION_IDS]);

	for (const alias of ["", "   ", "all", "  all  ", "demo", " demo "]) {
		assert.deepEqual(parseCommandArgs(alias), { kind: "show", selection: "all" });
	}

	for (const sectionId of SECTION_IDS) {
		assert.equal(isSectionId(sectionId), true);
		assert.deepEqual(parseCommandArgs(sectionId), { kind: "show", selection: sectionId });
		assert.deepEqual(parseCommandArgs(`  ${sectionId}  `), { kind: "show", selection: sectionId });
	}

	for (const helpArg of ["help", "-h", "--help", "  --help  "]) {
		assert.deepEqual(parseCommandArgs(helpArg), { kind: "help" });
	}

	assert.equal(isSectionId("unknown"), false);
	assert.equal(isSectionId("all"), false);
	assert.equal(isSectionId("help"), false);

	const unknownResult = parseCommandArgs("unknown");
	assert.equal(unknownResult.kind, "invalid");
	if (unknownResult.kind === "invalid") {
		assert.ok(unknownResult.explanation.includes("all"));
		assert.ok(unknownResult.explanation.includes("mermaid"));
		assert.ok(unknownResult.explanation.includes("help"));
	}

	const multiTokenResult = parseCommandArgs("math mermaid");
	assert.equal(multiTokenResult.kind, "invalid");
	if (multiTokenResult.kind === "invalid") {
		assert.ok(multiTokenResult.explanation.length > 0);
	}
});

test("2. getBuiltInRenderCompletions filters commands and sections by single-token prefix", () => {
	const allCompletions = getBuiltInRenderCompletions("");
	assert.ok(allCompletions !== null);
	const allValues = allCompletions.map((item) => item.value);
	assert.deepEqual(allValues, ["all", "demo", ...SECTION_IDS, "help"]);

	const whitespaceCompletions = getBuiltInRenderCompletions("   ");
	assert.ok(whitespaceCompletions !== null);
	assert.deepEqual(
		whitespaceCompletions.map((item) => item.value),
		["all", "demo", ...SECTION_IDS, "help"],
	);

	const maCompletions = getBuiltInRenderCompletions("ma");
	assert.ok(maCompletions !== null);
	assert.deepEqual(
		maCompletions.map((item) => item.value),
		["markdown", "math"],
	);

	assert.equal(getBuiltInRenderCompletions("math mermaid"), null);
	assert.equal(getBuiltInRenderCompletions("unknown"), null);
});

test("3. decodeDocument accepts valid showcase and help documents and rejects malformed or unsafe payloads", () => {
	const validAll = decodeDocument(makeDocument("all"));
	assert.equal(validAll.kind, "valid");
	if (validAll.kind === "valid") {
		assert.equal(validAll.document.version, 1);
		assert.ok(validAll.document.blocks.length >= SECTION_IDS.length);
	}

	const validHelp = decodeDocument(makeHelpDocument());
	assert.equal(validHelp.kind, "valid");

	for (const nonObject of [null, undefined, "string", 123, true, []]) {
		const res = decodeDocument(nonObject);
		assert.equal(res.kind, "invalid");
	}

	assert.equal(
		decodeDocument({ version: 2, blocks: makeDocument("markdown").blocks }).kind,
		"invalid",
	);
	assert.equal(decodeDocument({ version: 1, blocks: [] }).kind, "invalid");
	assert.equal(
		decodeDocument({ version: 1, blocks: [{ kind: "unknown", source: "# hi" }] }).kind,
		"invalid",
	);
	assert.equal(
		decodeDocument({
			version: 1,
			blocks: [{ kind: "markdown", source: "unsafe \x1b[31m escape" }],
		}).kind,
		"invalid",
	);
	assert.equal(
		decodeDocument({
			version: 1,
			blocks: [{ kind: "diff", numberedDiff: "-1 \x1b[31m unsafe diff" }],
		}).kind,
		"invalid",
	);
	assert.equal(
		decodeDocument({
			version: 1,
			blocks: [
				{
					kind: "image",
					mimeType: "image/png",
					base64: "not-valid-base64!!!",
					filename: "bad.png",
				},
			],
		}).kind,
		"invalid",
	);
	assert.equal(
		decodeDocument({
			version: 1,
			blocks: [
				{
					kind: "image",
					mimeType: "image/png",
					base64: Buffer.from("GIF89a1234567890", "ascii").toString("base64"),
					filename: "not-a-png.png",
				},
			],
		}).kind,
		"invalid",
	);
});

test("4. diagramCodeSpan and transformBuiltInMermaid escape backticks, render all 5 diagram families, and handle width or syntax fallbacks", () => {
	assert.equal(diagramCodeSpan(""), "`\u00a0`");
	assert.equal(diagramCodeSpan("plain row"), "`plain row`");
	assert.equal(diagramCodeSpan("one ` tick"), "``one ` tick``");
	assert.equal(diagramCodeSpan("two `` ticks"), "```two `` ticks```");
	assert.equal(diagramCodeSpan("`leading"), "`` `leading ``");
	assert.equal(diagramCodeSpan("trailing`"), "`` trailing` ``");
	assert.equal(diagramCodeSpan("`both`"), "`` `both` ``");

	const fiveFamilies = [
		{
			name: "flowchart",
			source: "```mermaid\nflowchart LR\n  A[Start] --> B{Check}\n  B -->|Yes| C([Done])\n```",
		},
		{
			name: "sequenceDiagram",
			source: "```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Ack\n```",
		},
		{
			name: "stateDiagram-v2",
			source: "```mermaid\nstateDiagram-v2\n  [*] --> Idle\n  Idle --> Active: run\n  Active --> [*]\n```",
		},
		{
			name: "classDiagram",
			source: "```mermaid\nclassDiagram\n  class Component {\n    +render(width) string[]\n  }\n  Component <|-- Markdown\n```",
		},
		{
			name: "erDiagram",
			source: "```mermaid\nerDiagram\n  SESSION ||--o{ ENTRY : contains\n```",
		},
	];

	for (const family of fiveFamilies) {
		const renderedPlain = transformBuiltInMermaid(family.source, 100);
		assert.ok(!renderedPlain.includes("```mermaid"), `${family.name} replaces mermaid fence at width 100`);
		assert.ok(
			(renderedPlain.includes("┌") || renderedPlain.includes("╭")) && renderedPlain.includes("│"),
			`${family.name} produces Unicode box-drawing characters`,
		);

		const renderedThemed = transformBuiltInMermaid(family.source, 100, activePiGlobalTheme);
		assert.ok(!renderedThemed.includes("```mermaid"), `${family.name} renders with piTheme`);
		assert.ok(
			stripTerminalSequences(renderedThemed).includes("┌") || stripTerminalSequences(renderedThemed).includes("╭"),
			`${family.name} themed output preserves box-drawing characters`,
		);
	}

	const wideSource = [
		"```mermaid",
		"flowchart LR",
		"  NodeAlpha[First Wide Stage] --> NodeBeta[Second Wide Stage] --> NodeGamma[Third Wide Stage]",
		"```",
	].join("\n");
	const narrowResult = transformBuiltInMermaid(wideSource, 25, activePiGlobalTheme);
	assert.equal(narrowResult, wideSource);

	const warningSource = [
		"```mermaid",
		"flowchart LR",
		"  A --> B",
		"  bogus line without link",
		"```",
	].join("\n");
	const warningResult = transformBuiltInMermaid(warningSource, 100, activePiGlobalTheme);
	const plainWarningResult = stripTerminalSequences(warningResult);
	assert.ok(warningResult.startsWith(warningSource));
	assert.ok(plainWarningResult.includes("Mermaid diagram not rendered:"));
});

test("5. BuiltInDocumentComponent renders every section within width bounds, formats tables, math, diffs, image fallbacks, and refreshes colors on invalidate()", () => {
	setCapabilityOverrides({ images: null });
	resetCapabilitiesCache();

	for (const selection of ["all", ...SECTION_IDS] as const) {
		const doc = makeDocument(selection);
		const comp = new BuiltInDocumentComponent(doc, activePiGlobalTheme);
		for (const width of [100, 50]) {
			const lines = comp.render(width);
			assert.ok(lines.length > 0, `${selection} produces output at width ${width}`);
			for (const line of lines) {
				if (!isImageLine(line)) {
					assert.ok(
						visibleWidth(line) <= width,
						`${selection} line exceeded width ${width}: got ${visibleWidth(line)}`,
					);
				}
			}
		}
	}

	const tablesPlain = stripTerminalSequences(
		new BuiltInDocumentComponent(makeDocument("tables"), activePiGlobalTheme).render(100).join("\n"),
	);
	assert.ok(tablesPlain.includes("┌─"));
	assert.ok(tablesPlain.includes("├─"));
	assert.ok(tablesPlain.includes("└─"));

	const mathPlain = stripTerminalSequences(
		new BuiltInDocumentComponent(makeDocument("math"), activePiGlobalTheme).render(100).join("\n"),
	);
	assert.ok(mathPlain.includes("∑"));
	assert.ok(mathPlain.includes("∫"));
	assert.ok(mathPlain.includes("⎛"));
	assert.ok(mathPlain.includes("⎧"));

	const diffRaw = new BuiltInDocumentComponent(makeDocument("diff"), activePiGlobalTheme)
		.render(100)
		.join("\n");
	const diffPlain = stripTerminalSequences(diffRaw);
	assert.ok(diffRaw.includes("\x1b[7m"), "renderDiff highlights intra-line token edits with inverse ANSI");
	assert.ok(diffRaw.includes("\x1b["), "renderDiff emits theme ANSI color sequences");
	assert.ok(diffPlain.includes("-") && diffPlain.includes("+"));

	const imagePlain = stripTerminalSequences(
		new BuiltInDocumentComponent(makeDocument("image"), activePiGlobalTheme).render(100).join("\n"),
	);
	assert.ok(imagePlain.includes("[Image:"));
	assert.ok(imagePlain.includes("[image/png]"));

	setTheme("dark");
	const themeComp = new BuiltInDocumentComponent(makeDocument("all"), activePiGlobalTheme);
	const darkOutput = themeComp.render(90).join("\n");

	setTheme("light");
	themeComp.invalidate();
	const lightOutput = themeComp.render(90).join("\n");
	assert.notEqual(darkOutput, lightOutput, "invalidate() reconstructs children with updated light theme colors");

	setTheme("mono");
	themeComp.invalidate();
	const monoOutput = themeComp.render(90).join("\n");
	assert.notEqual(lightOutput, monoOutput, "invalidate() reconstructs children with updated mono theme colors");
});

test("6. piBuiltInRenderExtension coexists with prismExtension without prism interception or LLM context leakage", async () => {
	setCapabilityOverrides({ images: null });
	resetCapabilitiesCache();

	const h = createDualHarness({ headingStyle: "banner", tableStyle: "box" });
	cleanupFn = h.cleanup;
	await h.emit("session_start");

	h.markdownTransformers.push(() => "SENTINEL_GLOBAL_TRANSFORMER_LEAK");

	const assistantComp = createAssistantMessageComponent(
		"# Prism Heading\n\n| Col A | Col B |\n|:------|:------|\n| 1     | 2     |",
	);
	const prismAssistantPlain = stripTerminalSequences(assistantComp.render(96).join("\n"));
	assert.ok(prismAssistantPlain.includes("┏"), "prism renders banner heading on AssistantMessageComponent");
	assert.ok(prismAssistantPlain.includes("[ ⧉ md ]"), "prism renders table copy button on AssistantMessageComponent");

	const builtInCmd = h.commands.get("pi-built-in-render");
	assert.ok(builtInCmd, "registers /pi-built-in-render command");

	await builtInCmd.handler("bad-arg", h.ctx);
	assert.equal(h.appendedEntries.length, 0, "invalid argument appends no entry");
	assert.equal(h.notifications.length, 1);
	assert.equal(h.notifications[0]?.level, "warning");

	await builtInCmd.handler("", h.ctx);
	await builtInCmd.handler("mermaid", h.ctx);
	await builtInCmd.handler("diff", h.ctx);
	await builtInCmd.handler("help", h.ctx);
	assert.equal(h.sentCustomMessages.length, 0, "never calls pi.sendMessage");
	assert.equal(h.appendedEntries.length, 4);
	for (const entry of h.appendedEntries) {
		assert.equal(entry.customType, ENTRY_TYPE);
	}

	const entryRenderer = h.entryRenderers.get(ENTRY_TYPE);
	assert.ok(entryRenderer, "registers entry renderer for pi-built-in-render");

	const fullEntryComp = entryRenderer(
		h.appendedEntries[0],
		{ expanded: false },
		activePiGlobalTheme,
	);
	assert.ok(fullEntryComp instanceof BuiltInDocumentComponent);

	const fullLines = fullEntryComp.render(96);
	const fullPlain = stripTerminalSequences(fullLines.join("\n"));
	assert.ok(!fullPlain.includes("SENTINEL_GLOBAL_TRANSFORMER_LEAK"), "ignores registered global markdown transformers");
	assert.ok(!fullPlain.includes("[ ⧉"), "contains no prism copy buttons");
	assert.ok(!fullPlain.includes("┏━━"), "contains no prism banner heading borders");
	assert.ok(!fullPlain.includes("╞══"), "contains no prism double-lined table headers");
	assert.ok(fullPlain.includes("┌─"), "uses stock Pi single-line box tables and Mermaid diagrams");
	assert.ok(fullPlain.includes("∑"), "renders stock Pi LaTeX math");
	assert.ok(fullPlain.includes("[Image:"), "renders stock Pi Image fallback");

	const messageRenderer = h.messageRenderers.get(ENTRY_TYPE);
	assert.ok(messageRenderer, "registers message renderer for compatibility custom messages");
	const msgComp = messageRenderer(
		{ role: "custom", customType: ENTRY_TYPE, details: h.appendedEntries[1]?.data },
		{ expanded: false },
		activePiGlobalTheme,
	);
	const msgPlain = stripTerminalSequences(msgComp.render(96).join("\n"));
	assert.ok(msgPlain.includes("┌") && !msgPlain.includes("[ ⧉"));

	const invalidEntryComp = entryRenderer(
		{
			customType: ENTRY_TYPE,
			data: {
				version: 999,
				blocks: [{ kind: "markdown", source: "RAW_UNVALIDATED_PAYLOAD" }],
			},
		},
		{ expanded: false },
		activePiGlobalTheme,
	);
	const invalidPlain = stripTerminalSequences(invalidEntryComp.render(80).join("\n"));
	assert.ok(invalidPlain.length > 0 && !invalidPlain.includes("RAW_UNVALIDATED_PAYLOAD"));

	const contextResult = await h.emit("context", {
		type: "context",
		messages: [
			{ role: "user", content: "explain stock rendering" },
			{ role: "custom", customType: ENTRY_TYPE, content: "demo payload" },
			{ role: "assistant", content: [{ type: "text", text: "here is the answer" }] },
		],
	});
	assert.deepEqual(contextResult, {
		messages: [
			{ role: "user", content: "explain stock rendering" },
			{ role: "assistant", content: [{ type: "text", text: "here is the answer" }] },
		],
	});
});
