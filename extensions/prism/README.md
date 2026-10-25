# prism

`prism` is a Pi terminal rendering extension inspired by [NahumLitvin/prismantis](https://github.com/NahumLitvin/prismantis). It strips away the upstream tool-row, diff-card, bash-output, and standalone theme-management layers to focus on rendering Markdown, LaTeX math, right-to-left prose, charts, and diagrams with interactive copy buttons.

Colors come directly from Pi's active theme (`ctx.ui.theme`). When you switch between `system`, `dark`, `light`, or a custom theme in Pi's `/settings`, `prism` updates its 20 semantic color slots automatically without mutating global Pi settings.

## Core features

- **Markdown typography and structure (`core/markdown.ts`, `core/render.ts`).** Renders banner, bold, underline, and uppercase headings, box/rules/grid/minimal tables with `<br>` line breaks, GitHub alerts (`[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`), task lists (`checks`, `ticks`, `box`, `progress`), blockquotes, footnotes, automatic number and path highlighting, and clickable OSC-8 `file://` hyperlinks for existing workspace paths.
- **Code blocks with line numbers and folding (`core/render.ts`).** Highlights fenced code blocks with Prism grammars, numbers blocks of 10 lines or more, and folds blocks longer than 30 lines to the first 20 lines with a clickable `[ +M more lines ]` toggle.
- **Mermaid diagrams (`core/mermaid.ts`).** Renders `flowchart` and `sequenceDiagram` blocks as multi-color terminal box art. Diagrams wider than the terminal stay as source code with a dim width note above the fence.
- **PlantUML diagrams (`core/plantuml.ts`).** Renders fenced ` ```plantuml `, ` ```puml `, and ` ```uml ` blocks, untagged fences that open with `@start...`, and unfenced `@start...` to `@end...` blocks in a reply. Rendering is asynchronous: the block draws as source until the local `plantuml` command finishes, then redraws as a PNG on terminals that show images, or as text art (sequence diagrams only) elsewhere. Set `plantuml: false` to leave these blocks as ordinary code. Only top-level blocks render, not ones inside lists, quotes, or alerts.
- **Charts and schedules (`core/charts.ts`, `core/mermaid.ts`).** Renders `xychart-beta` bar and multi-series line charts with legends, round quadrant or horizontal-bar `pie` charts (`pieStyle`), and `gantt` schedules.
- **Aligned text figures (`core/figure.ts`).** Renders ` ```figure ` blocks with semantic `{role:text}` coloring (`accent`, `warn`, `ok`, `note`, `dim`, `strong`) and automatic box-border alignment.
- **LaTeX math and inline images (`core/latex.ts`).** Converts inline `$...$` and display `$$...$$` / ` ```math ` formulas to styled Unicode math by default, or typesets display formulas into high-DPI PNG images via `ratex-render` on Kitty, Ghostty, and iTerm2 when `latex: true` is set.
- **Right-to-left (RTL) prose and tables (`core/rtl.ts`).** Reorders and aligns Hebrew and Arabic headings, paragraphs, lists, quotes, tables, and diagrams per terminal emulator while preserving embedded LTR code, paths, and numbers.
- **Interactive copy buttons (`core/clipboard.ts`, `core/html.ts`).** Attaches clickable copy buttons (`[ ⧉ copy ]`, `[ ⧉ source ]`, `[ ⧉ art ]`, `[ ⧉ md ]`, `[ ⧉ html ]`, and `[ ⧉ copy reply ]`) to code blocks, diagrams, tables, quotes, lists, and multi-block replies. `[ ⧉ html ]` writes both HTML and tab-separated text to the system clipboard so pasting into Slack or docs produces a native table. Set `copyButtonStyle` to `"hover"` to show buttons only when the pointer hovers over `⧉`.

## Architecture

- [`index.ts`](index.ts) registers the `/prism` command, hooks `AssistantMessageComponent` and `UserMessageComponent`, maps `ctx.ui.theme.colors` into `prism`'s 20 color slots, and injects diagram/figure/LaTeX guidelines into the system prompt.
- [`renderer.ts`](renderer.ts) lays out virtual `Box`, `Text`, `Button`, `Link`, and `Image` element trees into ANSI terminal lines and mouse hit regions (`PrismComponent`).
- [`core/`](core) holds the self-contained parsing and rendering modules (`markdown.ts`, `render.ts`, `mermaid.ts`, `plantuml.ts`, `charts.ts`, `figure.ts`, `latex.ts`, `rtl.ts`, `html.ts`, `clipboard.ts`, `clock.ts`, `theme.ts`, `help.ts`, `jsx.ts`).

## Commands

| Command | Action |
|---|---|
| `/prism` | Display the help screen |
| `/prism setup` | Open the interactive 7-step style picker overlay in TUI mode, or step through options with `/prism setup <step> <pick>` |
| `/prism demo` | Render the full showcase (`demo ko` appends the Korean section) |
| `/prism demo-rtl` | Render the Hebrew right-to-left showcase |

All `/prism` output is recorded via `pi.appendEntry` as display-only custom entries and never enters the LLM conversation context.

## Settings

Settings live in `~/.pi/agent/prism.json` (or `$PI_CODING_AGENT_DIR/prism.json`). Every field is optional:

```json
{
	"enabled": true,
	"headingStyle": "banner",
	"tableStyle": "box",
	"taskStyle": "checks",
	"promptStyle": "bubble",
	"clock": "off",
	"pieStyle": "round",
	"copyButtons": true,
	"copyButtonStyle": "inline",
	"mermaid": true,
	"mermaidAscii": false,
	"highlightNumbers": true,
	"highlightPaths": true,
	"diagramHints": true,
	"latex": false,
	"plantuml": true,
	"rtl": "auto"
}
```

Any of the 20 semantic color slots (`accentColor`, `headingColor`, `tableHeaderColor`, `tableRuleColor`, `numberColor`, `pathColor`, `linkColor`, `inlineCodeColor`, `codeTextColor`, `codeCommandColor`, `codeFlagColor`, `codeStringColor`, `codeCommentColor`, `strongColor`, `emphasisColor`, `quoteColor`, `ruleColor`, `bulletColor`, `diagramColor`, `diagramTextColor`) can be set to a hex, `rgb()`, `ansi256()`, or named ANSI color to override that slot on top of Pi's active theme.

### PlantUML

| Field | Type | Default | Behavior |
|---|---|---|---|
| `plantuml` | `boolean` | `true` | Enables detection and rendering. When `false`, PlantUML blocks render as ordinary code blocks. |
| `plantumlServer` | `string` | unset | Remote base URL, used only when the local `plantuml` command is missing, times out, or fails. Accepted when it is `https:`, or `http:` on `localhost`, `127.0.0.1`, or `[::1]`. Any other value is ignored. |

With `plantumlServer` unset, `prism` makes no outbound requests. The local command runs with `PLANTUML_SECURITY_PROFILE=SANDBOX`, which blocks `!include`, `!includeurl`, and local file access, and with `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS`, and `JDK_JAVA_OPTIONS` removed from its environment. With `plantumlServer` set, the diagram source is sent to that server only after the local command cannot render it, never after a syntax error. The server request is one `fetch` with an 8 s timeout and no retries.

Results, including failures, are cached for the session. Edit the source to retry. Text art needs a sequence diagram, so other diagram types need an image-capable terminal.

## Testing and verification

```sh
npm test
test/prism.sh
```

`npm test` runs [`test/prism.test.ts`](../../test/prism.test.ts). For end-to-end artifact verification across Markdown, diagrams, RTL, LaTeX, setup commands, and theme synchronization, use the project verification skill at [`.pi/skills/verify/SKILL.md`](../../.pi/skills/verify/SKILL.md).
