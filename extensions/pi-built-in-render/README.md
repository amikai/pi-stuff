# Pi built-in render

`/pi-built-in-render` appends examples of Pi's stock output components to the transcript. It works independently of prism and does not request a model turn.

## Commands

| Argument | Output |
| --- | --- |
| No argument, `all`, or `demo` | Every section, in registry order |
| `markdown` | H1 through H4, emphasis, inline code, links, and CJK text |
| `lists` | Unordered, ordered, nested, and task lists |
| `quotes` | Nested quotes, quoted lists and code, and horizontal rules |
| `tables` | GFM alignment, box-drawn borders, CJK cells, and multiline wrapping |
| `code` | TypeScript, Python, JSON, Bash, and unlabelled fences |
| `math` | Inline and display LaTeX, fractions, operators, matrices, and cases |
| `mermaid` | Flowchart, sequence, state, class, and ER diagrams, plus source fallbacks |
| `diff` | Numbered changes with word-level inverse styling and multiline replacements |
| `image` | Embedded PNG with native image protocols or a text fallback |
| `help`, `-h`, or `--help` | Command reference in the transcript |

Arguments are lowercase and case-sensitive. Surrounding whitespace is ignored. Unknown arguments and multiple arguments produce a notification without appending an entry. Tab completion lists matching arguments. Non-interactive modes produce a notification without appending an entry.

## Rendering and persistence

The extension uses `Markdown`, `Text(renderDiff(...))`, and `Image` directly. It does not use assistant-message components, global Markdown transformers, or prism configuration.

Mermaid uses the `grok-mermaid` dependency resolved from Pi's package directory. The adapter follows Pi's nonstreaming top-level fence behavior and semantic theme colors. Unrecognized diagrams and diagrams wider than the available content width retain their source fences. Syntax warnings retain the source and add Pi's warning text when the diagram fits.

OSC-8 hyperlinks depend on terminal support. Kitty and iTerm2 image protocols display the bundled PNG inline when available. Other terminals show Pi's text fallback. The extension does not change terminal capabilities.

Each command appends one versioned document containing the original examples. Resume uses that saved source rather than the current catalog. Invalid saved data produces a plain diagnostic without printing its contents. The decoder accepts at most 64 blocks, limits text fields to 1 MiB, and limits decoded PNG data to 256 KiB.

Theme invalidation rebuilds Markdown and diff components. Image components retain their protocol IDs across ordinary renders and invalidate their cached output. Each transcript entry owns its component instances.

New entries do not enter model context. The context handler also removes compatibility custom messages with the `pi-built-in-render` custom type. It preserves other messages in order.

## Verification

The exported catalog and components support direct checks with the installed Pi packages. `test/prism.test.ts` contains the `registerHooks` resolver for installations without local `@earendil-works` packages.

A render check initializes Pi's theme, imports `index.ts`, and constructs `BuiltInDocumentComponent(makeDocument(section))` for each key in `SECTIONS`. Rendering at width 90 exercises every fixture. Narrow-width checks exercise Mermaid source fallback and table wrapping.

Interactive verification uses a temporary agent directory so personal sessions remain untouched. The relevant checks are prism isolation, absence of demo text in the next provider request, session resume, terminal resizing, and theme changes. Direct component rendering alone does not verify those interactive behaviors.
