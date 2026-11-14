# Pi built-in render

`/pi-built-in-render` appends examples of Pi's stock output components to the transcript. It works independently of prism and does not request a model turn.

## Commands

`/pi-built-in-render` takes no arguments. It renders every section in registry order: Markdown headings and inline styles, lists, quotes, tables, code, LaTeX math, Mermaid diagrams, diffs, and an inline image.

Any argument produces a notification without appending an entry. Non-interactive modes also produce a notification without appending an entry.

## Rendering and persistence

The extension uses `Markdown`, `Text(renderDiff(...))`, and `Image` directly. It does not use assistant-message components, global Markdown transformers, or prism configuration.

Mermaid uses this package's `lovely-mermaid` dependency, pinned to `0.3.3`, the version that `@earendil-works/pi-coding-agent@1.5.2` pins. The compiled Pi release bundles `lovely-mermaid` inside its binary and has no `node_modules`, so the extension resolves the dependency from its own location first. If that copy is not installed, the extension falls back to the copy in Pi's package directory, which only the npm install of Pi has. The adapter follows Pi's nonstreaming top-level fence behavior and semantic theme colors. Unrecognized diagrams and diagrams wider than the available content width retain their source fences. Syntax warnings retain the source and add Pi's warning text when the diagram fits. Hyperlinks from `click` and `link` statements wrap the node's label text only.

OSC-8 hyperlinks depend on terminal support. Kitty and iTerm2 image protocols display the bundled PNG inline when available. Other terminals show Pi's text fallback. The extension does not change terminal capabilities.

Each command appends one versioned document containing the original examples. Resume uses that saved source rather than the current catalog. Invalid saved data produces a plain diagnostic without printing its contents. The decoder accepts at most 64 blocks, limits text fields to 1 MiB, and limits decoded PNG data to 256 KiB.

Theme invalidation rebuilds Markdown and diff components. Image components retain their protocol IDs across ordinary renders and invalidate their cached output. Each transcript entry owns its component instances.

New entries do not enter model context. The context handler also removes compatibility custom messages with the `pi-built-in-render` custom type. It preserves other messages in order.

## Mermaid support matrix

This matrix compares the official `mermaid@12.2.0` specification against the `lovely-mermaid@0.3.3` renderer bundled with `@earendil-works/pi-coding-agent@1.5.2`.

When `lovely-mermaid@0.3.3` parses a diagram without warnings and the rendered width fits `availableWidth`, `transformBuiltInMermaid` replaces the ` ```mermaid ` fence with per-line inline code spans. When `lovely-mermaid@0.3.3` records a parser warning and the partial diagram fits `availableWidth`, `transformBuiltInMermaid` retains the original ` ```mermaid ` fence and appends a `Mermaid diagram not rendered: ...` warning line. When `lovely-mermaid@0.3.3` returns `null` or the rendered width exceeds `availableWidth`, `transformBuiltInMermaid` returns the original ` ```mermaid ` fence with no warning.

`lovely-mermaid@0.3.3` parses every grammar on a best-effort basis. It drops an unreadable statement and keeps drawing, so one bad line produces a warning fallback instead of a source fallback. A YAML frontmatter `title:` is drawn above the diagram in every supported family, and the rest of the frontmatter is skipped. A diagram over a size cap (128 nodes, 512 edges, 24 subgraph groups or depth 6 for flowcharts, 128 participants or 512 items for sequence diagrams) renders its prefix with a `diagram truncated: ...` warning, which `transformBuiltInMermaid` treats like any other warning.

### Supported diagram families (`lovely-mermaid@0.3.3` vs `mermaid@12.2.0`)

| Family | Headers | Supported syntax | Ignored or flattened directives | Unsupported syntax and fallback |
| --- | --- | --- | --- | --- |
| Flowchart | `flowchart`, `graph` | Directions (`TB`, `TD`, `LR`, `RL`, `BT`), `%%{init: ...}%%` directives, `%%` comments, `;` statement separators, subgraphs (`subgraph id[Title]`, `subgraph "Title"`, nested subgraphs), node shapes (`[rect]`, `(round)`, `([stadium])`, `[[subroutine]]`, `[(cylinder)]`, `((circle))`, `{diamond}`, `{{hexagon}}`, `>asymmetric]`), Mermaid v11 `A@{ shape: cyl, label: "Text" }` node metadata, link operators (`-->`, `---`, `-.->`, `-.-`, `==>`, `===`, `<-->`, `<--`, `--o`, `o--o`, `--x`, `x--x`, `-->\|label\|`, `-- inline label -->`), and `&` node group fan-out and fan-in | `style`, `linkStyle`, and `direction` inside subgraphs are ignored. `classDef` with `class` or `:::className` applies `fill`, `stroke`, `color`, and `font-weight:bold` to the node as truecolor. `click A "url"` links the node's label text. Trapezoids (`[/text\]`, `[\text/]`) parse as rectangular nodes with literal slash and backslash text. `{diamond}` and `{{hexagon}}` render as double-line boxes | Unclosed brackets (`A[unclosed --> B`), `(((doublecircle)))`, and lines without links or not starting with a node trigger a warning fallback. Graphs over a size cap trigger a `diagram truncated` warning fallback |
| Sequence diagram | `sequenceDiagram` | `participant` and `actor` with `as` aliases, `autonumber`, all 8 message arrows (`->`, `-->`, `->>`, `-->>`, `-x`, `--x`, `-)`, `--)`), self-messages, activations (`+`, `-`, `activate`, `deactivate`, drawn as a double-line lifeline span), notes (`Note left of`, `Note right of`, `Note over A`, `Note over A,B`), and divider blocks (`loop`, `alt` with `else`, `opt`, `par` with `and`, `critical` with `option`, `break`, `end`) | `rect`, `box`, `create`, `destroy`, `title`, `links`, `link`, and `properties` are accepted without layout changes. `create participant` draws the participant from the top, and `title` is drawn only from YAML frontmatter | An unreadable statement, including `accTitle` and `accDescr`, triggers a `dropped, unreadable statement` warning fallback. Diagrams over 128 participants or 512 items trigger a `diagram truncated` warning fallback |
| State diagram | `stateDiagram`, `stateDiagram-v2` | `direction` (`TB`, `TD`, `LR`, `RL`, `BT`), `[*]` start and end states (rendered as `●`), `state "Label" as id`, `id: description` (appended to the state label, and repeated descriptions accumulate), `state id <<choice>>` (double-line box), `<<fork>>`, `<<join>>`, chained transitions (`A --> B --> C : label`), and composite states (`state Comp { ... }`) drawn as nested frames with `--` concurrency regions | `note ... end note` blocks, `hide`, and `scale` are parsed and not drawn. `classDef`, `class`, and `:::styleTag` apply colors as in flowcharts. `<<fork>>` and `<<join>>` render as rounded boxes. History states (`[H]`, `[H*]`) render as ordinary states named `[H]` or `[H*]` | An unreadable statement triggers a `dropped, unreadable statement` warning fallback. A single bare word on its own line declares a state |
| Class diagram | `classDiagram`, `classDiagram-v2` | `direction`, `class Name { ... }`, `class Name["Label"]`, visibility prefixes (`+`, `-`, `#`), attributes and methods (separated by `(`), generics (`~T~` rendered as `<T>`), annotations (`<<interface>>` inside a block and `<<service>> ClassName`), `ClassName : +member`, all 14 relationship operators (`<\|--`, `--\|>`, `<\|..`, `..|>`, `*--`, `--*`, `o--`, `--o`, `<--`, `-->`, `<..`, `..>`, `--`, `..`), and quoted cardinalities (`"1" --> "0..*"`, drawn on rows beside the connector ends with the label between them) | `namespace` blocks flatten into the main graph. `note`, `note for`, `style`, and `callback` are ignored. `classDef`, `cssClass`, `class A name`, and `:::styleTag` apply colors. `link A "url"` and `click A href "url"` link the class name. A leading `~` visibility marker on a member converts to `<` through generic formatting. Compartments elide with `…` after 8 attributes or 8 methods | An unreadable statement triggers a `dropped, unreadable statement` warning fallback. Lollipop interfaces (`()--`) and quoted multi-word class names (`class "Big Class"`) trigger a source fallback |
| ER diagram | `erDiagram` | `ENTITY { type name PK "comment" }` blocks (up to 8 attributes before `…`), bracketed entity aliases (`CUSTOMER[Account]`, `CUSTOMER["Customer Account"]`), identifying (`--`) and non-identifying (`..`) relationships, and all crow's-foot cardinalities (`\|o`, `o\|`, `\|\|`, `}o`, `o{`, `}\|`, `\|{` rendered as `0..1`, `1`, `*`, `1..*`, stacked with the relationship label on the connector) | Trailing quoted attribute comments (`"primary key"`) and `%%` comments are stripped | An unreadable statement, including `direction`, triggers a `dropped, unreadable statement` warning fallback. Word-based cardinality aliases trigger a source fallback |
| Pie chart | `pie` | `title`, `showData`, and `"Label" : value` rows, drawn as a labelled bar list with a percentage per row and a `░` track for the unfilled remainder. `showData` appends each raw value in parentheses | None | A row that does not read as `"Label" : value`, such as a negative value or `accTitle`, triggers a warning fallback. A pie with no rows triggers a source fallback |
| Mindmap | `mindmap` | The indentation tree, drawn with `├──` and `└──` guides. Node shape markers (`((root))`, `[box]`, `{{hex}}`) are dropped and only the text is drawn | `::icon(...)` and `:::class` lines are dropped without a warning | An empty mindmap triggers a source fallback |
| Timeline | `timeline` | `title`, `section` headers, periods, and events (`2025 : v1.3.0 : v1.4.0`), drawn as a vertical list. A period with no events renders event-less | Event text longer than about 30 columns truncates with `…` | An event line without a period (`: orphan`) triggers a source fallback |
| Git graph | `gitGraph` | `commit` with `id:`, `tag:`, and `type:`, `branch`, `checkout`, `switch`, `merge` with `tag:`, `cherry-pick`, and quoted branch names, drawn as `git log --graph` lanes with the newest commit on top | Direction (`gitGraph LR:`) and `%%{init: ...}%%` options, including `mainBranchName`, are ignored | An unreadable statement, including `reset` and `accTitle`, triggers a `dropped, unreadable statement` warning fallback |

### Unsupported Mermaid `12.2.0` diagram families

Stock Pi (`lovely-mermaid@0.3.3`) does not parse the remaining 26 official `mermaid@12.2.0` diagram families (39 header keywords) and retains their ` ```mermaid ` source fences with no warning. When the `prism` extension is active on assistant messages, `prism` renders 2 of these families (`gantt` and `xychart-beta` or `xychart`). It also renders `pie` as a round or horizontal-bar chart, which stock Pi draws as a bar list.

| Family | Headers | Stock Pi behavior (`lovely-mermaid@0.3.3`) | `prism` behavior when active |
| --- | --- | --- | --- |
| ELK flowchart | `flowchart-elk` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Gantt chart | `gantt` | Retains ` ```mermaid ` source fence | Renders schedule chart |
| XY chart | `xychart-beta`, `xychart` | Retains ` ```mermaid ` source fence | Renders bar and line chart |
| User journey | `journey` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Quadrant chart | `quadrantChart` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Sankey diagram | `sankey-beta`, `sankey` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Requirement diagram | `requirementDiagram`, `requirement` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| C4 diagram | `C4Context`, `C4Container`, `C4Component`, `C4Dynamic`, `C4Deployment` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Kanban board | `kanban` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Block diagram | `block-beta`, `block` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Packet diagram | `packet-beta`, `packet` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Architecture diagram | `architecture-beta`, `architecture` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Radar chart | `radar-beta` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Treemap | `treemap` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| ZenUML sequence diagram | `zenuml` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Ishikawa diagram | `ishikawa-beta` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Venn diagram | `venn-beta` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| TreeView diagram | `treeView-beta` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Swimlane diagram | `swimlane-beta` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Use case diagram | `usecase-beta` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Wardley map | `wardley-beta` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Cynefin diagram | `cynefin-beta` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Event modeling diagram | `eventmodeling` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Agentflow diagram | `agentflow-beta` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Railroad diagram | `railroad-beta`, `railroad-ebnf-beta`, `railroad-abnf-beta`, `railroad-peg-beta` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Version info | `info` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |

## Verification

The exported catalog and components support direct checks with the installed Pi packages. `test/prism.test.ts` contains the `registerHooks` resolver for installations without local `@earendil-works` packages.

A render check initializes Pi's theme, imports `index.ts`, and constructs `BuiltInDocumentComponent(makeDocument())` and one document per key in `SECTIONS`. Rendering at width 90 exercises every fixture. Narrow-width checks exercise Mermaid source fallback and table wrapping.

Interactive verification uses a temporary agent directory so personal sessions remain untouched. The relevant checks are prism isolation, absence of demo text in the next provider request, session resume, terminal resizing, and theme changes. Direct component rendering alone does not verify those interactive behaviors.
