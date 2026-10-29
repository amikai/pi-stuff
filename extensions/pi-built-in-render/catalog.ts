import type { DemoDocument, SectionBlock } from "./render.ts";

export type SectionSpec = {
	readonly title: string;
	readonly description: string;
	readonly blocks: readonly [SectionBlock, ...SectionBlock[]];
};

function markdown(source: string): SectionBlock {
	return { kind: "markdown", source };
}

const BAND_PNG = "iVBORw0KGgoAAAANSUhEUgAAAUAAAAAoCAIAAAAAIrR+AAACdElEQVR42u3TewcQBgAA8ZNkkkySJEmSJJOWrW3t/cyWJJlMkmQmSZIkSSaTJEmSJEmStLS0trX3smVLkiRJkiTJZCZJdrNvsP0xNu73Fc4hOBAfwyH4OA7HkTgax+J4nIiTcQpOw+k4A1/EV/FNfBtn41x8F9/DhbgY38eluBxX4mpci+vxQ/wIN+NW3I47cTfuxf14EA/jUTyOJ/EUfo3f44/4M57DC3gJr+A1vIG38A7+ir/hfXyIf/BIHsjvck/uym25KdflqlyWi3JezsoZOS3fyVfyuZyQY3JEDskB2Sd7ZJfskG2yRTbJRtkg62SNrJIVskw+kCWySBbIfJknc2SWzJQ35BV5QZ6Vp2SqPCGTZIKMkzEySkbIMBkqg2WQDPgrwAAchINxKA7DETgKx+A4nICT8Amcik/hM/g8voyv40ychXNwHs7HBbgIl+AHuAxX4Cpcg+twA27ETbgFt+EO3IV7cB8ewEN4BI/hCfwMv8Rv8TSewbN4Hi/iZbyK1/Em3sa7eA9/xwf4iD/kodyX3+RXuSO35IZckytySS7IOflFfpIf5Bs5JSfluByVw3JQ9ste2S07Zbtslc3ykXwo62WtrJaVslyWyvuyWBbKe/KuzJXZ8o68Ja/JSzJDpss0mSKTZaKMl7EyWkbKcHlchshjMvDvHvAkPo3P/TsHfIyf4Kf4xT88YABJ/rcaOGngJA2cpIGTBk7SwEkaOEkDJw2cpIGTNHDSwEkaOEkDJ2ngpIGTNHCSBk7SwEkDJ2ngJA2cNHCSBk7SwEkaOGngJA2cpIGTNHDSwEkaOEkDJw2cpIGTNHCSBk4aOMl/yZ8SRd1gPq93WQAAAABJRU5ErkJggg==";

export const SECTIONS = {
	markdown: {
		title: "Markdown typography",
		description: "Stock headings, emphasis, code, and terminal hyperlinks.",
		blocks: [markdown(`# Heading 1
## Heading 2
### Heading 3
#### Heading 4

**Bold text**, *italic text*, ~~strikethrough~~, and \`inline code\`.

[Pi documentation](https://github.com/earendil-works/pi) uses OSC-8 hyperlinks when the terminal supports them.
A bare URL also becomes a link: https://example.com/pi-built-in-render

**中文強調**與*斜體* keep emphasis next to CJK characters.
`)],
	},
	lists: {
		title: "Lists and tasks",
		description: "Unordered markers, numbered starts, nesting, and checkboxes.",
		blocks: [markdown(`- Dash marker
- Another dash
  - Nested unordered item
    1. Nested ordered item
    2. Second nested item

* Asterisk marker
* Another asterisk

1. First ordered item
2. Second ordered item

A list with a custom start follows.

3. Starts at three
4. Continues at four

- [x] Completed task
- [ ] Pending task
  - [x] Completed nested task
`)],
	},
	quotes: {
		title: "Quotes and rules",
		description: "Multiple paragraphs, nested quotes, and block content inside quotes.",
		blocks: [markdown(`> First quoted paragraph with **emphasis**.
>
> Second quoted paragraph keeps the same quote border.
>
> > A nested quotation.
>
> - A quoted list item
> - Another quoted list item
>
> \`\`\`ts
> const quoted = true;
> \`\`\`

---

A horizontal rule separates this paragraph from the quote.
`)],
	},
	tables: {
		title: "Tables",
		description: "GFM tables use box-drawn borders such as ┌─┬─┐ and wrap cells to the available width.",
		blocks: [markdown(`| Left aligned | Center aligned | Right aligned |
| :--- | :---: | ---: |
| **Bold cell** | *Italic cell* | 42 |
| 中文欄位 | 日本語の文字 | 1234 |
| \`inline code\` | [Link](https://example.com) | 9 |
| This deliberately long description wraps across multiple lines in the stock table renderer, including at a terminal width of ninety columns. | Another long cell contains enough words to show centered multiline content without dropping CJK characters 中文. | 98765 |
`)],
	},
	code: {
		title: "Code fences",
		description: "Language-specific highlighting and an unlabelled text fallback.",
		blocks: [markdown(`\`\`\`ts
interface Greeting { name: string }
const greet = ({ name }: Greeting): string => \`Hello, \${name}!\`;
console.log(greet({ name: "Pi" }));
\`\`\`

\`\`\`python
def squares(values: list[int]) -> list[int]:
    return [value ** 2 for value in values if value > 0]
print(squares([1, 2, 3]))
\`\`\`

\`\`\`json
{"renderer": "built-in", "enabled": true, "widths": [40, 90]}
\`\`\`

\`\`\`bash
for section in markdown math mermaid; do
  printf '%s\\n' "$section"
done
\`\`\`

\`\`\`
Unlabelled code preserves    spaces.
No language-specific highlighting is requested.
\`\`\`
`)],
	},
	math: {
		title: "LaTeX math",
		description: "Stock inline symbols and two-dimensional display math.",
		blocks: [markdown(String.raw`Inline dollars $\alpha + \beta = \gamma$ and parentheses \(x_i^2 \neq y\).

Operators and relations $\sin\theta + \cos\theta \leq 2$, $x \not\in \mathbb{Z}$, and $x \in \mathbb{R}$.

Roots $\sqrt{x} + \sqrt[3]{y}$, accents $\hat{x} + \vec{v}$, binomials $\binom{n}{k}$, and $\boxed{a \equiv b \pmod{p}}$.

$$
\frac{1 + \frac{a}{b}}{1 + x^2} + \sum_{i=1}^n i^2
$$

\[
\int_0^\infty e^{-x}\,dx = 1
\]

\[
\lim_{x \to 0}\frac{\sin x}{x} = 1
\]

$$
\begin{pmatrix} a & b \\ c & d \end{pmatrix}
\quad
\begin{bmatrix} 1 & 2 \\ 3 & 4 \end{bmatrix}
\quad
\begin{Bmatrix} x & y \\ z & w \end{Bmatrix}
$$

$$
\begin{vmatrix} a & b \\ c & d \end{vmatrix}
\quad
\begin{Vmatrix} 1 & 0 \\ 0 & 1 \end{Vmatrix}
$$

$$
f(x) = \begin{cases} x^2 & x \geq 0 \\ -x & x < 0 \end{cases}
$$

\[
\begin{aligned}
a + b &= c \\
x &= \frac{c-b}{a}
\end{aligned}
\]
`)],
	},
	mermaid: {
		title: "Mermaid diagrams",
		description: "Mermaid 12.2.0 vs grok-mermaid 0.2.3 support table, 5 native diagram families, syntax warnings, and source fallbacks.",
		blocks: [
			markdown(`Baseline comparison of official \`mermaid@12.2.0\` (35 diagram families) against stock Pi's bundled \`grok-mermaid@0.2.3\` in \`@earendil-works/pi-coding-agent@1.4.0\`.

| Category | Mermaid 12.2.0 families and stock Pi behavior |
| :--- | :--- |
| Native (5) | \`flowchart\` (\`graph\`), \`sequenceDiagram\`, \`stateDiagram-v2\` (\`stateDiagram\`), \`classDiagram\` (\`classDiagram-v2\`), and \`erDiagram\` render as box-drawn ASCII and Unicode art when width fits. |
| Prism (3) | \`pie\`, \`gantt\`, and \`xychart-beta\` (\`xychart\`) stay as \`\`\`\` \`\`\`mermaid \`\`\`\` source fences in stock Pi, and render as charts when \`prism\` is active. |
| Source (27) | \`flowchart-elk\`, \`gitGraph\`, \`mindmap\`, \`timeline\`, \`journey\`, \`quadrantChart\`, \`sankey-beta\`, \`requirementDiagram\`, \`C4Context\`, \`kanban\`, \`block-beta\`, \`packet-beta\`, \`architecture-beta\`, \`radar-beta\`, \`treemap\`, \`zenuml\`, \`ishikawa-beta\`, \`venn-beta\`, \`treeView-beta\`, \`swimlane-beta\`, \`usecase-beta\`, \`wardley-beta\`, \`cynefin-beta\`, \`eventmodeling\`, \`agentflow-beta\`, \`railroad-beta\`, and \`info\` stay as \`\`\`\` \`\`\`mermaid \`\`\`\` source fences. |
| Warnings | Partial parses emit the original \`\`\`\` \`\`\`mermaid \`\`\`\` source fence followed by \`Mermaid diagram not rendered: ...\`. |
| Overflow | Diagrams wider than the available terminal width or prefixed with YAML frontmatter (\`---\`) stay as \`\`\`\` \`\`\`mermaid \`\`\`\` source fences with no warning. |
`),
			markdown(`### 1. Flowchart (\`flowchart\` and \`graph\`)

Directions (\`LR\`, \`TD\`, \`RL\`, \`BT\`), \`%%{init: ...}%%\` directives, and \`subgraph\` containers.

\`\`\`mermaid
flowchart LR
  %%{init: {"theme": "dark"}}%%
  subgraph Input
    A[rect] --> B(round)
  end
  B -.-> C{diamond}
  C ==> D([stadium])
\`\`\`

\`\`\`mermaid
graph RL
  A[Right] --> B[Left]
\`\`\`

\`\`\`mermaid
flowchart BT
  A[Bottom] --> B[Top]
\`\`\`
`),
			markdown(`All 9 native flowchart node shapes (\`[rect]\`, \`(round)\`, \`([stadium])\`, \`[[subroutine]]\`, \`[(cylinder)]\`, \`((circle))\`, \`{diamond}\`, \`{{hexagon}}\`, \`>asymmetric]\`).

\`\`\`mermaid
flowchart TD
  N1[rect] --> N2(round)
  N2 --> N3([stadium])
  N3 --> N4[[subroutine]]
  N4 --> N5[(cylinder)]
  N5 --> N6((circle))
  N6 --> N7{diamond}
  N7 --> N8{{hexagon}}
  N8 --> N9>asymmetric]
\`\`\`

All 14 link styles (\`-->\`, \`---\`, \`-.->\`, \`-.-\`, \`==>\`, \`===\`, \`<-->\`, \`<--\`, \`--o\`, \`o--o\`, \`--x\`, \`x--x\`, \`-->|label|\`, \`-- inline -->\`) and \`&\` fan-out and fan-in.

\`\`\`mermaid
flowchart TD
  A & B --> C & D
  D --- E
  E -.-> F
  F -.- G
  G ==> H
  H === I
  I <--> J
  J <-- K
  K --o L
  L o--o M
  M --x N
  N x--x O
  O -->|label| P
  P -- inline --> Q
\`\`\`
`),
			markdown(`### 2. Sequence diagram (\`sequenceDiagram\`)

\`autonumber\`, \`participant\` and \`actor\` with \`as\`, all 8 message arrows (\`->\`, \`-->\`, \`->>\`, \`-->>\`, \`-x\`, \`--x\`, \`-)\`, \`--)\`), \`+\` and \`-\` activations, \`Note left of\`, \`Note right of\`, \`Note over\`, and control blocks (\`loop\`, \`alt\`/\`else\`, \`opt\`, \`par\`/\`and\`, \`critical\`/\`option\`, \`break\`).

\`\`\`mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant C as Client
  participant S as Server
  U->C: solid open
  C-->U: dashed open
  U->>+C: solid arrow activate
  C-->>-U: dashed arrow deactivate
  C-xS: solid cross
  S--xC: dashed cross
  C-)S: solid async
  S--)C: dashed async
  Note left of U: Left note
  Note right of S: Right note
  Note over C,S: Spanning note
  loop Retry
    C->>S: poll
  end
  alt Ready
    S-->>C: 200 OK
  else Pending
    S-->>C: 202 Wait
  end
  opt Cache
    C->>U: cached
  end
  par Audit
    S->>S: log
  and Notify
    S->>U: alert
  end
  critical Lock
    C->>S: acquire
  option Busy
    S-->>C: retry
  end
  break Fatal
    S--xC: halt
  end
\`\`\`
`),
			markdown(`### 3. State diagram (\`stateDiagram-v2\` and \`stateDiagram\`)

\`[*]\` start and end terminals, \`state "Label" as id\`, \`id: description\`, \`<<choice>>\`, \`<<fork>>\`, \`<<join>>\`, composite state \`state Comp { ... }\`, and \`note\`.

\`\`\`mermaid
stateDiagram-v2
  [*] --> Idle
  state "Idle State" as Idle
  Idle: Waiting for request
  state Check <<choice>>
  state ForkNode <<fork>>
  state JoinNode <<join>>
  Idle --> Check: receive
  Check --> ForkNode: valid
  Check --> Idle: invalid
  ForkNode --> Comp
  state Comp {
    Running --> Done
  }
  Comp --> JoinNode
  JoinNode --> [*]
  note right of Idle: Ready for work
\`\`\`

\`\`\`mermaid
stateDiagram
  [*] --> Ready
  Ready --> [*]
\`\`\`
`),
			markdown(`### 4. Class diagram (\`classDiagram\`)

\`<<interface>>\`, \`+\`/\`-\`/\`#\` visibility, generics \`~T~\` (\`<T>\`), major relationship operators (\`<|--\`, \`<|..\`, \`*--\`, \`o--\`, \`-->\`, \`..>\`, \`--\`, \`..\`), and quoted cardinalities \`"1" --> "0..*"\`.

\`\`\`mermaid
classDiagram
  class Repository~T~ {
    <<interface>>
    +String id
    -int retries
    #bool active
    +find(id) T
  }
  class SqlRepo {
    +connect() bool
  }
  Base <|-- SqlRepo
  Repository~T~ <|.. SqlRepo
  Order *-- LineItem
  Team o-- Member
  Service "1" --> "0..*" Order : manages
  SqlRepo ..> Driver
  Alpha -- Beta
  Gamma .. Delta
\`\`\`
`),
			markdown(`### 5. ER diagram (\`erDiagram\`)

Entities with \`PK\`, \`FK\`, and \`UK\` attributes and quoted comments, single-word entity alias \`CUSTOMER[Account]\`, and identifying (\`--\`) and non-identifying (\`..\`) crow's-foot cardinalities (\`||\`, \`|o\`, \`o|\`, \`}o\`, \`o{\`, \`|{\`, \`}|\`).

\`\`\`mermaid
erDiagram
  CUSTOMER[Account] {
    uuid id PK "primary key"
    string email UK "login email"
  }
  ORDER {
    int id PK "order key"
    uuid customer_id FK "owner"
  }
  CUSTOMER ||--o{ ORDER : places
  ORDER |{--|| LINE_ITEM : contains
  LINE_ITEM }|--|{ TAG : labels
  TAG |o..o| PROFILE : has
  PROFILE }o..o{ COUPON : applies
\`\`\`
`),
			markdown(`### 6. Syntax warning fallbacks

Retained \`\`\`\` \`\`\`mermaid \`\`\`\` source fence plus \`Mermaid diagram not rendered: ...\` warning for unclosed brackets (\`A[unclosed --> B\`), \`(((doublecircle)))\`, Mermaid v11 \`@{ shape: ... }\`, and an unreadable final line in a strict-grammar diagram.

\`\`\`mermaid
flowchart LR
  A[unclosed --> B
\`\`\`

\`\`\`mermaid
flowchart LR
  A(((doublecircle))) --> B[normal]
\`\`\`

\`\`\`mermaid
flowchart LR
  A@{ shape: cyl, label: "Database" } --> B[Service]
\`\`\`

\`\`\`mermaid
sequenceDiagram
  Alice->>Bob: Hello
  unreadable final line
\`\`\`
`),
			markdown(`### 7. Source fallbacks

Retained \`\`\`\` \`\`\`mermaid \`\`\`\` source fences with no warning for width overflow, YAML frontmatter (\`---\`), and unsupported \`mermaid@12.2.0\` families (\`pie\`, \`gantt\`, \`xychart-beta\`, \`gitGraph\`, \`mindmap\`, \`timeline\`, \`journey\`, \`quadrantChart\`, \`sankey-beta\`, \`requirementDiagram\`, \`C4Context\`, \`kanban\`, \`block-beta\`, \`packet-beta\`, \`architecture-beta\`, \`radar-beta\`, \`treemap\`, \`zenuml\`).

\`\`\`mermaid
flowchart LR
  A[First long node] --> B[Second long node] --> C[Third long node] --> D[Fourth long node] --> E[Fifth long node] --> F[Sixth long node] --> G[Seventh long node]
\`\`\`

\`\`\`mermaid
---
title: Frontmatter Fallback
---
flowchart LR
  A --> B
\`\`\`

\`\`\`mermaid
pie title Pets
  "Dogs" : 45
  "Cats" : 30
\`\`\`

\`\`\`mermaid
gantt
  title Release Plan
  section Core
  Build :a1, 2026-01-01, 5d
\`\`\`

\`\`\`mermaid
xychart-beta
  title "Throughput"
  x-axis [Q1, Q2]
  bar [12, 18]
\`\`\`

\`\`\`mermaid
gitGraph
  commit
  branch feat
  checkout feat
  commit
\`\`\`

\`\`\`mermaid
mindmap
  root((Pi))
    Extensions
    Themes
\`\`\`

\`\`\`mermaid
timeline
  title Releases
  2026 : v1.4.0
\`\`\`

\`\`\`mermaid
journey
  title Onboarding
  section Start
    Run CLI: 5: User
\`\`\`

\`\`\`mermaid
quadrantChart
  title Priority
  x-axis Low --> High
  y-axis Low --> High
  Item A: [0.3, 0.8]
\`\`\`

\`\`\`mermaid
sankey-beta
  Input,Process,10
\`\`\`

\`\`\`mermaid
requirementDiagram
  requirement test_req {
    id: 1
    text: verify
    risk: low
    verifymethod: test
  }
\`\`\`

\`\`\`mermaid
C4Context
  Person(user, "User")
  System(sys, "Pi")
\`\`\`

\`\`\`mermaid
kanban
  Todo
    [Write tests]
\`\`\`

\`\`\`mermaid
block-beta
  columns 2
  a["Lexer"] b["Renderer"]
\`\`\`

\`\`\`mermaid
packet-beta
  0-7: "Magic"
  8-15: "Version"
\`\`\`

\`\`\`mermaid
architecture-beta
  service api(server)[API]
  service db(database)[DB]
  api:R --> L:db
\`\`\`

\`\`\`mermaid
radar-beta
  axis Speed, Safety, Ergonomics
  curve c1{80, 90, 85}
\`\`\`

\`\`\`mermaid
treemap
  "Root"
    "Leaf": 10
\`\`\`

\`\`\`mermaid
zenuml
  Alice->Bob.greet()
\`\`\`
`),
		],
	},
	diff: {
		title: "Numbered diffs",
		description: "The isolated one-line replacement uses inverse styling for changed words. A separate hunk replaces several lines.",
		blocks: [{ kind: "diff", numberedDiff: ` 11 function greet() {
-12   return "Hello world";
+12   return "Hello Pi";
 13 }
 14
 15 function load() {
-16   const value = readFile();
-17   return parse(value);
+16   const source = readFile("settings.json");
+17   const settings = JSON.parse(source);
+18   return validate(settings);
 19 }` }],
	},
	image: {
		title: "Inline images",
		description: "Kitty and iTerm2 terminals can display this embedded PNG inline. Other terminals show Pi's text fallback with the filename and dimensions.",
		blocks: [{ kind: "image", mimeType: "image/png", base64: BAND_PNG, filename: "built-in-band.png" }],
	},
} satisfies Record<string, SectionSpec>;

export function makeDocument(): DemoDocument {
	const blocks: [SectionBlock, ...SectionBlock[]] = [markdown("# Pi built-in render\n\nThese examples use stock Pi components without assistant-message transforms.")];
	for (const section of Object.values(SECTIONS)) {
		blocks.push(markdown(`## ${section.title}\n\n${section.description}`), ...section.blocks);
	}
	return { version: 1, blocks };
}
