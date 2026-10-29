# Pi built-in render

`/pi-built-in-render` appends examples of Pi's stock output components to the transcript. It works independently of prism and does not request a model turn.

## Commands

`/pi-built-in-render` takes no arguments. It renders every section in registry order: Markdown headings and inline styles, lists, quotes, tables, code, LaTeX math, Mermaid diagrams, diffs, and an inline image.

Any argument produces a notification without appending an entry. Non-interactive modes also produce a notification without appending an entry.

## Rendering and persistence

The extension uses `Markdown`, `Text(renderDiff(...))`, and `Image` directly. It does not use assistant-message components, global Markdown transformers, or prism configuration.

Mermaid uses the `grok-mermaid` dependency resolved from Pi's package directory. The adapter follows Pi's nonstreaming top-level fence behavior and semantic theme colors. Unrecognized diagrams and diagrams wider than the available content width retain their source fences. Syntax warnings retain the source and add Pi's warning text when the diagram fits.

OSC-8 hyperlinks depend on terminal support. Kitty and iTerm2 image protocols display the bundled PNG inline when available. Other terminals show Pi's text fallback. The extension does not change terminal capabilities.

Each command appends one versioned document containing the original examples. Resume uses that saved source rather than the current catalog. Invalid saved data produces a plain diagnostic without printing its contents. The decoder accepts at most 64 blocks, limits text fields to 1 MiB, and limits decoded PNG data to 256 KiB.

Theme invalidation rebuilds Markdown and diff components. Image components retain their protocol IDs across ordinary renders and invalidate their cached output. Each transcript entry owns its component instances.

New entries do not enter model context. The context handler also removes compatibility custom messages with the `pi-built-in-render` custom type. It preserves other messages in order.

## Mermaid support matrix

This matrix compares the official `mermaid@12.2.0` specification against the `grok-mermaid@0.2.3` renderer bundled with `@earendil-works/pi-coding-agent@1.4.0`.

When `grok-mermaid@0.2.3` parses a diagram without warnings and the rendered width fits `availableWidth`, `transformBuiltInMermaid` replaces the ` ```mermaid ` fence with per-line inline code spans. When `grok-mermaid@0.2.3` records a parser warning and the partial diagram fits `availableWidth`, `transformBuiltInMermaid` retains the original ` ```mermaid ` fence and appends a `Mermaid diagram not rendered: ...` warning line. When `grok-mermaid@0.2.3` returns `null` or the rendered width exceeds `availableWidth`, `transformBuiltInMermaid` returns the original ` ```mermaid ` fence with no warning.

### Supported diagram families (`grok-mermaid@0.2.3` vs `mermaid@12.2.0`)

| Family | Headers | Supported syntax | Ignored or flattened directives | Unsupported syntax and fallback |
| --- | --- | --- | --- | --- |
| Flowchart | `flowchart`, `graph` | Directions (`TB`, `TD`, `LR`, `RL`, `BT`), `%%{init: ...}%%` directives, `%%` comments, `;` statement separators, subgraphs (`subgraph id[Title]`, `subgraph "Title"`, nested subgraphs), node shapes (`[rect]`, `(round)`, `([stadium])`, `[[subroutine]]`, `[(cylinder)]`, `((circle))`, `{diamond}`, `{{hexagon}}`, `>asymmetric]`), link operators (`-->`, `---`, `-.->`, `-.-`, `==>`, `===`, `<-->`, `<--`, `--o`, `o--o`, `--x`, `x--x`, `-->\|label\|`, `-- inline label -->`), and `&` node group fan-out and fan-in | `classDef`, `class`, `style`, `linkStyle`, `click`, `direction` inside subgraphs, and `:::className` suffixes are ignored. Trapezoids (`[/text\]`, `[\text/]`) parse as rectangular nodes with literal slash and backslash text. `{diamond}` and `{{hexagon}}` render as rounded boxes | Unclosed brackets (`A[unclosed --> B`), `(((doublecircle)))`, Mermaid v11 `@{ shape: ... }` node metadata, and lines without links trigger a warning fallback. YAML frontmatter (`---`) before the header or graphs over 128 nodes, 512 edges, 24 subgraphs, or 6 nested subgraph levels trigger a source fallback |
| Sequence diagram | `sequenceDiagram` | `participant` and `actor` with `as` aliases, `autonumber`, all 8 message arrows (`->`, `-->`, `->>`, `-->>`, `-x`, `--x`, `-)`, `--)`), self-messages, notes (`Note left of`, `Note right of`, `Note over A`, `Note over A,B`), and divider blocks (`loop`, `alt` with `else`, `opt`, `par` with `and`, `critical` with `option`, `break`, `end`) | Activation markers (`+`, `-`, `activate`, `deactivate`), `rect`, `box`, `create`, `destroy`, `title`, `accTitle`, `accDescr`, `links`, `link`, and `properties` are accepted without layout changes | An unreadable final line after valid statements triggers a `dropped, unreadable final line` warning fallback. An invalid statement before the final line, YAML frontmatter, or a diagram over 128 participants or 512 items triggers a source fallback |
| State diagram | `stateDiagram`, `stateDiagram-v2` | `direction` (`TB`, `TD`, `LR`, `RL`, `BT`), `[*]` start and end states (rendered as `●`), `state "Label" as id`, `id: description`, `state id <<choice>>`, `<<fork>>`, `<<join>>`, chained transitions (`A --> B --> C : label`), and single-line or multiline `note ... end note` blocks | Composite states (`state Comp { ... }`) and `--` concurrency separators flatten into the main graph. `classDef`, `class`, `hide`, `scale`, and `:::styleTag` suffixes are ignored | An unreadable final line after valid statements triggers a `dropped, unreadable final line` warning fallback. History states (`[H]`, `[H*]`), invalid statements before the final line, or YAML frontmatter trigger a source fallback |
| Class diagram | `classDiagram`, `classDiagram-v2` | `direction`, `class Name { ... }`, visibility prefixes (`+`, `-`, `#`), attributes and methods (separated by `(`), generics (`~T~` rendered as `<T>`), annotations (`<<interface>>` inside a block and `<<service>> ClassName`), `ClassName : +member`, all 14 relationship operators (`<\|--`, `--\|>`, `<\|..`, `..|>`, `*--`, `--*`, `o--`, `--o`, `<--`, `-->`, `<..`, `..>`, `--`, `..`), and quoted cardinalities (`"1" --> "0..*"`) | `namespace` blocks flatten into the main graph. `note`, `classDef`, `cssClass`, `style`, `click`, `link`, `callback`, and `:::styleTag` suffixes are ignored. A leading `~` visibility marker on a member converts to `<` through generic formatting. Compartments elide with `…` after 8 attributes or 8 methods | An unreadable final line after valid statements triggers a `dropped, unreadable final line` warning fallback. Lollipop interfaces (`()--`), multi-word class names, invalid lines before the final line, or YAML frontmatter trigger a source fallback |
| ER diagram | `erDiagram` | `ENTITY { type name PK "comment" }` blocks (up to 8 attributes before `…`), single-word bracketed entity aliases (`CUSTOMER[Account]`), identifying (`--`) and non-identifying (`..`) relationships, and all crow's-foot cardinalities (`\|o`, `o\|`, `\|\|`, `}o`, `o{`, `}\|`, `\|{` rendered as `0..1`, `1`, `0..*`, `1..*`) | Trailing quoted attribute comments (`"primary key"`) and `%%` comments are stripped | An unreadable final line after valid statements triggers a `dropped, unreadable final line` warning fallback. Multi-word entity aliases (`CUSTOMER["Customer Account"]`), `direction` statements, word-based cardinality aliases, or YAML frontmatter trigger a source fallback |

### Unsupported Mermaid `12.2.0` diagram families

Stock Pi (`grok-mermaid@0.2.3`) does not parse the remaining 30 official `mermaid@12.2.0` diagram families (43 header keywords) and retains their ` ```mermaid ` source fences with no warning. When the `prism` extension is active on assistant messages, `prism` renders 3 of these families (`pie`, `gantt`, and `xychart-beta` or `xychart`).

| Family | Headers | Stock Pi behavior (`grok-mermaid@0.2.3`) | `prism` behavior when active |
| --- | --- | --- | --- |
| ELK flowchart | `flowchart-elk` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Pie chart | `pie` | Retains ` ```mermaid ` source fence | Renders quadrant or horizontal-bar chart |
| Gantt chart | `gantt` | Retains ` ```mermaid ` source fence | Renders schedule chart |
| XY chart | `xychart-beta`, `xychart` | Retains ` ```mermaid ` source fence | Renders bar and line chart |
| Git graph | `gitGraph` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Mindmap | `mindmap` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
| Timeline | `timeline` | Retains ` ```mermaid ` source fence | Retains ` ```mermaid ` source fence |
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
