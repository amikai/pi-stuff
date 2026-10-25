# prismantis

A pi port of [NahumLitvin/prismantis](https://github.com/NahumLitvin/prismantis) 0.35.0. It redraws assistant replies, user prompts, tool rows, and diff cards using Pi's active theme colors (`ctx.ui.theme`), with multi-color Mermaid diagrams, `xychart-beta` bar and line charts, pie and Gantt charts, ` ```figure ` text pictures, copy buttons, LaTeX math, and right-to-left prose.

The extension entry point is [`index.ts`](index.ts). [`renderer.ts`](renderer.ts) lays out element trees into ANSI terminal lines and mouse click regions. [`core/`](core) holds the upstream rendering modules, synced by [`scripts/sync-prismantis.mjs`](../../scripts/sync-prismantis.mjs).

## Setup

Install the package:

```sh
pi install git:github.com/amikai/pi-stuff
```

Run `/prismantis setup` to pick styles from live previews, or `/prismantis demo` to see every rendered element. Switch colors through Pi's `/settings` → **Theme**.

## Commands

| Command | Action |
|---|---|
| `/prismantis` | Show the help screen |
| `/prismantis setup` | Open the interactive setup overlay in TUI mode, or step through options with `/prismantis setup <step> <pick>` |
| `/prismantis copy` | Copy the last assistant reply, or `/prismantis copy code` for its last code block |
| `/prismantis demo` | Print the full showcase (`demo ko` appends the Korean section) |
| `/prismantis demo-rtl` | Print the Hebrew right-to-left showcase |

## Settings

Settings live in `~/.pi/agent/prismantis.json` (or `$PI_CODING_AGENT_DIR/prismantis.json`). Every field is optional:

```json
{
	"enabled": true,
	"headingStyle": "banner",
	"tableStyle": "box",
	"taskStyle": "checks",
	"promptStyle": "bubble",
	"clock": "off",
	"toolStyle": "chat",
	"toolOutput": "full",
	"diffStyle": "card",
	"pieStyle": "round",
	"copyButtons": true,
	"copyButtonStyle": "inline",
	"toolRows": true,
	"mermaid": true,
	"mermaidAscii": false,
	"highlightNumbers": true,
	"highlightPaths": true,
	"diagramHints": true,
	"issueHint": true,
	"latex": false,
	"rtl": "auto"
}
```

Colors come automatically from Pi's active theme (`system`, `dark`, `light`, or any custom Pi theme). Any of the 22 semantic color slots (`accentColor`, `headingColor`, `tableHeaderColor`, `tableRuleColor`, `numberColor`, `pathColor`, `linkColor`, `inlineCodeColor`, `codeTextColor`, `codeCommandColor`, `codeFlagColor`, `codeStringColor`, `codeCommentColor`, `strongColor`, `emphasisColor`, `quoteColor`, `ruleColor`, `bulletColor`, `diagramColor`, `diagramTextColor`, `diffAddedColor`, `diffRemovedColor`) can also be set in `prismantis.json` to a hex, `rgb()`, `ansi256()`, or named ANSI color to override that slot within prismantis.

## Syncing from upstream

To update `core/` from an upstream prismantis checkout at `../prismantis`:

```sh
npm run sync:prismantis
```

## Testing

```sh
npm test
test/prismantis.sh
```

`npm test` runs [`test/prismantis.test.ts`](../../test/prismantis.test.ts), which verifies that prismantis derives its palette from Pi's active theme and updates dynamically when Pi switches themes, checks that `core/` matches the 4 upstream snapshot files in `../prismantis/tests/snapshots/`, and exercises assistant replies, user prompts, tool rows, diff cards, mouse click handlers, setup overlay navigation, and prompt hints.
