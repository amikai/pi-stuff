export const HINT = [
	"Replies in this session are drawn by prism inside Pi (not a command or tool to call: when asked to show something with prism, write it as markdown in the reply).",
	"Markdown tables, GitHub alerts (> [!WARNING], > [!NOTE]), fenced code with a language tag, and ```mermaid blocks render as colored terminal graphics:",
	'flowcharts, sequence diagrams, xychart-beta bar or line charts (name each series for the legend: line "east" [..]), pie charts and gantt schedules.',
	"When a reply carries a numeric series or a flow that is easier to see than read, add a small diagram or chart with short labels, not a second picture of what a figure already shows.",
	"Skip diagrams and pictures for short or simple answers.",
	"Put any command or snippet the user may run or copy in a fenced block with a language tag, never inline code: fenced blocks get a copy button, inline code does not.",
].join(" ");

export const showcaseText = (): string => `
# prism

Colored markdown for Pi replies: **bold**, *italic*, ~~struck~~, \`inline code\`, a [link](https://buildwithpi.ai) and a bare URL https://github.com/amikai/pi-stuff, both clickable, numbers like 99.9% and 250ms, paths like ~/src/app.ts.

Paths like ~/src/app.ts, ./README.md and /tmp/app.ts open on click in a terminal that draws hyperlinks, and so does a local link that shows its own path, like [/tmp/notes.md](file:///tmp/notes.md), while slash commands like /prism stay text. A local link with any other name, like [notes](file:///tmp/notes.md), draws as its name and target, so it cannot hide where a click goes.

Paths written without ./, like docs/guide/ or src/app.ts:42, and Windows paths like C:\\work\\plan.md link too, once a check finds them on disk; prose like and/or stays text.

Programs and launchers stay plain text, so a click never runs one: ./install.sh, ~/Desktop/setup.command and /Applications/Calculator.app keep the path color without a link.

Code-shaped prose stays as written: f(*args, **kwargs), a link with parentheses [Foo_(bar)](https://en.wikipedia.org/wiki/Foo_(bar)), a file link [\`index.ts\`](https://github.com/amikai/pi-stuff/blob/main/extensions/prism/index.ts) and **bold with *italic* inside**.

## Commands

| Command | Does |
|---------|------|
| \`/prism\` | Help screen |
| \`/prism setup\` | Pick how tables, tasks, headings, copy buttons, prompts, times and pie charts look, from drawn samples |
| \`/prism demo\` | This screen |
| \`/prism demo-rtl\` | Hebrew right-to-left showcase |

Colors follow Pi's active theme (\`/settings\` → \`Theme\`).

> [!TIP]
> Any color slot can be overridden in \`~/.pi/agent/prism.json\`, such as \`headingColor\` or \`numberColor\`.

## Everything it draws

### Copy tables

Use \`⧉ md\` for Markdown, \`⧉ art\` for chat, or \`⧉ html\` for a formatted table. \`⧉ html\` shows in a local macOS, Linux or Windows terminal and writes HTML and tab-separated plain text together; Linux needs CopyQ running. Pasted into Slack it makes a native table; Slack keeps cell text but drops bold, links and alignment. If that fails, it copies the plain text alone. Set \`copyButtonStyle\` to \`hover\` in \`~/.pi/agent/prism.json\` and each block shows a dim ⧉ instead: point at it for its buttons.

| Item | Quantity[^count] | Status |
|:-----|---------:|:------:|
| **Apples** | 3 | *Ready* |
| Oranges | 5 | Pending |

### Alerts

> [!IMPORTANT]
> After updating the extension, open sessions need \`/reload\`.

> [!WARNING]
> Terminals that copy on select (Warp) can turn a click on a copy button into a selection.
> Selecting a typeset formula copies blank cells. Its copy button copies the LaTeX.

### Task lists

- [x] Parse the reply
- [x] Draw it
  - [x] Tables and code
  - [ ] Diagrams and charts
- [ ] Ship the next release

### Your prompts

Scroll up: what you typed draws in a bubble. \`promptStyle\` switches to \`wide\`, \`bar\`, \`chevron\` or \`off\` in \`~/.pi/agent/prism.json\`. Set \`clock\` to \`24h\` or \`12h\` and each prompt shows when you sent it, and each turn's last line when it finished.

### Quotes and rules

> A quote keeps its text when you copy it, without the \`> \` markers.
>
> It keeps its paragraphs and lists too:
> - **bold** and \`inline code\` stay styled
> - each item gets its own row
>
> > A nested quote draws inside the bar.

<summary>
A line that holds only a tag draws dim, so wrapper tags show the reply's structure.
</summary>

---

### Code

\`\`\`json
{ "headingStyle": "banner", "tableStyle": "box", "mermaid": true }
\`\`\`

Blocks of 10 lines or more get line numbers. Past 30 lines they fold to the first 20 and a \`+M more lines\` button, \`show less\` folds them back; \`⧉ copy\` still copies the whole block.

\`\`\`ts
type Item = { name: string; price: number; qty: number }

const basket: Item[] = [
  { name: 'apples', price: 1.2, qty: 3 },
  { name: 'oranges', price: 0.8, qty: 5 },
  { name: 'pears', price: 1.5, qty: 2 },
  { name: 'plums', price: 2.1, qty: 4 },
  { name: 'grapes', price: 3.4, qty: 1 },
  { name: 'lemons', price: 0.6, qty: 6 },
  { name: 'melons', price: 4.0, qty: 1 },
  { name: 'cherries', price: 5.5, qty: 2 },
  { name: 'figs', price: 2.8, qty: 3 },
  { name: 'limes', price: 0.5, qty: 8 },
  { name: 'peaches', price: 1.9, qty: 4 },
  { name: 'kiwis', price: 0.9, qty: 6 },
]

const total = (items: Item[]): number =>
  items.reduce((sum, item) => sum + item.price * item.qty, 0)

const cheapest = (items: Item[]): Item | undefined =>
  [...items].sort((a, b) => a.price - b.price)[0]

const byName = (items: Item[]): Item[] =>
  [...items].sort((a, b) => a.name.localeCompare(b.name))

const receipt = (items: Item[]): string[] =>
  byName(items).map(item => \`\${item.name.padEnd(10)} \${item.qty} x \${item.price.toFixed(2)}\`)

console.log(receipt(basket).join('\\n'))
console.log('total', total(basket).toFixed(2))
console.log('cheapest', cheapest(basket)?.name)
\`\`\`

#### Math

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

#### Images

In kitty and Ghostty a PNG on a line of its own draws as a picture: a local path, \`~/\`, \`file://\` or a \`data:\` URL. Web images stay links, prism downloads nothing. Other terminals show the alt text in link color.

![prism band](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAAAoCAIAAAAAIrR+AAACdElEQVR42u3TewcQBgAA8ZNkkkySJEmSJJOWrW3t/cyWJJlMkmQmSZIkSSaTJEmSJEmStLS0trX3smVLkiRJkiTJZCZJdrNvsP0xNu73Fc4hOBAfwyH4OA7HkTgax+J4nIiTcQpOw+k4A1/EV/FNfBtn41x8F9/DhbgY38eluBxX4mpci+vxQ/wIN+NW3I47cTfuxf14EA/jUTyOJ/EUfo3f44/4M57DC3gJr+A1vIG38A7+ir/hfXyIf/BIHsjvck/uym25KdflqlyWi3JezsoZOS3fyVfyuZyQY3JEDskB2Sd7ZJfskG2yRTbJRtkg62SNrJIVskw+kCWySBbIfJknc2SWzJQ35BV5QZ6Vp2SqPCGTZIKMkzEySkbIMBkqg2WQDPgrwAAchINxKA7DETgKx+A4nICT8Amcik/hM/g8voyv40ychXNwHs7HBbgIl+AHuAxX4Cpcg+twA27ETbgFt+EO3IV7cB8ewEN4BI/hCfwMv8Rv8TSewbN4Hi/iZbyK1/Em3sa7eA9/xwf4iD/kodyX3+RXuSO35IZckytySS7IOflFfpIf5Bs5JSfluByVw3JQ9ste2S07Zbtslc3ykXwo62WtrJaVslyWyvuyWBbKe/KuzJXZ8o68Ja/JSzJDpss0mSKTZaKMl7EyWkbKcHlchshjMvDvHvAkPo3P/TsHfIyf4Kf4xT88YABJ/rcaOGngJA2cpIGTBk7SwEkaOEkDJw2cpIGTNHDSwEkaOEkDJ2ngpIGTNHCSBk7SwEkDJ2ngJA2cNHCSBk7SwEkaOGngJA2cpIGTNHDSwEkaOEkDJw2cpIGTNHCSBk4aOMl/yZ8SRd1gPq93WQAAAABJRU5ErkJggg==)

#### Footnotes

Latency fell to 120ms[^lat] after the cache change[^cache].

Click a mark to see its note. Point at a note to light the marks that cite it.

[^count]: Counted at close.
[^lat]: Median of 50 runs.
[^cache]: Entries expire after 10m.

#### Diagrams

\`\`\`mermaid
flowchart LR
    R["<i>Reply</i>"] --> P["<b>Parse</b>"]
    P --> D["<u>Draw</u>"]
    D --> S["<s>Screen</s>"]
\`\`\`

\`\`\`mermaid
sequenceDiagram
    participant U as You
    participant A as Pi
    participant P as prism
    U->>A: prompt
    A->>P: markdown
    P-->>U: colored reply
\`\`\`

\`\`\`mermaid
xychart-beta
    title "Color options per group"
    x-axis [text, head, num, code, diag]
    y-axis "options" 0 --> 8
    bar [7, 3, 2, 6, 2]
\`\`\`

Name each series and the legend says which line is which:

\`\`\`mermaid
xychart-beta
    title "Replies per hour"
    x-axis [09, 10, 11, 12, 13]
    y-axis 0 --> 40
    line "east" [30, 34, 22, 26, 31]
    line "west" [12, 18, 25, 20, 14]
\`\`\`

A pie draws round with a legend. Set \`pieStyle\` to \`bars\` in \`~/.pi/agent/prism.json\` for one bar per slice:

\`\`\`mermaid
pie showData title Time per reply stage
    "Parse" : 3
    "Draw" : 9
    "Paint" : 5
\`\`\`

\`\`\`mermaid
gantt
    title Release week
    dateFormat YYYY-MM-DD
    section Build
    Parser   :p, 2026-10-05, 2d
    Renderer :r, after p, 3d
    section Ship
    Review   :after r, 2d
    Release  :milestone, 2026-10-12, 0d
\`\`\`

A diagram wider than the terminal stays source, with a dim line saying why:

\`\`\`mermaid
flowchart TD
    Q[Queue] --> W1[Worker 1] & W2[Worker 2] & W3[Worker 3] & W4[Worker 4] & W5[Worker 5] & W6[Worker 6] & W7[Worker 7] & W8[Worker 8] & W9[Worker 9] & W10[Worker 10] & W11[Worker 11] & W12[Worker 12] & W13[Worker 13] & W14[Worker 14] & W15[Worker 15] & W16[Worker 16]
\`\`\`

A figure draws as written, its markup colored by role:

\`\`\`figure
{dim:timeout at 10 s, handler books at 12 s, retry books again}
          {note:0 s}           {note:10 s}  {note:12 s}              {note:later}
          {accent:▏─────────────▏─────▏─────────────────▏}
Provider  {accent:██████████████}{warn:✗} timeout               {accent:█} retry
Handler   {ok:████████████████████} 200, nobody waits
Bookings  0                   {ok:1}                 {warn:2 twice}
\`\`\`

A box whose rows slip off its frame is lined up with its corner:

\`\`\`figure
{accent:┌─ queue ──────────┐}
{accent:│} {ok:● worker 1} {accent:│}
{accent:│} {warn:▲ worker 2 slow}      {accent:│}
{accent:└──────────────────┘}
\`\`\`
`;

export const helpText = (): string => `
## Commands

| Command | Does |
|---------|------|
| \`/prism setup\` | Pick how tables, tasks, headings, copy buttons, prompts, times and pie charts look, from drawn samples |
| \`/prism demo\` | Full showcase, every element and diagram, plus a section in your language (Korean so far, or \`demo ko\`) |
| \`/prism demo-rtl\` | Hebrew right-to-left showcase |

Colors follow Pi's active theme (\`/settings\` → \`Theme\`).

> [!TIP]
> Any color slot can be overridden in \`~/.pi/agent/prism.json\`, such as \`headingColor\` or \`numberColor\`.

### Task lists

- [x] Tables, diagrams and charts drawn in the terminal
- [x] Copy tables as Markdown, art or HTML (macOS/Linux)
- [ ] Pick a \`taskStyle\` in \`~/.pi/agent/prism.json\`: checks, ticks, box or progress

\`\`\`mermaid
flowchart LR
    R[Reply] --> P[Parse]
    P --> D[Draw]
    D --> S[Screen]
\`\`\`

\`\`\`mermaid
xychart-beta
    title "Color options per group"
    x-axis [text, head, num, code, diag]
    y-axis "options" 0 --> 8
    bar [7, 3, 2, 6, 2]
\`\`\`
`;

export const rtlShowcaseText = (): string => `
# עברית מימין לשמאל

**שלום חברים**, זו הדגמה של עברית עם מונחים באנגלית כמו \`kubectl\`, מספרים כמו 99.9% ו-250ms, נתיב כמו ~/src/app.ts וגם [קישור](https://github.com/amikai/pi-stuff).

## רשימות

- פרוסים בשני אזורים (us-east ו-eu-west)
- Python מתאים גם לסקריפטים קצרים
- הצבעים עוקבים אחרי ערכת הנושא של Pi

1. מתקינים את התוסף
2. שואלים שאלה בעברית

> עברית נקראת מימין לשמאל, גם בטרמינל בלי תמיכה בכיווניות

> [!TIP]
> כל ערכת נושא עובדת גם בעברית

| שירות | אזור | גרסה |
| :--- | :--- | ---: |
| שער | us-east | 2.14.0 |
| חיוב | eu-west | 1.8.3 |

\`\`\`bash
ls -la # רשימת הקבצים בתיקייה
\`\`\`

\`\`\`text
טיוטה להודעה: הגרסה עלתה ב-14:20
\`\`\`

\`\`\`mermaid
flowchart LR
  A[בקשה חדשה] --> B{האם יש cache?}
  B -->|כן| C[מחזירים מה-cache]
  B -->|לא| D[פונים לשרת]
\`\`\`
`;

const KOREAN_SHOWCASE = `
## 한국어

**안녕하세요**, prism는 한국어 답변도 그대로 보여 줍니다. \`kubectl\` 같은 영문 명령어, 숫자 99.9%와 250ms, 경로 ~/src/app.ts도 함께 표시됩니다.

- 서울 리전과 도쿄 리전에 배포
- 색상은 Pi의 현재 테마를 따릅니다

| 서비스 | 리전 | 버전 |
| :--- | :--- | ---: |
| 게이트웨이 | ap-northeast-2 | 2.14.0 |
| 결제 | ap-northeast-1 | 1.8.3 |

\`\`\`figure
{accent:┌─ 빌드 ─────────────┐}
{accent:│} 이미지 생성 완료   {accent:│}
{accent:│} {ok:✓ 테스트 통과}      {accent:│}
{accent:│} {warn:▲ 배포 대기}        {accent:│}
{accent:└────────────────────┘}
\`\`\`

\`\`\`mermaid
flowchart LR
  A[새 요청] --> B{캐시 있음?}
  B -->|예| C[캐시에서 반환]
  B -->|아니오| D[서버 호출]
\`\`\`
`;

export const languageShowcase = (lang: string): string => (/^ko/i.test(lang) ? KOREAN_SHOWCASE : "");

export type SetupStep = {
	name: string;
	key: "tableStyle" | "taskStyle" | "headingStyle" | "copyButtonStyle" | "promptStyle" | "clock" | "pieStyle";
	title: string;
	note: string;
	options: readonly string[];
	sample: string;
};

export const SETUP_STEPS: readonly SetupStep[] = [
	{
		name: "tables",
		key: "tableStyle",
		title: "Tables",
		note: "How markdown tables draw.",
		options: ["box", "rules", "grid", "minimal"],
		sample: "| Item | Qty |\n|:-----|----:|\n| Apples | 3 |\n| Pears | 5 |",
	},
	{
		name: "tasks",
		key: "taskStyle",
		title: "Tasks",
		note: "How `- [ ]` and `- [x]` items draw.",
		options: ["checks", "ticks", "box", "progress"],
		sample: "- [x] Parse the reply\n- [x] Draw it\n- [ ] Ship it",
	},
	{
		name: "headings",
		key: "headingStyle",
		title: "Headings",
		note: "How `#` and `##` headings draw. Terminals have one font size, so headings stand out through style and color.",
		options: ["banner", "bold", "underline", "uppercase"],
		sample: "# Release notes\n\n## Fixes\n\nTables keep their width.",
	},
	{
		name: "copy",
		key: "copyButtonStyle",
		title: "Copy buttons",
		note: "Where the copy buttons on tables, code, diagrams and replies sit. `inline` shows them beside or above each block. `hover` puts a dim ⧉ beside each block instead and shows its buttons only while the pointer is on that ⧉, so they take no line. Needs `copyButtons` on.",
		options: ["inline", "hover"],
		sample: "",
	},
	{
		name: "prompts",
		key: "promptStyle",
		title: "Your prompts",
		note: "How what you type draws in the transcript. `off` keeps Pi's own look.",
		options: ["bubble", "wide", "bar", "chevron", "off"],
		sample: "",
	},
	{
		name: "times",
		key: "clock",
		title: "Times",
		note: "Whether your prompts show when you sent them and the line that closes each turn when it finished. A time from another day gets its date.",
		options: ["off", "24h", "12h"],
		sample: "",
	},
	{
		name: "pies",
		key: "pieStyle",
		title: "Pie charts",
		note: "How mermaid `pie` charts draw. `round` falls back to bars in ascii mode, with more slices than the theme has distinct colors or in a narrow terminal.",
		options: ["round", "bars"],
		sample: '```mermaid\npie title Time per reply stage\n    "Draw" : 9\n    "Paint" : 5\n    "Parse" : 3\n```',
	},
];

export type SetupParts = { head: string; options: { value: string; text: string }[]; tail: string };

export const setupParts = (at: number): SetupParts => {
	const step = SETUP_STEPS[at]!;
	const next = SETUP_STEPS[at + 1];
	return {
		head: `## Setup ${at + 1}/${SETUP_STEPS.length}: ${step.title}\n\n${step.note}`,
		options: step.options.map((value, i) => ({
			value,
			text: `### ${i + 1}. ${value}${step.sample ? `\n\n${step.sample}` : ""}`,
		})),
		tail: `Pick with \`/prism setup ${step.name} <number or name>\`.${next ? ` Skip with \`/prism setup ${next.name}\`.` : ""} Stop any time, \`/prism setup\` starts over.`,
	};
};

export const setupText = (parts: SetupParts): string =>
	[parts.head, ...parts.options.map((o) => o.text), parts.tail].join("\n\n");

export const SETUP_PANE_OPENED =
	"Setup opened in a pane: ↑↓ or Tab moves through the styles with a preview, Enter saves it and shows the next step, Esc closes the pane. `/prism setup tables` walks the steps here instead.";

export const SETUP_PANE_KEYS = "↑↓ or Tab moves, Enter saves and shows the next step, Esc closes.";

export const SETUP_DONE =
	"Setup done. Run `/prism setup` again any time, and `~/.pi/agent/prism.json` has every other option.";

export const findSetup = (text: string): { at: number; before: string; parts: SetupParts } | undefined => {
	for (let at = 0; at < SETUP_STEPS.length; at++) {
		const parts = setupParts(at);
		const whole = setupText(parts);
		if (text.endsWith(whole)) return { at, before: text.slice(0, -whole.length).trim(), parts };
	}
	return undefined;
};
