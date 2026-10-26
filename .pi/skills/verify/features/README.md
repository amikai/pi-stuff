# Prism verification map

This directory is the maintained source for verifying the user-facing rendering and interaction behavior of the `prism` Pi extension. Read this index before driving the extension, then follow the matching feature file.

## Baseline preconditions

- Initialize an isolated run directory with `.pi/skills/verify/scripts/control-prism.mjs launch --run-id "$RUN_ID"`.
- Run `.pi/skills/verify/scripts/control-prism.mjs doctor --run-id "$RUN_ID"` and require `"ok": true` and exit code `0`.
- Never drive against `~/.pi/agent`; every run uses `$TMPDIR/prism-verify-$RUN_ID` (Node's `os.tmpdir()`, under `/var/folders` on macOS).

## Driving conventions

- Start every recipe from the baseline state unless its preconditions specify initial `prism.json` options via `--config`.
- Treat every command as literal.
- Write proof artifacts to `artifacts/verify/$RUN_ID` and keep them after `cleanup`.

## Proof and skip reporting

- Capture both `.ansi` (exact terminal escape sequences) and `.txt` (plain text layout) alongside `.json` side-effect metadata.
- For interactive folding or setup navigation, capture both the initial state and the post-interaction state.
- Record the feature ID and state name with every artifact.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses four H2 sections in this order:

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with control-prism`
4. `Gotchas`

## Features

- [Reply Markdown rendering](./reply-markdown.md) covers headings, tables, `<br>` cell breaks, GitHub alerts, task lists, footnotes, path hyperlinks, and clickable code-block folding.
- [Diagrams and figures](./diagrams-figures.md) covers Mermaid flowcharts, `xychart-beta`, pie charts, Gantt charts, and ` ```figure ` alignment and role coloring.
- [RTL and LaTeX math rendering](./rtl-latex.md) covers Hebrew right-to-left prose, tables, and diagrams plus inline and display TeX math rendering.
- [Setup overlay and commands](./setup-commands.md) covers `/prism setup` 7-step style navigation, `prism.json` persistence, `✻ prismantis rendering for ...` turn duration, and `/prism` display-only custom entries that never leak into LLM context.
- [Pi theme synchronization](./theme-sync.md) covers deriving `prism`'s 20 color slots from Pi's active theme and dynamically repainting when Pi switches between `dark` and `light`.
- [PlantUML diagrams](./plantuml.md) covers tagged, untagged, and unfenced PlantUML blocks drawn as PNG images or, without image support, a note, plus the blocked include and syntax error notes.
- [mmdr diagrams](./mmdr.md) covers mermaid blocks the text renderer gives up on, drawn by `mmdr` as kitty images with source, image and preview buttons: the pending note, a kind text art lacks, a diagram too wide at 80 columns that is box art at 140, the headers and syntax `mmdr` misreads keeping their notes, and a terminal without images starting nothing.
- [Quick Look preview](./quicklook-preview.md) covers the macOS panel behind `[ ⧉ preview ]`: its title bar at every width, Preview's three zoom buttons and what they do to the scale, a fullscreen round trip, and every way of closing it ending the helper. It opens real panels on the screen and leaves `.png` screenshots and `.json` reports instead of `.ansi` and `.txt`.
