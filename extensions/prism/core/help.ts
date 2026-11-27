export const HINT = [
  "Replies in this session are drawn by prism inside Pi (not a command or tool to call: when asked to show something with prism, write it as markdown in the reply).",
  "Markdown tables, GitHub alerts (> [!WARNING], > [!NOTE]), fenced code with a language tag, and ```mermaid or ```plantuml blocks render as colored terminal graphics:",
  'flowcharts, sequence diagrams, xychart-beta bar or line charts (name each series for the legend: line "east" [..]), pie charts, gantt schedules, quadrantChart grids, mindmap trees, journey mood lines, kanban boards and gitGraph histories.',
  "When a reply carries a numeric series or a flow that is easier to see than read, add a small diagram or chart with short labels, not a second picture of what a figure already shows.",
  "Skip diagrams and pictures for short or simple answers.",
  "Put any command or snippet the user may run or copy in a fenced block with a language tag, never inline code: fenced blocks get a copy button, inline code does not.",
].join(" ");

export const showcaseText = (): string => `
# prism

Colored markdown for Pi replies: **bold**, *italic*, ~~struck~~, \`inline code\`, a [link](https://buildwithpi.ai) and a bare URL https://github.com/amikai/pi-stuff, both clickable, numbers like 99.9% and 250ms, paths like ~/src/app.ts.

Paths like ~/src/app.ts, ./README.md and /tmp/app.ts open on click in a terminal that draws hyperlinks, and so does a local link that shows its own path, like [/tmp/notes.md](file:///tmp/notes.md), while slash commands like /prism stay text. A local link with any other name, like [notes](file:///tmp/notes.md), draws as its name and target, so it cannot hide where a click goes.

Paths written without ./, like docs/guide/ or src/app.ts:42, and Windows paths like C:\\work\\plan.md link too, once a check finds them on disk; prose like and/or stays text.

Plain text logs keep their paths clickable:

\`\`\`text
Log written to /tmp/prism.log
\`\`\`

Programs and launchers stay plain text, so a click never runs one: ./install.sh, ~/Desktop/setup.command and /Applications/Calculator.app keep the path color without a link.

Obsidian links that open a note open on click, like [a note](obsidian://open?vault=notes&file=todo), while one that writes, like [a new note](obsidian://new?vault=notes&name=x&content=y), and other app links like [diagnostics](ms-msdt:/id) stay text.

Code-shaped prose stays as written: f(*args, **kwargs), a link with parentheses [Foo_(bar)](https://en.wikipedia.org/wiki/Foo_(bar)), a file link [\`index.ts\`](https://github.com/amikai/pi-stuff/blob/main/extensions/prism/index.ts) and **bold with *italic* inside**.

## Commands

| Command | Does |
|---------|------|
| \`/prism\` | Help screen |
| \`/prism setup\` | Pick how tables, tasks, headings, copy buttons, prompts and pie charts look, from drawn samples; \`/prism setup more\` goes on to table layouts and the 11 table styles |
| \`/prism checkhealth\` | This screen |
| \`/prism checkhealth-rtl\` | Hebrew right-to-left showcase |

Colors follow Pi's active theme (\`/settings\` → \`Theme\`).

> [!TIP]
> Any color slot can be overridden in \`~/.pi/agent/prism.json\`, such as \`headingColor\` or \`numberColor\`.

## Everything it draws

### Copy tables

Use \`⧉ md\` for Markdown, \`⧉ art\` for chat, or \`⧉ html\` for a formatted table. \`⧉ html\` shows in a local macOS, Linux or Windows terminal and writes HTML and tab-separated plain text together; Linux needs CopyQ running. Pasted into Slack it makes a native table; Slack keeps cell text but drops bold, links and alignment. If that fails, it copies the plain text alone. \`▣ png\` puts a picture of the drawn table, diagram or chart on the clipboard in the theme's colors, ready to paste into Slack, docs or slides; it shows in a local macOS or Windows terminal. Set \`copyButtonStyle\` to \`hover\` in \`~/.pi/agent/prism.json\` and each block shows a dim ⧉ instead: point at it for its buttons.

| Item | Quantity[^count] | Status |
|:-----|---------:|:------:|
| **Apples** | 3 | *Ready* |
| Oranges | 5 | Pending |

### Very wide tables

Long paths and checksums never split mid-word, so a column cannot shrink below them. When those minimum widths no longer fit the reply, \`tableLayout\` \`auto\` and \`stacked\` draw the table as one card per row, and \`compact\` keeps the columns at their longest word:

| Scroll | Checksum |
|:-------|:---------|
| ~/jade-palace/noodle-scrolls/scrolls/scroll-07-training-notes.md | 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 |
| /srv/dojo/moves.md | 2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae |

### Status matrix

When a table has a status column — the one whose cells are things like ✓, passed, failed or pending — its cells draw in theme colors: green for a pass, red for a failure, amber for a warning, gray for a wait. \`statusMatrix\` \`summary\` adds a count line under the table and \`group\` reorders rows by status with a heavy rule where the status changes:

| Suite | Cases | Result |
|:------|------:|:-------|
| Unit | 412 | ✓ |
| Propagation | 88 | failed |
| Smoke | 24 | pending |
| Regression | 130 | ✓ |

### Test report

When a table draws a run — a status column of things like ✓ or failed next to durations like 120 ms — \`testMatrix\` \`report\` adds a line under the table with how much of the run passed, a count of every other kind of result and the time all of it took. The line reuses the status colors and replaces the \`statusMatrix\` count line when both draw. The default \`off\` keeps tables as written:

| Check | Time | Result |
|:------|-----:|:-------|
| parse | 120 ms | ✓ |
| draw | 4 s | ✓ |
| scan | 130 ms | failed |
| typeset | 2.6 s | pending |

### Benchmarks

When a table compares benchmarks — a column of changes like -10% or +3% beside two columns of runs — \`benchTable\` draws each change in theme colors, green for an improvement and red for a regression; timings read as lower is better unless a header speaks of req/s, throughput or a score. \`trend\` also draws a sparkline of the runs under the table, each step colored by whether it improved. The default \`off\` keeps tables as written:

| Benchmark | Before | After | Change |
|:----------|-------:|------:|:-------|
| parse | 12.4 ms | 11.1 ms | -10% |
| layout | 19.6 ms | 22.4 ms | +14% |
| paint | 2.1 ms | 0.8 ms | -62% |

### Schema

When a table describes a database schema — a column of fields beside a column of types — \`schemaTable\` draws the type cells by their family: text types like varchar in the string color, numeric types like int in the number color, booleans in the emphasis color, time types like timestamp in the link color. \`keys\` draws the constraint cells — PK in the accent color, FK in the link color, unique and index cells in gray — and \`full\` does both. The default \`off\` keeps tables as written:

| Column | Type | Key | Default |
|:-------|:-----|:----|:--------|
| id | uuid | PK | |
| email | varchar(255) | UNIQUE | |
| org_id | bigint | FK → orgs.id | |
| created_at | timestamp | | now() |

### Comparison

When a table compares options — a column of scores beside a column of ranks — \`compareTable\` draws the rank cells as a medal: 1 in the accent color, 2 and 3 in the link color, the same pairing the schema table's PK and FK use. \`pick\` draws the score cell of the top score in the improvement green, the hue \`benchTable\` gives an improvement, and bolds it so it stands out even in a theme where that green is also the number color, and \`full\` does both. The default \`off\` keeps tables as written:

| Option | Score | Rank |
|:-------|------:|-----:|
| mantis | 9.2 | 1 |
| origami | 7.8 | 2 |
| noodle | 6.1 | 3 |
| tofu | 4.4 | 4 |

### API

When a table documents an API — a method column whose cells read like HTTP verbs — \`apiTable\` draws the method cells by what the verb does: reads like GET in the link color, writes like POST in the string color, DELETE in the removed color, other verbs in gray. \`auth\` draws the scheme cells of an auth column — Bearer, OAuth, API key, JWT — in the accent color, and \`full\` does both. The default \`off\` keeps tables as written:

| Method | Endpoint | Auth | Description |
|:-------|:---------|:-----|:------------|
| GET | /v1/scrolls | Bearer | List the scrolls |
| POST | /v1/scrolls | Bearer | Add a scroll |
| DELETE | /v1/scrolls/:id | API key | Remove a scroll |
| GET | /v1/health | none | Liveness check |

### Key-value

When a table lists configuration — a column of options beside columns of values, sources and defaults — \`kvTable\` draws the source cells by where it says the value comes from: env in the link color, config in the string color, default in gray. \`overrides\` draws the value cell in the accent color when the row's value differs from its default, and \`full\` does both. The default \`off\` keeps tables as written:

| Option | Value | Source | Default |
|:-------|:------|:-------|:--------|
| retries | 5 | env | 3 |
| format | json | config | json |
| timeout | 30s | default | 30s |
| token | abc123 | env | unset |

### Groups

When a table groups its rows — the first column whose cells repeat in runs, like a column of services or teams — \`groupTable\` draws each group once: \`merge\` labels the group in the accent color and blanks the repeats under it, \`count\` also adds the group's size to its label, and \`full\` also draws a heavy rule where one group ends and the next begins. A column of numbers never groups, and a table already grouped by status keeps its status grouping. The default \`off\` keeps tables as written:

| Service | Region | Requests | p99 |
|:--------|:-------|---------:|----:|
| api | us-east | 1.2M | 84 ms |
| api | us-west | 900k | 91 ms |
| worker | us-east | 2.4M | 120 ms |
| worker | us-west | 1.8M | 132 ms |
| cron | us-east | 96k | 40 ms |

### Heatmap

When a table holds a matrix of numbers — a column of requests beside a column of latencies, each number carrying the same suffix down its column — \`heatTable\` draws each number by where it sits between its column's lowest and highest: \`color\` puts the lowest in the table's text color, the next in the number color, the next in the accent color and the highest in the accent color and bold, and \`bars\` also adds one block glyph after each number, \`▁\`, \`▄\`, \`▆\` or \`█\` by the same four steps, so size reads without color. A column whose values are all equal stays as written, and a cell another table look already colored keeps that color. The default \`off\` keeps tables as written:

| Region | Requests | p99 |
|:-------|---------:|----:|
| us-east | 1200 | 84 ms |
| us-west | 900 | 91 ms |
| eu-west | 640 | 120 ms |
| ap-south | 480 | 132 ms |
| sa-east | 96 | 140 ms |

### Tree

When a table nests its rows — a column of areas beside a column of services and their tasks — \`treeTable\` draws each run of a repeated first column once, in the accent color, and the rows under it as branches: \`branch\` prefixes each row with \`├─\` or \`└─\`, the last row of the run taking the corner, and when the next column repeats too it merges the same way and carries one \`│\` per continuing parent before its branch, so three levels draw as a tree. \`full\` also draws a heavy rule where one top-level group ends and the next begins. A column of numbers never nests, a table already grouped by status keeps its status grouping, and stacked tables stay as they are. The default \`off\` keeps tables as written:

| Area | Service | Task |
|:-----|:--------|:-----|
| core | api | boot |
| core | api | sync |
| core | worker | draw |
| web | ui | paint |
| web | ui | route |

### Pivot

When a table holds metrics and periods — a column of names beside a header of quarters — \`pivotTable\` \`transpose\` draws it with rows and columns swapped, so the quarters read down the side and each metric has a column of its own, which fits a narrow terminal better than a long row. It adds no totals and no averages, so what you copy as markdown stays exactly what was written. The default \`off\` keeps tables as written:

| Metric | Q1 | Q2 | Q3 | Q4 |
|:-------|----:|----:|----:|----:|
| Revenue | 120 | 148 | 162 | 190 |
| Cost | 80 | 96 | 101 | 118 |
| Margin | 40 | 52 | 61 | 72 |

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

Scroll up: what you typed draws in a bubble. \`promptStyle\` switches to \`wide\`, \`bar\`, \`chevron\` or \`off\` in \`~/.pi/agent/prism.json\`.

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

A pie draws round with a legend, as a smooth picture in terminals that show images. Set \`pieStyle\` to \`bars\` in \`~/.pi/agent/prism.json\` for one bar per slice:

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

A quadrant chart numbers its points and lists them under the grid:

\`\`\`mermaid
quadrantChart
    title Feature priorities
    x-axis Low effort --> High effort
    y-axis Low impact --> High impact
    quadrant-1 Big bets
    quadrant-2 Do now
    quadrant-3 Fill-ins
    quadrant-4 Skip
    Reorder: [0.2, 0.85]
    Search: [0.8, 0.9]
    Dark mode: [0.3, 0.25]
    Localisation: [0.75, 0.4]
\`\`\`

A mind map grows from its root to the right, one color per branch:

\`\`\`mermaid
mindmap
    root((Release))
        Code
            Tests
            Review
        Docs
            Changelog
        Ship
            Tag
            Announce
\`\`\`

A user journey draws its mood line across the tasks, green when it goes well and red when it hurts:

\`\`\`mermaid
journey
    title First order
    section Find
        Search: 4: Shopper
        Compare: 3: Shopper
    section Buy
        Checkout: 1: Shopper
        Delivery: 5: Shopper, Courier
\`\`\`

A kanban board puts its columns side by side, each card with its owner, ticket and priority:

\`\`\`mermaid
kanban
    todo[To do]
        a[Fix login timeout]@{ assigned: 'Amy', priority: 'High' }
        b[Write release notes]@{ ticket: DOC-7 }
    doing[In progress]
        c[Dark mode]@{ assigned: 'Ken' }
    done[Done]
        d[Search filters]
\`\`\`

A git graph runs top to bottom, one colored lane per branch:

\`\`\`mermaid
gitGraph
    commit id: "init" tag: "v1.0"
    branch develop
    commit id: "login"
    commit id: "fix" type: HIGHLIGHT
    checkout main
    merge develop id: "release" tag: "v1.1"
\`\`\`

A diagram wider than the terminal stays source, with a dim line saying why. Where the terminal shows images, pele draws it as a picture instead, after a moment (\`pele: false\` in \`~/.pi/agent/prism.json\` leaves it as source):

\`\`\`mermaid
flowchart TD
    Q[Queue] --> W1[Worker 1] & W2[Worker 2] & W3[Worker 3] & W4[Worker 4] & W5[Worker 5] & W6[Worker 6] & W7[Worker 7] & W8[Worker 8] & W9[Worker 9] & W10[Worker 10] & W11[Worker 11] & W12[Worker 12] & W13[Worker 13] & W14[Worker 14] & W15[Worker 15] & W16[Worker 16]
\`\`\`

The remaining 9 Mermaid kinds below draw as pictures with pele where the terminal shows images, and otherwise stay source with a note.

\`timeline\`

\`\`\`mermaid
timeline
    title Release history
    2024 : Alpha : Prototype
    2025 : Beta
    2026 : Stable
\`\`\`

\`sankey-beta\`

\`\`\`mermaid
sankey-beta

Replies,Text,60
Replies,Diagrams,25
Replies,Tables,15
\`\`\`

\`C4Context\`

\`\`\`mermaid
C4Context
    title Reply rendering
    Person(user, "User", "Reads replies")
    System(pi, "Pi", "Terminal agent")
    System_Ext(pele, "pele", "Draws diagrams")
    Rel(user, pi, "Prompts")
    Rel(pi, pele, "Sends source")
\`\`\`

\`architecture-beta\`

\`\`\`mermaid
architecture-beta
    group edge(cloud)[Edge]
    service web(internet)[Web] in edge
    service api(server)[API] in edge
    service db(database)[Store]
    web:R --> L:api
    api:B --> T:db
\`\`\`

\`block-beta\`

\`\`\`mermaid
block-beta
    columns 3
    Input Parse Render
    space:3
    Cache:3
\`\`\`

\`packet-beta\`

\`\`\`mermaid
packet-beta
    0-15: "Source port"
    16-31: "Destination port"
    32-63: "Sequence number"
\`\`\`

\`radar-beta\`

\`\`\`mermaid
radar-beta
    axis Speed, Color, Accuracy, Reach
    curve Now{4, 3, 5, 2}
    max 5
\`\`\`

\`treemap-beta\`

\`\`\`mermaid
treemap-beta
"Replies"
  "Text"
    "Prose": 40
    "Code": 20
  "Visuals"
    "Diagrams": 25
    "Tables": 15
\`\`\`

\`requirementDiagram\`

\`\`\`mermaid
requirementDiagram
    requirement fits {
        id: 1
        text: a diagram keeps its shape
        risk: low
        verifymethod: demonstration
    }
    element demo {
        type: page
    }
    demo - satisfies -> fits
\`\`\`

PlantUML draws from a fenced \`plantuml\` block as an image in kitty and Ghostty, and stays a note elsewhere. \`plantuml: false\` in \`~/.pi/agent/prism.json\` leaves it as source.

\`\`\`plantuml
@startuml
You -> prism : markdown
prism --> You : drawn reply
@enduml
\`\`\`

A picture is as wide as the terminal allows, and its height follows its width. This diagram is wider than most terminals, so a terminal that speaks the kitty protocol, such as kitty, Ghostty or Rex, draws it across the full width. iTerm2 fits it into 20 rows.

\`\`\`plantuml
@startuml
participant You
participant Rex
participant pi
participant Model
participant prism
participant "pele worker" as pele
participant resvg
participant "PlantUML worker" as PlantUML
participant "macOS clipboard" as Clipboard
participant "Quick Look" as QuickLook
You -> Rex : type a prompt
Rex -> pi : keys
pi -> Model : the conversation so far
Model --> pi : reply as Markdown
pi -> prism : assistant message
prism -> prism : parse the Markdown
prism -> pele : mermaid source
prism -> PlantUML : plantuml source
prism --> pi : text, tables and code
pi --> Rex : first frame, diagrams still source
pele -> resvg : SVG with the bundled fonts
resvg --> pele : pixels at the width asked
pele --> prism : PNG
PlantUML --> prism : PNG
prism -> prism : fit each picture to the width
prism --> pi : pictures
pi --> Rex : kitty graphics
Rex --> You : drawn reply
You -> Rex : click image
Rex -> pi : mouse event
pi -> prism : press
prism -> Clipboard : PNG for Slack or a document
You -> Rex : click preview
prism -> QuickLook : PNG file
QuickLook --> You : panel with zoom buttons
@enduml
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
| \`/prism setup\` | Pick how tables, tasks, headings, copy buttons, prompts and pie charts look, from drawn samples; \`/prism setup more\` goes on to table layouts and the 11 table styles |
| \`/prism checkhealth\` | Full showcase, every element and diagram, plus a section in your language (Korean so far, or \`checkhealth ko\`) |
| \`/prism checkhealth-rtl\` | Hebrew right-to-left showcase |

Colors follow Pi's active theme (\`/settings\` → \`Theme\`).

> [!TIP]
> Any color slot can be overridden in \`~/.pi/agent/prism.json\`, such as \`headingColor\` or \`numberColor\`. Set options directly too, such as \`/prism tableLayout auto\` or \`/prism statusMatrix group\`.

### Task lists

- [x] Tables, diagrams and charts drawn in the terminal (\`flowchart\`, \`sequenceDiagram\`, \`stateDiagram-v2\`, \`classDiagram\`, \`erDiagram\`, \`xychart-beta\`, \`pie\`, \`gantt\`, \`quadrantChart\`, \`mindmap\`, \`journey\`, \`kanban\`, \`gitGraph\`, plus 9 \`pele\` kinds and PlantUML)
- [x] Copy tables as Markdown, art or HTML (macOS/Linux), and tables, diagrams and charts as a PNG image (macOS/Windows)
- [ ] Pick a \`taskStyle\` in \`~/.pi/agent/prism.json\`: checks, ticks, box or progress
- [ ] Try \`/prism setup more\` for \`tableLayout\` (\`classic\`, \`auto\`, \`compact\`, \`stacked\`) and the 11 table modes (\`statusMatrix\`, \`testMatrix\`, \`benchTable\`, \`schemaTable\`, \`compareTable\`, \`apiTable\`, \`kvTable\`, \`groupTable\`, \`heatTable\`, \`treeTable\`, \`pivotTable\`)

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
  key:
    | "tableStyle"
    | "tableLayout"
    | "statusMatrix"
    | "testMatrix"
    | "benchTable"
    | "schemaTable"
    | "compareTable"
    | "apiTable"
    | "kvTable"
    | "groupTable"
    | "heatTable"
    | "treeTable"
    | "pivotTable"
    | "taskStyle"
    | "headingStyle"
    | "copyButtonStyle"
    | "promptStyle"
    | "pieStyle";
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
    name: "pies",
    key: "pieStyle",
    title: "Pie charts",
    note: "How mermaid `pie` charts draw. `round` draws a smooth picture in terminals that show images and text elsewhere, and falls back to bars in ascii mode, with more slices than the theme has distinct colors or in a narrow terminal.",
    options: ["round", "bars"],
    sample: '```mermaid\npie title Time per reply stage\n    "Draw" : 9\n    "Paint" : 5\n    "Parse" : 3\n```',
  },
  {
    name: "table-layout",
    key: "tableLayout",
    title: "Table layout",
    note: "How markdown tables fit the width. `classic` keeps today's look: columns share the width and shrink to the terminal. `auto` stretches like `classic` and stacks each row as label and value pairs when not even its longest words fit. `compact` sits every column at its longest word, so long cells wrap and the table stays narrow. `stacked` always draws label and value pairs. The sample's columns cannot shrink below their longest words, so `classic` wraps the cells and `auto` and `stacked` draw cards.",
    options: ["classic", "auto", "compact", "stacked"],
    sample:
      "| Scroll | Checksum |\n|:-------|:---------|\n| ~/jade-palace/noodle-scrolls/scrolls/scroll-07-training-notes.md | 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 |\n| /srv/dojo/moves.md | 2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae |",
  },
  {
    name: "status-matrix",
    key: "statusMatrix",
    title: "Status matrix",
    note: "How the status cells of a table draw: the column whose cells are things like ✓, passed, failed or pending. `off` keeps tables as written. `color` draws them in theme colors, `summary` adds a count line under the table, and `group` also reorders rows by status and draws a heavy rule where the status changes.",
    options: ["color", "summary", "group", "off"],
    sample:
      "| Suite | Cases | Result |\n|:------|------:|:-------|\n| Unit | 412 | ✓ |\n| Propagation | 88 | failed |\n| Smoke | 24 | pending |",
  },
  {
    name: "test-report",
    key: "testMatrix",
    title: "Test report",
    note: "What a table of test results reports: a status column of things like ✓ or failed next to durations like 120 ms. `off` keeps tables as written. `report` draws a line under the table with the share of the run that passed, a count of every other kind of result and the time all of it took.",
    options: ["report", "off"],
    sample:
      "| Check | Time | Result |\n|:------|-----:|:-------|\n| parse | 120 ms | ✓ |\n| draw | 4 s | ✓ |\n| scan | 130 ms | failed |\n| typeset | 2.6 s | pending |",
  },
  {
    name: "bench-table",
    key: "benchTable",
    title: "Benchmarks",
    note: "How a table that compares benchmarks draws: a column of changes like -10% or +3%. `off` keeps tables as written. `color` draws each change in theme colors, green for an improvement and red for a regression, and `trend` also draws a sparkline of the runs under the table.",
    options: ["trend", "color", "off"],
    sample:
      "| Benchmark | Before | After | Change |\n|:----------|-------:|------:|:-------|\n| parse | 12.4 ms | 11.1 ms | -10% |\n| layout | 19.6 ms | 22.4 ms | +14% |\n| paint | 2.1 ms | 0.8 ms | -62% |",
  },
  {
    name: "schema-table",
    key: "schemaTable",
    title: "Schema",
    note: "How a table that describes a database schema draws: a column of fields beside a column of types. `off` keeps tables as written. `types` draws each type cell in theme colors by its family: text types like varchar in the string color, numeric types like int in the number color, booleans in the emphasis color, time types like timestamp in the link color. `keys` draws the constraint cells: PK in the accent color, FK in the link color, unique and index cells in gray. `full` does both.",
    options: ["full", "types", "keys", "off"],
    sample:
      "| Column | Type | Key | Default |\n|:-------|:-----|:----|:--------|\n| id | uuid | PK | |\n| email | varchar(255) | UNIQUE | |\n| org_id | bigint | FK → orgs.id | |\n| created_at | timestamp | | now() |",
  },
  {
    name: "compare-table",
    key: "compareTable",
    title: "Comparison",
    note: "How a table that compares options draws: a column of scores beside a column of ranks. `off` keeps tables as written. `rank` draws the rank cells in theme colors: 1 in the accent color, 2 and 3 in the link color. `pick` draws the score cell of the top score in the improvement green and bold, so it stands out in a theme where that green is also the number color. `full` does both.",
    options: ["full", "rank", "pick", "off"],
    sample:
      "| Option | Score | Rank |\n|:-------|------:|-----:|\n| mantis | 9.2 | 1 |\n| origami | 7.8 | 2 |\n| noodle | 6.1 | 3 |\n| tofu | 4.4 | 4 |",
  },
  {
    name: "api-table",
    key: "apiTable",
    title: "API reference",
    note: "How an API reference table draws: a method column whose cells read like HTTP verbs. `off` keeps tables as written. `verbs` draws each method cell by what the verb does: reads like GET in the link color, writes like POST in the string color, DELETE in the removed color, other verbs in gray. `auth` draws the scheme cells of an auth column: Bearer, OAuth, API key and JWT in the accent color. `full` does both.",
    options: ["full", "verbs", "auth", "off"],
    sample:
      "| Method | Endpoint | Auth | Description |\n|:-------|:---------|:-----|:------------|\n| GET | /v1/scrolls | Bearer | List the scrolls |\n| POST | /v1/scrolls | Bearer | Add a scroll |\n| DELETE | /v1/scrolls/:id | API key | Remove a scroll |\n| GET | /v1/health | none | Liveness check |",
  },
  {
    name: "kv-table",
    key: "kvTable",
    title: "Key-value",
    note: "How a table that lists configuration draws: a column of options beside columns of values, sources or defaults. `off` keeps tables as written. `sources` draws each source cell in theme colors by where it says the value comes from: env in the link color, config in the string color, default in gray. `overrides` draws the value cell in the accent color when the row's value differs from its default. `full` does both.",
    options: ["full", "sources", "overrides", "off"],
    sample:
      "| Option | Value | Source | Default |\n|:-------|:------|:-------|:--------|\n| retries | 5 | env | 3 |\n| format | json | config | json |\n| timeout | 30s | default | 30s |\n| token | abc123 | env | unset |",
  },
  {
    name: "group-table",
    key: "groupTable",
    title: "Groups",
    note: "How a table that groups its rows draws: the first column whose cells repeat in runs, like a column of services or teams. `off` keeps tables as written. `merge` labels the group once in the accent color and blanks the repeats under it, `count` also adds the group size to the label, and `full` also draws a heavy rule where one group ends and the next begins.",
    options: ["full", "count", "merge", "off"],
    sample:
      "| Service | Region | Requests | p99 |\n|:--------|:-------|---------:|----:|\n| api | us-east | 1.2M | 84 ms |\n| api | us-west | 900k | 91 ms |\n| worker | us-east | 2.4M | 120 ms |\n| worker | us-west | 1.8M | 132 ms |\n| cron | us-east | 96k | 40 ms |",
  },
  {
    name: "heat-table",
    key: "heatTable",
    title: "Heatmap",
    note: "How a table of numbers draws. `off` keeps tables as written. `color` draws each number by where it sits between its column's lowest and highest: the lowest in the table's text color, then the number color, then the accent color, the highest in the accent color and bold. `bars` also adds one block glyph after each number, `▁`, `▄`, `▆` or `█` by the same four steps. A column whose values are all equal stays as written.",
    options: ["bars", "color", "off"],
    sample:
      "| Region | Requests | p99 |\n|:-------|---------:|----:|\n| us-east | 1200 | 84 ms |\n| us-west | 900 | 91 ms |\n| eu-west | 640 | 120 ms |\n| ap-south | 480 | 132 ms |\n| sa-east | 96 | 140 ms |",
  },
  {
    name: "tree-table",
    key: "treeTable",
    title: "Tree",
    note: "How a table that nests its rows draws: a column of areas beside a column of services and their tasks. `off` keeps tables as written. `branch` labels each run once in the accent color and prefixes the rows under it with `├─` or `└─`, the last row taking the corner; when the next column repeats too it merges the same way and carries one `│` per continuing parent, so three levels draw as a tree. `full` also draws a heavy rule where one top-level group ends and the next begins.",
    options: ["full", "branch", "off"],
    sample:
      "| Area | Service | Task |\n|:-----|:--------|:-----|\n| core | api | boot |\n| core | api | sync |\n| core | worker | draw |\n| web | ui | paint |\n| web | ui | route |",
  },
  {
    name: "pivot-table",
    key: "pivotTable",
    title: "Pivot",
    note: "How a table of metrics and periods draws. `off` keeps tables as written. `transpose` swaps its rows and columns: a first column of metric labels beside a header of period labels, with at least 60% numbers and fewer rows than periods, draws with the periods as rows and the metrics as columns. It adds no totals and no averages, so a table copied as markdown keeps exactly what was written.",
    options: ["transpose", "off"],
    sample:
      "| Metric | Q1 | Q2 | Q3 | Q4 |\n|:-------|----:|----:|----:|----:|\n| Revenue | 120 | 148 | 162 | 190 |\n| Cost | 80 | 96 | 101 | 118 |\n| Margin | 40 | 52 | 61 | 72 |",
  },
];

export const ESSENTIAL_STEPS = 6;

export const SETUP_MORE = "more";

export const SETUP_ESSENTIALS_DONE = `Essentials set. \`/prism setup more\` walks ${SETUP_STEPS.length - ESSENTIAL_STEPS} more styles, from table layouts to pivot tables, and \`~/.pi/agent/prism.json\` has every option.`;

export type SetupParts = { head: string; options: { value: string; text: string }[]; tail: string };

export const setupParts = (at: number): SetupParts => {
  const step = SETUP_STEPS[at]!;
  const next = at + 1 === ESSENTIAL_STEPS ? undefined : SETUP_STEPS[at + 1];
  const tier =
    at < ESSENTIAL_STEPS
      ? `Setup ${at + 1}/${ESSENTIAL_STEPS}`
      : `More styles ${at + 1 - ESSENTIAL_STEPS}/${SETUP_STEPS.length - ESSENTIAL_STEPS}`;
  return {
    head: `## ${tier}: ${step.title}\n\n${step.note}`,
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
