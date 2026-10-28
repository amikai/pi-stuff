# prism

`prism` is a Pi terminal rendering extension inspired by the [upstream project](https://github.com/NahumLitvin/prismantis). It strips away the upstream tool-row, diff-card, bash-output, and standalone theme-management layers to focus on rendering Markdown, LaTeX math, right-to-left prose, charts, and diagrams with interactive copy buttons.

Colors come directly from Pi's active theme (`ctx.ui.theme`). When you switch between `system`, `dark`, `light`, or a custom theme in Pi's `/settings`, `prism` updates its 20 semantic color slots automatically without mutating global Pi settings.

## Core features

- **Markdown typography and structure (`core/markdown.ts`, `core/render.ts`).** Renders banner, bold, underline, and uppercase headings, box/rules/grid/minimal tables with `<br>` line breaks, GitHub alerts (`[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`), task lists (`checks`, `ticks`, `box`, `progress`), blockquotes, footnotes, automatic number and path highlighting, and clickable OSC-8 `file://` hyperlinks for existing workspace paths.
- **Code blocks with line numbers and folding (`core/render.ts`).** Highlights fenced code blocks with Prism grammars, numbers blocks of 10 lines or more, and folds blocks longer than 30 lines to the first 20 lines with a clickable `[ +M more lines ]` toggle.
- **Mermaid diagrams (`core/mermaid.ts`, `core/merman.ts`).** Renders `flowchart` and `sequenceDiagram` blocks as multi-color terminal box art. When text art cannot draw a closed top-level block (a kind it lacks, more than 80 lines, wider than the terminal, or syntax its parser rejects), the terminal shows images and [`merman-cli`](https://github.com/Latias94/merman) is on `PATH` (`brew install merman-cli`), prism draws the block with merman instead, in the background: the source shows under `drawing with merman…` until the PNG replaces it. Otherwise the block stays source with a dim note above the fence, as before. merman draws in its light theme on a white background at twice the size the terminal shows, so the picture stays sharp on a Retina terminal, and `PATH` is read once per session, so restart pi after installing it. merman's own parse errors decline: an unknown header word or a broken body exits non-zero, and prism keeps the note and the code block. A render has 5 s, one render runs at a time, and a source over 100 000 characters or a PNG over 3 MiB is declined. Whenever merman cannot draw a block, for any reason, the block shows what it showed before merman existed: the dim note and the plain code block, with no mention of merman. When `merman-cli` is installed, the terminal shows images, outside SSH, and `mermaid`, `merman` and `diagramHints` are on, prism also tells the model which other kinds merman draws, with a note to keep them small. Fences still open while a reply streams, blocks inside lists, quotes or alerts, terminals without images, and SSH sessions never start merman.
- **PlantUML diagrams (`core/plantuml.ts`).** Renders fenced ` ```plantuml `, ` ```puml `, and ` ```uml ` blocks, untagged fences that open with `@start...`, and unfenced `@start...` to `@end...` blocks in a reply as images, on terminals that show images. Rendering is asynchronous: the block draws as source until the bundled PlantUML engine finishes, then redraws as a PNG. Other terminals show a note and start no render. There is no Java, `plantuml` command, or network request. Set `plantuml: false` to leave these blocks as ordinary code. Only top-level blocks render, not ones inside lists, quotes, or alerts.
- **Charts and schedules (`core/charts.ts`, `core/mermaid.ts`).** Renders `xychart-beta` bar and multi-series line charts with legends, round quadrant or horizontal-bar `pie` charts (`pieStyle`), and `gantt` schedules.
- **Aligned text figures (`core/figure.ts`).** Renders ` ```figure ` blocks with semantic `{role:text}` coloring (`accent`, `warn`, `ok`, `note`, `dim`, `strong`) and automatic box-border alignment.
- **LaTeX math and inline images (`core/latex.ts`).** Converts inline `$...$` and display `$$...$$` / ` ```math ` formulas to styled Unicode math by default, or typesets display formulas into high-DPI PNG images via `ratex-render` on Kitty, Ghostty, and iTerm2 when `latex: true` is set.
- **Right-to-left (RTL) prose and tables (`core/rtl.ts`).** Reorders and aligns Hebrew and Arabic headings, paragraphs, lists, quotes, tables, and diagrams per terminal emulator while preserving embedded LTR code, paths, and numbers.
- **Interactive copy buttons (`core/clipboard.ts`, `core/html.ts`).** Attaches clickable copy buttons (`[ ⧉ copy ]`, `[ ⧉ source ]`, `[ ⧉ art ]`, `[ ⧉ md ]`, `[ ⧉ html ]`, and `[ ⧉ copy reply ]`) to code blocks, diagrams, tables, quotes, lists, and multi-block replies. `[ ⧉ html ]` writes both HTML and tab-separated text to the system clipboard so pasting into Slack or docs produces a native table. Set `copyButtonStyle` to `"hover"` to show buttons only when the pointer hovers over `⧉`. A PlantUML or merman block drawn as an image gets `[ ⧉ source ]` (the diagram text), `[ ⧉ image ]` (the PNG on the macOS pasteboard) and `[ ⧉ preview ]` (the PNG in Quick Look, in front of the terminal, a new panel on every press). The last two appear only when `prism` runs on macOS outside SSH, and narrow terminals drop `preview` and then `image`. Preview PNGs are written to `$TMPDIR/prism-preview/diagram-<hash>.png`, so the Quick Look title bar shows one name pattern for every diagram source. The preview opens through a small Swift helper, [`quicklook.swift`](quicklook.swift), which the first preview compiles with `swiftc` into `~/.pi/agent/prism/` in about 10 seconds. The helper adds Liquid Glass zoom out, actual size and zoom in controls, the three zoom buttons of Preview's toolbar, to the Quick Look title bar ahead of its own Share and Open with Preview. A changed source compiles again. Without the Xcode command line tools the build fails, `prism` warns once per session, and the preview falls back to `qlmanage`, whose panel opens behind the terminal.

## Architecture

- [`index.ts`](index.ts) registers the `/prism` command, hooks `AssistantMessageComponent` and `UserMessageComponent`, maps `ctx.ui.theme.colors` into `prism`'s 20 color slots, and injects diagram/figure/LaTeX guidelines into the system prompt.
- [`renderer.ts`](renderer.ts) lays out virtual `Box`, `Text`, `Button`, `Link`, and `Image` element trees into ANSI terminal lines and mouse hit regions (`PrismComponent`).
- [`desktop.ts`](desktop.ts) owns the picture side effects behind `Desktop`: the PNG pasteboard write, the Quick Look helper build, and the Quick Look launch.
- [`core/`](core) holds the self-contained parsing and rendering modules (`markdown.ts`, `render.ts`, `mermaid.ts`, `merman.ts`, `background.ts`, `plantuml.ts`, `charts.ts`, `figure.ts`, `latex.ts`, `rtl.ts`, `html.ts`, `clipboard.ts`, `theme.ts`, `help.ts`, `jsx.ts`).

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
	"merman": true,
	"rtl": "auto"
}
```

Any of the 20 semantic color slots (`accentColor`, `headingColor`, `tableHeaderColor`, `tableRuleColor`, `numberColor`, `pathColor`, `linkColor`, `inlineCodeColor`, `codeTextColor`, `codeCommandColor`, `codeFlagColor`, `codeStringColor`, `codeCommentColor`, `strongColor`, `emphasisColor`, `quoteColor`, `ruleColor`, `bulletColor`, `diagramColor`, `diagramTextColor`) can be set to a hex, `rgb()`, `ansi256()`, or named ANSI color to override that slot on top of Pi's active theme.

### merman

| Field | Type | Default | Behavior |
|---|---|---|---|
| `merman` | `boolean` | `true` | Lets `merman-cli` draw ```` ```mermaid ```` blocks the text renderer cannot draw. When `false`, `prism` never starts `merman-cli`, and those blocks keep the dim note and the plain code block. merman is also off over SSH (`SSH_CONNECTION` or `SSH_TTY` set), as are image and preview copy. |

### PlantUML

| Field | Type | Default | Behavior |
|---|---|---|---|
| `plantuml` | `boolean` | `true` | Enables detection and rendering. When `false`, PlantUML blocks render as ordinary code blocks. |

PlantUML runs in a worker thread that `prism` starts on the first diagram. Diagrams render one at a time, the first about 0.3 s after the worker starts and later ones in 15 to 70 ms. A render that takes more than 5 s ends with the note `plantuml render timed out`, and the next diagram gets a fresh worker. If the worker fails, the note is `plantuml worker failed`.

The engine reads no files and makes no requests. It declines every `!include`, `!includeurl`, and `!theme ... from`, including PlantUML's built-in libraries such as `!include <C4/C4_Container>`, and a declined line shows PlantUML's reason as the note, as in `cannot include /etc/passwd`. `%getenv` does nothing. PlantUML's own themes, such as `!theme cerulean`, still work, because they are bundled into the engine. The engine cannot draw bitmap sprites, as in `sprite $x [16x16/16] {...}`: a diagram that uses one fails with `Rendering failed: java.lang.UnsupportedOperationException`. SVG sprites draw.

Diagrams draw in PlantUML's light theme on an opaque white background, whatever Pi's theme is. Dark mode is not available. Terminals without images show the note `plantuml diagrams require an image-capable terminal`, because there is no text art.

Text is drawn with fonts read from the system: Helvetica and Hiragino Sans GB on macOS, and Liberation Sans, DejaVu Sans, and Noto Sans CJK on Linux. Characters that none of the installed fonts cover are left out. With none of them installed, the note is `plantuml error: no system font found to draw text`.

Results, including failures, are cached for the session. Edit the source to retry.

## PlantUML engine

[`core/vendor/plantuml.js`](core/vendor/plantuml.js) is PlantUML compiled to JavaScript and bundled with Graphviz and resvg into one file. [`core/vendor/plantuml/README.md`](core/vendor/plantuml/README.md) says where it comes from, how to rebuild it, and which patches it carries.

## Testing and verification

```sh
npm test
test/prism.sh
```

`npm test` runs [`test/prism.test.ts`](../../test/prism.test.ts). For end-to-end artifact verification across Markdown, diagrams, RTL, LaTeX, setup commands, and theme synchronization, use the project verification skill at [`.pi/skills/verify/SKILL.md`](../../.pi/skills/verify/SKILL.md).
