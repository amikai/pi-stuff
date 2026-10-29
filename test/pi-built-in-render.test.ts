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
	makeDocument,
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

const sectionDocument = (id: (typeof SECTION_IDS)[number]) => ({ version: 1, blocks: SECTIONS[id].blocks });

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

test("1. SECTIONS lists the 9 sections in showcase order", () => {
	assert.deepEqual(Object.keys(SECTIONS), [...SECTION_IDS]);
});

test("2. decodeDocument accepts the showcase document and rejects malformed or unsafe payloads", () => {
	const validAll = decodeDocument(makeDocument());
	assert.equal(validAll.kind, "valid");
	if (validAll.kind === "valid") {
		assert.equal(validAll.document.version, 1);
		assert.ok(validAll.document.blocks.length >= SECTION_IDS.length);
	}

	for (const nonObject of [null, undefined, "string", 123, true, []]) {
		const res = decodeDocument(nonObject);
		assert.equal(res.kind, "invalid");
	}

	assert.equal(
		decodeDocument({ version: 2, blocks: makeDocument().blocks }).kind,
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

test("3. diagramCodeSpan and transformBuiltInMermaid escape backticks, cover the Mermaid 12.2.0 matrix across all 5 supported families, and handle width, warning, and source fallbacks", () => {
	assert.equal(diagramCodeSpan(""), "`\u00a0`");
	assert.equal(diagramCodeSpan("plain row"), "`plain row`");
	assert.equal(diagramCodeSpan("one ` tick"), "``one ` tick``");
	assert.equal(diagramCodeSpan("two `` ticks"), "```two `` ticks```");
	assert.equal(diagramCodeSpan("`leading"), "`` `leading ``");
	assert.equal(diagramCodeSpan("trailing`"), "`` trailing` ``");
	assert.equal(diagramCodeSpan("`both`"), "`` `both` ``");

	type MermaidCase =
		| {
				readonly status: "rendered";
				readonly name: string;
				readonly source: string;
				readonly expectedSubstrings: readonly [string, ...string[]];
		  }
		| {
				readonly status: "warning-fallback";
				readonly name: string;
				readonly source: string;
				readonly expectedWarning: string;
		  }
		| {
				readonly status: "source-fallback";
				readonly name: string;
				readonly source: string;
		  };

	const fence = (body: string): string => `\`\`\`mermaid\n${body}\n\`\`\``;

	const unsupportedMermaid12Headers = [
		["flowchart-elk", "flowchart-elk LR\n  A[Start] --> B[End]"],
		["pie", "pie title Pets\n  \"Dogs\" : 45\n  \"Cats\" : 30"],
		["gantt", "gantt\n  title Roadmap\n  section Phase 1\n  Design :a1, 2026-01-01, 5d"],
		["xychart-beta", "xychart-beta\n  title \"Latency\"\n  x-axis [Q1, Q2]\n  bar [12, 18]"],
		["xychart", "xychart\n  title \"Latency\"\n  x-axis [Q1, Q2]\n  bar [12, 18]"],
		["gitGraph", "gitGraph\n  commit\n  branch feat\n  checkout feat\n  commit"],
		["mindmap", "mindmap\n  root((Pi))\n    Extensions\n    Themes"],
		["timeline", "timeline\n  title Releases\n  2026 : v1.4.0"],
		["journey", "journey\n  title Onboarding\n  section Sign up\n    Open CLI: 5: User"],
		["quadrantChart", "quadrantChart\n  title Priority\n  x-axis Low --> High\n  y-axis Low --> High\n  Item A: [0.3, 0.8]"],
		["sankey-beta", "sankey-beta\n  Input,Process,10"],
		["sankey", "sankey\n  Input,Process,10"],
		["requirementDiagram", "requirementDiagram\n  requirement test_req {\n    id: 1\n    text: verify\n    risk: low\n    verifymethod: test\n  }"],
		["requirement", "requirement\n  requirement test_req {\n    id: 1\n    text: verify\n    risk: low\n    verifymethod: test\n  }"],
		["C4Context", "C4Context\n  Person(user, \"User\")\n  System(sys, \"Pi\")"],
		["C4Container", "C4Container\n  Container(app, \"TUI\", \"Node.js\")"],
		["C4Component", "C4Component\n  Component(comp, \"Renderer\", \"TypeScript\")"],
		["C4Dynamic", "C4Dynamic\n  Rel(user, app, \"Runs command\")"],
		["C4Deployment", "C4Deployment\n  Deployment_Node(host, \"Workstation\")"],
		["kanban", "kanban\n  Todo\n    [Write tests]"],
		["block-beta", "block-beta\n  columns 2\n  a[\"Lexer\"] b[\"Renderer\"]"],
		["block", "block\n  columns 2\n  a[\"Lexer\"] b[\"Renderer\"]"],
		["packet-beta", "packet-beta\n  0-7: \"Magic\"\n  8-15: \"Version\""],
		["packet", "packet\n  0-7: \"Magic\"\n  8-15: \"Version\""],
		["architecture-beta", "architecture-beta\n  service api(server)[API]\n  service db(database)[DB]\n  api:R --> L:db"],
		["architecture", "architecture\n  service api(server)[API]\n  service db(database)[DB]\n  api:R --> L:db"],
		["radar-beta", "radar-beta\n  axis Speed, Safety, Ergonomics\n  curve c1{80, 90, 85}"],
		["treemap", "treemap\n  \"Root\"\n    \"Leaf\": 10"],
		["zenuml", "zenuml\n  Alice->Bob.greet()"],
		["ishikawa-beta", "ishikawa-beta\n  Failure\n    Process\n      Missing check"],
		["venn-beta", "venn-beta\n  set A\n  set B"],
		["treeView-beta", "treeView-beta\n  src\n    index.ts"],
		["swimlane-beta", "swimlane-beta\n  lane Client\n  lane Server"],
		["usecase-beta", "usecase-beta\n  actor User\n  usecase (Login)"],
		["wardley-beta", "wardley-beta\n  component CLI [0.8, 0.7]"],
		["cynefin-beta", "cynefin-beta\n  domain Clear"],
		["eventmodeling", "eventmodeling\n  command SubmitOrder\n  event OrderSubmitted"],
		["agentflow-beta", "agentflow-beta\n  agent Planner\n  agent Executor\n  Planner --> Executor"],
		["railroad-beta", "railroad-beta\n  expr ::= term (\"+\" term)*"],
		["railroad-ebnf-beta", "railroad-ebnf-beta\n  expr = term , { \"+\" , term } ;"],
		["railroad-abnf-beta", "railroad-abnf-beta\n  expr = term *( \"+\" term )"],
		["railroad-peg-beta", "railroad-peg-beta\n  Expr <- Term (\"+\" Term)*"],
		["info", "info"],
	] as const;

	const mermaidCases: readonly MermaidCase[] = [
		{
			status: "rendered",
			name: "flowchart TB with init directive, comments, and semicolon separators",
			source: fence(
				[
					"flowchart TB",
					"  %%{init: {\"theme\": \"dark\"}}%%",
					"  %% comment line",
					"  A[Top] --> B[Middle]; B --> C[Bottom]",
				].join("\n"),
			),
			expectedSubstrings: ["Top", "Middle", "Bottom", "▼"],
		},
		{
			status: "rendered",
			name: "flowchart TD direction",
			source: fence("flowchart TD\n  A[Start] --> B[Finish]"),
			expectedSubstrings: ["Start", "Finish", "▼"],
		},
		{
			status: "rendered",
			name: "graph LR direction",
			source: fence("graph LR\n  A[Left] --> B[Right]"),
			expectedSubstrings: ["Left", "Right", "▶"],
		},
		{
			status: "rendered",
			name: "graph RL direction",
			source: fence("graph RL\n  A[Right] --> B[Left]"),
			expectedSubstrings: ["Right", "Left", "◄"],
		},
		{
			status: "rendered",
			name: "flowchart BT direction",
			source: fence("flowchart BT\n  A[Bottom] --> B[Top]"),
			expectedSubstrings: ["Bottom", "Top", "▲"],
		},
		{
			status: "rendered",
			name: "flowchart subgraphs, nested subgraphs, and tolerated styling directives",
			source: fence(
				[
					"flowchart TB",
					"  subgraph outer[Outer Group]",
					"    direction LR",
					"    subgraph \"Inner Group\"",
					"      A[Alpha]:::hot --> B(Beta)",
					"    end",
					"  end",
					"  classDef hot fill:#f00",
					"  class A hot",
					"  style B stroke:#333",
					"  linkStyle 0 stroke:#0f0",
					"  click A \"https://example.com\"",
				].join("\n"),
			),
			expectedSubstrings: ["Outer Group", "Inner Group", "Alpha", "Beta"],
		},
		{
			status: "rendered",
			name: "flowchart node shapes including trapezoids parsed as literal slash labels",
			source: fence(
				[
					"flowchart TD",
					"  N1[rect] --> N2(round)",
					"  N2 --> N3([stadium])",
					"  N3 --> N4[[subroutine]]",
					"  N4 --> N5[(cylinder)]",
					"  N5 --> N6((circle))",
					"  N6 --> N7{diamond}",
					"  N7 --> N8{{hexagon}}",
					"  N8 --> N9>asymmetric]",
					"  N9 --> N10[/trapezoid\\]",
					"  N10 --> N11[\\trapezoid-alt/]",
				].join("\n"),
			),
			expectedSubstrings: [
				"rect",
				"round",
				"stadium",
				"subroutine",
				"cylinder",
				"circle",
				"diamond",
				"hexagon",
				"asymmetric",
				"/trapezoid\\",
				"\\trapezoid-alt/",
				"┌",
				"╭",
			],
		},
		{
			status: "rendered",
			name: "flowchart link operators and ampersand node group fan-out/fan-in",
			source: fence(
				[
					"flowchart TD",
					"  A & B --> C & D",
					"  D --- E",
					"  E -.-> F",
					"  F -.- G",
					"  G ==> H",
					"  H === I",
					"  I <--> J",
					"  J <-- K",
					"  K --o L",
					"  L o--o M",
					"  M --x N",
					"  N x--x O",
					"  O -->|pipe label| P",
					"  P -- inline label --> Q",
				].join("\n"),
			),
			expectedSubstrings: ["╎", "┃", "o", "×", "pipe label", "inline label"],
		},
		{
			status: "rendered",
			name: "sequenceDiagram participants, actors, autonumber, 8 arrows, activations, notes, dividers, and tolerated directives",
			source: fence(
				[
					"sequenceDiagram",
					"  title Auth Flow",
					"  autonumber",
					"  participant C as Client",
					"  actor U as End User",
					"  box Purple Group",
					"    participant S as Server",
					"  end",
					"  links S: {\"Dashboard\": \"https://example.com\"}",
					"  link S: Docs @ https://example.com",
					"  properties S: {\"role\": \"api\"}",
					"  U->C: solid open",
					"  C-->U: dashed open",
					"  U->>+C: solid arrow activate",
					"  C-->>-U: dashed arrow deactivate",
					"  C-xS: solid cross",
					"  S--xC: dashed cross",
					"  C-)S: solid async",
					"  S--)C: dashed async",
					"  activate S",
					"  Note left of U: Left note",
					"  Note right of S: Right note",
					"  Note over C: Single over",
					"  Note over C,S: Span over",
					"  loop Retry",
					"    C->>S: ping",
					"  end",
					"  alt Valid",
					"    S-->>C: 200",
					"  else Invalid",
					"    S-->>C: 401",
					"  end",
					"  opt Cached",
					"    C->>U: fast path",
					"  end",
					"  par Audit",
					"    S->>S: log",
					"  and Notify",
					"    S->>U: alert",
					"  end",
					"  critical Lock",
					"    C->>S: acquire",
					"  option Timeout",
					"    S-->>C: abort",
					"  end",
					"  break Fatal",
					"    S--xC: halt",
					"  end",
					"  rect rgb(0, 0, 0)",
					"    create participant W as Worker",
					"    S->>W: spawn",
					"    destroy W",
					"  end",
					"  deactivate S",
				].join("\n"),
			),
			expectedSubstrings: [
				"Client",
				"End User",
				"Server",
				"1. solid open",
				"2. dashed open",
				"3. solid arrow activate",
				"4. dashed arrow deactivate",
				"5. solid cross",
				"6. dashed cross",
				"7. solid async",
				"8. dashed async",
				"Left note",
				"Right note",
				"Single over",
				"Span over",
				"loop Retry",
				"alt Valid",
				"else Invalid",
				"opt Cached",
				"par Audit",
				"and Notify",
				"critical Lock",
				"option Timeout",
				"break Fatal",
				"18. spawn",
			],
		},
		{
			status: "rendered",
			name: "stateDiagram and stateDiagram-v2 transitions, choices, forks, joins, composites, notes, concurrency, and style tags",
			source: fence(
				[
					"stateDiagram-v2",
					"  direction LR",
					"  state \"Idle State\" as Idle",
					"  Queued: Waiting for job",
					"  state Check <<choice>>",
					"  state ForkNode <<fork>>",
					"  state JoinNode <<join>>",
					"  [*] --> Idle:::ready",
					"  Idle --> Queued --> Check : dispatch",
					"  Check --> ForkNode",
					"  ForkNode --> Active",
					"  state Active {",
					"    Running --> Paused",
					"    --",
					"    Watching --> Alerted",
					"  }",
					"  Active --> JoinNode",
					"  JoinNode --> [*]",
					"  note right of Idle : Single-line note",
					"  note left of Active",
					"    Multiline note body",
					"  end note",
				].join("\n"),
			),
			expectedSubstrings: [
				"●",
				"Idle State",
				"Waiting for job",
				"Check",
				"dispatch",
				"ForkNode",
				"JoinNode",
				"Running",
				"Paused",
				"Watching",
				"Alerted",
			],
		},
		{
			status: "rendered",
			name: "stateDiagram v1 header compatibility",
			source: fence("stateDiagram\n  [*] --> Ready\n  Ready --> [*]"),
			expectedSubstrings: ["●", "Ready"],
		},
		{
			status: "rendered",
			name: "classDiagram and classDiagram-v2 members, generics, annotations, 14 relationship operators, cardinalities, and directives",
			source: fence(
				[
					"classDiagram-v2",
					"  direction TB",
					"  note \"Top note\"",
					"  namespace Core {",
					"  class Repository~T~ {",
					"    <<interface>>",
					"    +String id",
					"    -int retries",
					"    #bool active",
					"    ~String pkg",
					"    +List~T~ items",
					"    +find(id) T",
					"    #validate() bool",
					"  }",
					"  }",
					"  <<service>> UserService",
					"  UserService : +Repository~User~ repo",
					"  UserService : +load(id) User",
					"  Base <|-- Derived : extends",
					"  Derived --|> Mixin",
					"  Repository~T~ <|.. SqlRepo",
					"  SqlRepo ..|> Auditable",
					"  Order *-- LineItem",
					"  LineItem --* Invoice",
					"  Team o-- Member",
					"  Member --o Club",
					"  Client <-- Server",
					"  UserService \"1\" --> \"0..*\" Order : manages",
					"  Controller <.. View",
					"  View ..> Model",
					"  Alpha -- Beta",
					"  Gamma .. Delta",
					"  classDef highlight fill:#ff0",
					"  cssClass \"UserService\" highlight",
					"  style UserService stroke:#333",
					"  click UserService call onClick()",
					"  link UserService \"https://example.com\"",
					"  callback UserService \"onEvent\"",
				].join("\n"),
			),
			expectedSubstrings: [
				"«interface»",
				"Repository<T>",
				"+String id",
				"-int retries",
				"#bool active",
				"+List<T> items",
				"+find(id) T",
				"«service»",
				"UserService",
				"+Repository<User> repo",
				"1 manages 0..*",
				"extends",
				"△",
				"▽",
				"◆",
				"◇",
			],
		},
		{
			status: "rendered",
			name: "erDiagram entities, single-word aliases, attributes, and identifying/non-identifying crow's-foot cardinalities",
			source: fence(
				[
					"erDiagram",
					"  CUSTOMER[Account] {",
					"    uuid id PK \"primary key\"",
					"    string email UK \"login address\"",
					"  }",
					"  ORDER {",
					"    int order_id PK",
					"  }",
					"  CUSTOMER ||--o{ ORDER : places",
					"  ORDER |{--|| LINE_ITEM : contains",
					"  LINE_ITEM }|--|{ TAG : labels",
					"  TAG |o..o| PROFILE : has",
					"  PROFILE }o..o{ COUPON : applies",
				].join("\n"),
			),
			expectedSubstrings: [
				"Account",
				"uuid id PK",
				"string email UK",
				"ORDER",
				"int order_id PK",
				"1 places 0..*",
				"1..* contains 1",
				"1..* labels 1..*",
				"0..1 has 0..1",
				"0..* applies 0..*",
				"╎",
			],
		},
		{
			status: "warning-fallback",
			name: "flowchart unclosed bracket",
			source: fence("flowchart LR\n  A[unclosed --> B"),
			expectedWarning: 'Mermaid diagram not rendered: node "A": label is missing its closing `]`',
		},
		{
			status: "warning-fallback",
			name: "flowchart (((doublecircle))) shape",
			source: fence("flowchart LR\n  A(((doublecircle))) --> B[normal]"),
			expectedWarning: 'Mermaid diagram not rendered: dropped, expected a link: ") --> B[normal]"',
		},
		{
			status: "warning-fallback",
			name: "flowchart Mermaid v11 @{ shape: ... } syntax",
			source: fence('flowchart LR\n  A@{ shape: cyl, label: "Database" } --> B[Service]'),
			expectedWarning:
				'Mermaid diagram not rendered: dropped, expected a link: "@{ shape: cyl, label: "Database" } --> B[Service]"',
		},
		{
			status: "warning-fallback",
			name: "sequenceDiagram with unreadable final line",
			source: fence("sequenceDiagram\n  Alice->>Bob: Hello\n  unreadable final line"),
			expectedWarning:
				'Mermaid diagram not rendered: dropped, unreadable final line: "unreadable final line"',
		},
		{
			status: "warning-fallback",
			name: "stateDiagram-v2 with unreadable final line",
			source: fence("stateDiagram-v2\n  [*] --> Idle\n  unreadable final line"),
			expectedWarning:
				'Mermaid diagram not rendered: dropped, unreadable final line: "unreadable final line"',
		},
		{
			status: "warning-fallback",
			name: "classDiagram with unreadable final line",
			source: fence("classDiagram\n  Animal <|-- Duck\n  unreadable final line"),
			expectedWarning:
				'Mermaid diagram not rendered: dropped, unreadable final line: "unreadable final line"',
		},
		{
			status: "warning-fallback",
			name: "erDiagram with unreadable final line",
			source: fence("erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  unreadable final line"),
			expectedWarning:
				'Mermaid diagram not rendered: dropped, unreadable final line: "unreadable final line"',
		},
		{
			status: "source-fallback",
			name: "YAML frontmatter before flowchart",
			source: fence("---\ntitle: Sample\n---\nflowchart LR\n  A --> B"),
		},
		{
			status: "source-fallback",
			name: "multi-word ER entity alias",
			source: fence('erDiagram\n  CUSTOMER["Customer Account"] ||--o{ ORDER : places'),
		},
		...unsupportedMermaid12Headers.map(
			([header, body]): MermaidCase => ({
				status: "source-fallback",
				name: `unsupported Mermaid 12.2.0 header: ${header}`,
				source: fence(body),
			}),
		),
	];

	for (const testCase of mermaidCases) {
		const plainOutput = transformBuiltInMermaid(testCase.source, 300);
		const themedOutput = transformBuiltInMermaid(testCase.source, 300, activePiGlobalTheme);
		const strippedThemedOutput = stripTerminalSequences(themedOutput);

		switch (testCase.status) {
			case "rendered": {
				assert.ok(
					!plainOutput.includes("```mermaid"),
					`${testCase.name}: plain output replaces mermaid fence`,
				);
				assert.ok(
					!plainOutput.includes("Mermaid diagram not rendered:"),
					`${testCase.name}: plain output emits no warning`,
				);
				assert.ok(
					!themedOutput.includes("```mermaid"),
					`${testCase.name}: themed output replaces mermaid fence`,
				);
				assert.equal(
					strippedThemedOutput,
					plainOutput,
					`${testCase.name}: stripped themed output matches plain output`,
				);
				for (const expected of testCase.expectedSubstrings) {
					assert.ok(
						plainOutput.includes(expected),
						`${testCase.name}: expected rendered output to include ${JSON.stringify(expected)}`,
					);
				}
				break;
			}
			case "warning-fallback": {
				assert.ok(
					plainOutput.startsWith(`${testCase.source}\n`),
					`${testCase.name}: plain output preserves original fence before warning`,
				);
				assert.ok(
					plainOutput.includes(testCase.expectedWarning),
					`${testCase.name}: plain output includes expected warning`,
				);
				assert.ok(
					themedOutput.startsWith(`${testCase.source}\n`),
					`${testCase.name}: themed output preserves original fence before warning`,
				);
				assert.ok(
					strippedThemedOutput.includes(testCase.expectedWarning),
					`${testCase.name}: themed output includes expected warning`,
				);
				break;
			}
			case "source-fallback": {
				assert.equal(
					plainOutput,
					testCase.source,
					`${testCase.name}: plain output returns exact source fence`,
				);
				assert.equal(
					themedOutput,
					testCase.source,
					`${testCase.name}: themed output returns exact source fence`,
				);
				break;
			}
			default: {
				const _exhaustive: never = testCase;
				return _exhaustive;
			}
		}
	}

	const wideSource = [
		"```mermaid",
		"flowchart LR",
		"  NodeAlpha[First Wide Stage] --> NodeBeta[Second Wide Stage] --> NodeGamma[Third Wide Stage]",
		"```",
	].join("\n");
	const narrowResult = transformBuiltInMermaid(wideSource, 25, activePiGlobalTheme);
	assert.equal(narrowResult, wideSource);
});

test("4. BuiltInDocumentComponent renders every section within width bounds, formats tables, math, diffs, image fallbacks, and refreshes colors on invalidate()", () => {
	setCapabilityOverrides({ images: null });
	resetCapabilitiesCache();

	const documents = [["all", makeDocument()], ...SECTION_IDS.map((id) => [id, sectionDocument(id)])] as const;
	for (const [selection, doc] of documents) {
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
		new BuiltInDocumentComponent(sectionDocument("tables"), activePiGlobalTheme).render(100).join("\n"),
	);
	assert.ok(tablesPlain.includes("┌─"));
	assert.ok(tablesPlain.includes("├─"));
	assert.ok(tablesPlain.includes("└─"));

	const mathPlain = stripTerminalSequences(
		new BuiltInDocumentComponent(sectionDocument("math"), activePiGlobalTheme).render(100).join("\n"),
	);
	assert.ok(mathPlain.includes("∑"));
	assert.ok(mathPlain.includes("∫"));
	assert.ok(mathPlain.includes("⎛"));
	assert.ok(mathPlain.includes("⎧"));

	const mermaidPlain = stripTerminalSequences(
		new BuiltInDocumentComponent(sectionDocument("mermaid"), activePiGlobalTheme).render(100).join("\n"),
	);
	assert.ok(mermaidPlain.includes("mermaid@12.2.0"), "includes official Mermaid 12.2.0 baseline version");
	assert.ok(mermaidPlain.includes("grok-mermaid@0.2.3"), "includes bundled grok-mermaid 0.2.3 version");
	assert.ok(mermaidPlain.includes("subroutine") && mermaidPlain.includes("cylinder"), "renders flowchart box art");
	assert.ok(
		mermaidPlain.includes("1. solid open") && mermaidPlain.includes("8. dashed async"),
		"renders sequenceDiagram box art",
	);
	assert.ok(
		mermaidPlain.includes("●") && mermaidPlain.includes("Waiting for request"),
		"renders stateDiagram-v2 box art",
	);
	assert.ok(
		mermaidPlain.includes("«interface»") && mermaidPlain.includes("Repository<T>"),
		"renders classDiagram box art",
	);
	assert.ok(
		mermaidPlain.includes("1 places 0..*") && mermaidPlain.includes("uuid id PK"),
		"renders erDiagram box art",
	);
	assert.ok(
		mermaidPlain.includes("Mermaid diagram not rendered:"),
		"includes syntax warning fallback diagnostic",
	);
	for (const unsupportedHeader of [
		"pie title Pets",
		"gantt",
		"xychart-beta",
		"gitGraph",
		"mindmap",
		"timeline",
		"journey",
		"quadrantChart",
		"sankey-beta",
		"requirementDiagram",
		"C4Context",
		"kanban",
		"block-beta",
		"packet-beta",
		"architecture-beta",
		"radar-beta",
		"treemap",
		"zenuml",
	]) {
		assert.ok(
			mermaidPlain.includes(unsupportedHeader),
			`retains source fallback fence for ${unsupportedHeader}`,
		);
	}

	const diffRaw = new BuiltInDocumentComponent(sectionDocument("diff"), activePiGlobalTheme)
		.render(100)
		.join("\n");
	const diffPlain = stripTerminalSequences(diffRaw);
	assert.ok(diffRaw.includes("\x1b[7m"), "renderDiff highlights intra-line token edits with inverse ANSI");
	assert.ok(diffRaw.includes("\x1b["), "renderDiff emits theme ANSI color sequences");
	assert.ok(diffPlain.includes("-") && diffPlain.includes("+"));

	const imagePlain = stripTerminalSequences(
		new BuiltInDocumentComponent(sectionDocument("image"), activePiGlobalTheme).render(100).join("\n"),
	);
	assert.ok(imagePlain.includes("[Image:"));
	assert.ok(imagePlain.includes("[image/png]"));

	setTheme("dark");
	const themeComp = new BuiltInDocumentComponent(makeDocument(), activePiGlobalTheme);
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

test("5. piBuiltInRenderExtension coexists with prismExtension without prism interception or LLM context leakage", async () => {
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

	assert.equal(builtInCmd.getArgumentCompletions, undefined, "offers no argument completions");
	const removedArgs = ["all", "demo", "mermaid", "help", "-h", "--help", "math mermaid"];
	for (const arg of removedArgs) {
		await builtInCmd.handler(arg, h.ctx);
	}
	assert.equal(h.appendedEntries.length, 0, "an argument appends no entry");
	assert.deepEqual(h.notifications.map((n) => n.level), removedArgs.map(() => "warning"));

	await builtInCmd.handler("  ", h.ctx);
	assert.equal(h.sentCustomMessages.length, 0, "never calls pi.sendMessage");
	assert.equal(h.appendedEntries.length, 1);
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
		{ role: "custom", customType: ENTRY_TYPE, details: h.appendedEntries[0]?.data },
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
