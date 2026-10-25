# Reply Markdown rendering

Reply Markdown rendering draws assistant replies with styled headings, bordered tables, GitHub alerts, task lists, footnotes, probed local file hyperlinks, and code blocks that fold past 30 lines and unfold on click.

## Sub-features

- `reply-heading-table` renders banner headings, box tables with `<br>` line breaks, alerts, and task lists within the terminal width.
- `reply-code-fold` folds code blocks longer than 30 lines to 20 lines with a `[ +N more lines ]` button and unfolds all lines on left-click.
- `reply-path-links` links existing workspace files with `file://` OSC-8 hyperlinks while leaving missing files and executable scripts unlinked.

## How to get to it (user POV)

- Receive an assistant reply containing Markdown headings, tables, alerts, task items, inline file paths, footnotes, and a fenced code block over 30 lines.
- Click `[ +N more lines ]` at the bottom of a folded code block to expand it, and `[ show less ]` to fold it back.

## Driving it with control-prism

Preconditions:

- `.pi/skills/verify/scripts/control-prism.mjs doctor --run-id "$RUN_ID"` exits `0`.

- **Render and unfold reply.** Run `.pi/skills/verify/scripts/control-prism.mjs drive --run-id "$RUN_ID" --feature reply-markdown --out "artifacts/verify/$RUN_ID"`. Exit code `0` and stdout contains `"ok":true`.
- **Proof.** Inspect `artifacts/verify/$RUN_ID/reply-folded.txt`, `artifacts/verify/$RUN_ID/reply-unfolded.txt`, and `artifacts/verify/$RUN_ID/reply-unfolded.json`. `reply-folded.txt` shows `┏━━━━━━━━━━━━━━━┓`, `╞═════════╪════════╡`, and `[ +15 more lines ]` without `const item35 = 35;`. `reply-unfolded.txt` shows `const item35 = 35;` and `[ show less ]`, and `reply-unfolded.json` reports `"hasHyperlink": true`.

## Gotchas

- Terminal hyperlinks require either a terminal that supports OSC-8 or `FORCE_HYPERLINK=1`.
- Launchers and scripts (such as `.sh`, `.command`, `.app`, `.js`, `.py`, `.exe`; the full list is `LAUNCHERS` in `extensions/prism/core/render.ts`) are intentionally styled in path color without a clickable `file://` link.
