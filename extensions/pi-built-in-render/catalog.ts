import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { DemoDocument, SectionBlock } from "./render.ts";

export type SectionSpec = {
	readonly title: string;
	readonly description: string;
	readonly blocks: readonly [SectionBlock, ...SectionBlock[]];
};

function markdown(source: string): SectionBlock {
	return { kind: "markdown", source };
}

function mermaid(source: string): SectionBlock {
	return markdown("```mermaid\n" + source + "\n```\n");
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
		description: "Five native diagram families. Unsupported syntax, warnings, and diagrams wider than the terminal retain their source fences.",
		blocks: [
			mermaid(`flowchart LR
  subgraph Input
    A[rect] --> B(round)
  end
  B -. dotted .-> C{diamond}
  C ==> D([stadium])`),
			mermaid(`flowchart TD
  subgraph Storage
    A[[subroutine]] --> B[(cylinder)]
  end
  B --> C((circle))
  C -->|solid label| D[done]`),
			mermaid(`graph LR
  A[graph alias] --> B[also supported]`),
			mermaid(`sequenceDiagram
  autonumber
  participant U as User
  participant S as Server
  U->>S: Request
  S->>S: Validate
  Note right of S: Local check
  loop Retry
    U->>S: Poll
    S-->>U: Status
  end
  alt Ready
    S-->>U: Result
  else Waiting
    S-->>U: Pending
  end
  opt Cache
    S->>S: Store result
  end`),
			mermaid(`stateDiagram-v2
  [*] --> Idle
  state decision <<choice>>
  Idle: Waiting for a request
  Idle --> decision: receive
  decision --> Running: valid
  decision --> Idle: invalid
  Running --> [*]: complete`),
			mermaid(`classDiagram
  class Reader {
    <<interface>>
    +read() string
  }
  class File {
    -name string
    #open() bool
    +read() string
  }
  Reader <|-- File
  File *-- Buffer
  Folder o-- File
  File ..> Decoder`),
			mermaid(`erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER }o--|| STORE : belongs
  CUSTOMER {
    int id PK
    string name
  }
  ORDER {
    int id PK
    int customer_id FK
  }
  STORE {
    int id PK
  }`),
			markdown("The next malformed flowchart demonstrates the native syntax warning and source fallback."),
			mermaid("flowchart LR\n  A[unclosed --> B"),
			markdown("The next unsupported diagram stays as source. The long chain after it exceeds eighty columns and also stays as source at ordinary terminal widths."),
			mermaid("pie\n  title Unsupported family\n  \"Examples\" : 3"),
			mermaid(`flowchart LR
  A[First long node] --> B[Second long node] --> C[Third long node] --> D[Fourth long node] --> E[Fifth long node] --> F[Sixth long node] --> G[Seventh long node]`),
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

export type SectionId = keyof typeof SECTIONS;
export type Selection = "all" | SectionId;

export type CommandTarget =
	| { readonly kind: "show"; readonly selection: Selection }
	| { readonly kind: "help" }
	| { readonly kind: "invalid"; readonly explanation: string };

export function isSectionId(value: string): value is SectionId {
	return Object.hasOwn(SECTIONS, value);
}

const sectionIds = Object.keys(SECTIONS).filter(isSectionId);
const argumentsList = ["all", "demo", ...sectionIds, "help"];

export function parseCommandArgs(args: string): CommandTarget {
	const token = args.trim();
	if (token === "" || token === "all" || token === "demo") return { kind: "show", selection: "all" };
	if (token === "help" || token === "-h" || token === "--help") return { kind: "help" };
	if (isSectionId(token)) return { kind: "show", selection: token };
	return { kind: "invalid", explanation: `Use one argument: ${argumentsList.join(", ")}.` };
}

export function getBuiltInRenderCompletions(prefix: string): AutocompleteItem[] | null {
	const token = prefix.trim();
	if (/\s/.test(token)) return null;
	const matches = argumentsList.filter((value) => value.startsWith(token)).map((value) => ({
		value,
		label: value,
		description: isSectionId(value) ? SECTIONS[value].description
			: value === "help" ? "List commands and sections" : "Render every section",
	}));
	return matches.length > 0 ? matches : null;
}

export function makeDocument(selection: Selection): DemoDocument {
	const blocks: [SectionBlock, ...SectionBlock[]] = [markdown("# Pi built-in render\n\nThese examples use stock Pi components without assistant-message transforms.")];
	const selected = selection === "all" ? sectionIds : [selection];
	for (const id of selected) {
		const section = SECTIONS[id];
		blocks.push(markdown(`## ${section.title}\n\n${section.description}`), ...section.blocks);
	}
	return { version: 1, blocks };
}

export function makeHelpDocument(): DemoDocument {
	return { version: 1, blocks: [markdown([
		"# Pi built-in render help",
		"Use `/pi-built-in-render` with no argument, `all`, or `demo` for every section.",
		"Use one section name to render only that section. Arguments are lowercase and case-sensitive.",
		...sectionIds.map((id) => `- \`${id}\`: ${SECTIONS[id].description}`),
		"Use `help`, `-h`, or `--help` for this page.",
		"Output stays in the transcript on resume and does not enter model context. No model turn is requested.",
		"OSC-8 hyperlinks and Kitty or iTerm2 inline images depend on terminal capabilities. Other terminals use stock fallbacks.",
	].join("\n\n"))] };
}
