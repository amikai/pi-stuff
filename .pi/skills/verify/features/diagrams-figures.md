# Diagrams and figures

Diagrams and figures draw ` ```mermaid ` blocks (flowcharts, sequence diagrams, `xychart-beta` bar/line charts, pie charts, and Gantt schedules) and ` ```figure ` blocks as colored terminal graphics. A mermaid block the text renderer cannot draw goes to `merman-cli` instead when the terminal shows images and it is on `PATH`, which the [merman feature](./merman.md) covers.

## Sub-features

- `mermaid-flowchart` draws node boxes and connectors in distinct palette hues.
- `mermaid-xychart` draws bar and multi-series line charts with legends.
- `mermaid-pie-gantt` draws round quadrant pie charts with percentage legends and Gantt schedules.
- `figure-block` colors `{role:text}` spans and aligns box borders.

## How to get to it (user POV)

- Receive an assistant reply or run `/prism demo` with fenced ` ```mermaid ` or ` ```figure ` blocks that fit within the terminal column width.

## Driving it with control-prism

Preconditions:

- `.pi/skills/verify/scripts/control-prism.mjs doctor --run-id "$RUN_ID"` exits `0`.

- **Render all diagram types.** Run `.pi/skills/verify/scripts/control-prism.mjs drive --run-id "$RUN_ID" --feature diagrams-figures --out "artifacts/verify/$RUN_ID"`. Exit code `0` and stdout contains `"ok":true`.
- **Proof.** Inspect `artifacts/verify/$RUN_ID/diagrams-figures.txt` and `artifacts/verify/$RUN_ID/diagrams-figures.ansi`. The plain text contains the rendered flowchart boxes (`Request`, `Parse`, `Render`), `Throughput` chart, `Share` pie (`70%`), `Sprint` Gantt schedule, and `┌─ pipeline ─┐` figure box.

## Gotchas

- A Mermaid diagram wider than the current terminal width stays as source code with a dim note `diagram is <N> cols, terminal is <M>` above the fence so lines do not wrap and corrupt the box art. With a terminal that shows images and `merman-cli` on `PATH`, the block is drawn as a picture instead. Every diagram in this drive fits, so it never starts merman.
- A Mermaid kind outside the supported set stays as source with the note `<kind> diagrams draw as source for now`, under the same rule.
- merman can replace either note with `drawing with merman…` while it runs. When it cannot draw the block, the note stays as main wrote it. See [merman diagrams](./merman.md).
