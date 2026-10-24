# prismantis

A pi port of [NahumLitvin/prismantis](https://github.com/NahumLitvin/prismantis) 0.35.0. It redraws assistant replies, user prompts, tool rows, and diff cards with 17 themes, multi-color Mermaid diagrams, `xychart-beta` bar and line charts, pie and Gantt charts, ` ```figure ` text pictures, copy buttons, LaTeX math, and right-to-left prose.

The extension entry point is [`index.ts`](index.ts). [`renderer.ts`](renderer.ts) lays out element trees into ANSI terminal lines and mouse click regions. [`core/`](core) holds the upstream rendering modules, synced by [`scripts/sync-prismantis.mjs`](../../scripts/sync-prismantis.mjs).

## Setup

Install the package:

```sh
pi install git:github.com/amikai/pi-stuff
```

Run `/prismantis setup` to pick a theme and styles from live previews, or `/prismantis demo` to see every rendered element.

## Commands

| Command | Action |
|---|---|
| `/prismantis` | Show the help screen and theme list |
| `/prismantis theme <name>` | Switch to one of the 17 themes or `random` (`/prismantis <name>` also works) |
| `/prismantis setup` | Open the interactive setup overlay in TUI mode, or step through options with `/prismantis setup <step> <pick>` |
| `/prismantis copy` | Copy the last assistant reply, or `/prismantis copy code` for its last code block |
| `/prismantis demo` | Print the full showcase (`demo ko` appends the Korean section) |
| `/prismantis demo-rtl` | Print the Hebrew right-to-left showcase |

## Settings

Settings live in `~/.pi/agent/prismantis.json` (or `$PI_CODING_AGENT_DIR/prismantis.json`). Every field is optional:

```json
{
	"enabled": true,
	"theme": "catppuccin-mocha",
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
	"rtl": "auto",
	"syncPiTheme": true
}
```

Any of the 22 semantic color slots (`accentColor`, `headingColor`, `tableHeaderColor`, `tableRuleColor`, `numberColor`, `pathColor`, `linkColor`, `inlineCodeColor`, `codeTextColor`, `codeCommandColor`, `codeFlagColor`, `codeStringColor`, `codeCommentColor`, `strongColor`, `emphasisColor`, `quoteColor`, `ruleColor`, `bulletColor`, `diagramColor`, `diagramTextColor`, `diffAddedColor`, `diffRemovedColor`) can also be set to a hex, `rgb()`, `ansi256()`, or named ANSI color.

When `syncPiTheme` is `true` (the default), switching the prismantis theme also switches pi's active UI theme to the matching `prismantis-<name>` theme from [`themes/`](../../themes).

## Syncing from upstream

To update `core/` and `themes/` from an upstream prismantis checkout at `../prismantis`:

```sh
npm run sync:prismantis
```

## Testing

```sh
npm test
test/prismantis.sh
```

`npm test` runs [`test/prismantis.test.ts`](../../test/prismantis.test.ts), which checks all 17 generated pi themes, verifies that `core/` matches the 4 upstream snapshot files in `../prismantis/tests/snapshots/`, and exercises assistant replies, user prompts, tool rows, diff cards, mouse click handlers, setup overlay navigation, and prompt hints.
