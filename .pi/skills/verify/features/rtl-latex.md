# RTL and LaTeX math rendering

RTL and LaTeX math rendering draws right-to-left Hebrew/Arabic prose, tables, quotes, lists, and Mermaid diagrams in display order, and renders inline `$...$` and display `$$...$$` / ` ```math ` TeX formulas.

## Sub-features

- `rtl-layout` reorders and right-aligns Hebrew headings, paragraphs, blockquotes, lists, tables, and Mermaid diagrams while keeping embedded LTR code and numbers intact.
- `latex-unicode` converts inline `$x^2 + y^2 = z^2$` and display `$$...$$` TeX expressions into styled Unicode math. Display formulas become PNG images instead when `latex: true` and `ratex-render` + terminal image protocol are active; inline math stays Unicode.

## How to get to it (user POV)

- Run `/prism demo-rtl` or receive an assistant reply containing Hebrew/Arabic text or `$...$` / `$$...$$` math blocks.

## Driving it with control-prism

Preconditions:

- `.pi/skills/verify/scripts/control-prism.mjs doctor --run-id "$RUN_ID"` exits `0`.

- **Render RTL showcase and LaTeX math.** Run `.pi/skills/verify/scripts/control-prism.mjs drive --run-id "$RUN_ID" --feature rtl-latex --out "artifacts/verify/$RUN_ID"`. Exit code `0` and stdout contains `"ok":true`.
- **Proof.** Inspect `artifacts/verify/$RUN_ID/rtl-showcase.txt` and `artifacts/verify/$RUN_ID/latex-math.txt`. `rtl-showcase.txt` contains `עברית מימין לשמאל` and `us-east`, and `latex-math.txt` contains `x² + y² = z²` and `α + β = γ`.

## Gotchas

- Graphical PNG math rendering requires `latex: true` in `prism.json`, `ratex-render` on `PATH`, and a Kitty/Ghostty/iTerm2 image-capable terminal; otherwise formulas render via the built-in Unicode TeX converter.
- RTL reordering depends on the detected terminal (`rtl: "auto"`) or the `rtl` option. With no known terminal, prism leaves the text in logical order. The `rtl-latex` drive clears the terminal-detection variables before it starts, so its logical-order proof strings hold in any terminal. It proves the Hebrew text and math render, not the terminal-specific reordering.
- `/prism demo-rtl` shows Hebrew only. Arabic is detected the same way but has no showcase.
