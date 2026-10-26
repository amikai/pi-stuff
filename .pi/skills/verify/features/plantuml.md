# PlantUML diagrams

PlantUML draws fenced blocks tagged `plantuml`, `puml`, or `uml`, untagged fences whose first line starts with `@start...`, and unfenced `@start...` to `@end...` blocks at the top level of a reply. A PlantUML engine bundled with prism (`extensions/prism/core/vendor/plantuml.js`, in a worker thread) renders them in the background as PNG images on terminals that show images. Other terminals get a note. The first frame shows the source, and the drawing replaces it when the render finishes, with no keypress.

## Sub-features

- `plantuml-no-images` shows the note `plantuml diagrams require an image-capable terminal` for every block on a terminal without images, draws no text art, and starts no render.
- `plantuml-png` draws tagged, untagged, unfenced, and class diagrams as kitty images, and refuses a C4 diagram's `!include <C4/C4_Container>` like any other include.
- `plantuml-blocked-include` shows PlantUML's reason, `plantuml error (line N): cannot include <path>`, for `!include`, and reads nothing from the file.
- `plantuml-syntax-error` names the line of a syntax error, `plantuml error (line N): <message>`.

## How to get to it (user POV)

- Put a PlantUML diagram in an assistant reply, or run `/prism demo`, which includes a sample sequence diagram.
- Rendering needs no Java, `plantuml` command, or network. Set `"plantuml": false` in `prism.json` to show these blocks as ordinary code.
- Notes a user can see in place of a drawing:
  - `plantuml diagrams require an image-capable terminal`
  - `plantuml error (line N): <message>`
  - `plantuml render timed out` after 5 s
  - `plantuml worker failed`
  - `diagram image is too large`
- Blocks inside lists, quotes, or alerts, and fences still open while a reply streams, stay as source.

## Driving it with control-prism

Preconditions:

- `.pi/skills/verify/scripts/control-prism.mjs doctor --run-id "$RUN_ID"` exits `0`.

- **Render the note, images, blocked include, and syntax error.** Run `.pi/skills/verify/scripts/control-prism.mjs drive --run-id "$RUN_ID" --feature plantuml --out "artifacts/verify/$RUN_ID"`. Exit code `0` and stdout contains `"ok":true`.
- **Proof.** `artifacts/verify/$RUN_ID/plantuml-text.txt` contains the note seven times and does not contain `│Alice│`. `artifacts/verify/$RUN_ID/plantuml-png.ansi` contains the kitty escape `ESC _ G` for four images, and `plantuml-png.txt` contains `plantuml error (line 2): cannot include /etc/passwd`, `plantuml error (line 2): cannot include <C4/C4_Container>`, and `plantuml error (line 2): Syntax Error?`.

## Gotchas

- tmux cannot show kitty images, so there is no live TUI drive for PlantUML. The redraw when the render finishes, and the redraw after `/prism setup` is closed with Escape, are covered by `test/prism.test.ts` tests 9 and 17.
- The first render in a process takes about 0.3 s longer, for the worker to start. Later renders take 15 to 70 ms.
- PlantUML 1.2026.10 is lenient. A half-written arrow such as `Bob ->` still renders. A bad directive or a blocked include gives an error.
- Text in the images comes from system fonts. See "PlantUML" in `extensions/prism/README.md`.
