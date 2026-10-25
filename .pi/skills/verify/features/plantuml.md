# PlantUML diagrams

PlantUML draws fenced blocks tagged `plantuml`, `puml`, or `uml`, untagged fences whose first line starts with `@start...`, and unfenced `@start...` to `@end...` blocks at the top level of a reply. The local `plantuml` command renders them in the background: as a PNG on terminals that show images, and as Unicode box art for sequence diagrams elsewhere. The first frame shows the source, and the drawing replaces it when the command finishes, with no keypress.

## Sub-features

- `plantuml-text-art` draws tagged, untagged, and unfenced sequence diagrams as box art in text mode. A class diagram is refused with a note, and nothing is spawned for it.
- `plantuml-blocked-include` runs the command under the `SANDBOX` profile. A blocked `!include` shows PlantUML's reason, `plantuml error (line N): cannot include <path>`, and draws nothing from the file.
- `plantuml-png` draws the PNG through the kitty image protocol and caches it as an image.
- `plantuml-async-redraw` shows the source first and replaces it with the art in a live TUI, with no keypress.
- `plantuml-overlay-close` keeps that redraw working after `/prism setup` is closed with Escape.

## How to get to it (user POV)

- Put a PlantUML diagram in an assistant reply, or run `/prism demo`, which includes a sample sequence diagram.
- Rendering needs the `plantuml` command on `PATH`. Set `plantumlServer` in `prism.json` to use a server when the command is missing, fails, or times out after 5 s. Set `"plantuml": false` to show these blocks as ordinary code.
- Notes a user can see in place of a drawing:
  - `plantuml CLI is not installed`
  - `plantuml CLI failed`
  - `plantuml error (line N): <message>`
  - `plantuml non-sequence diagrams require an image-capable terminal`
  - `diagram is N cols, terminal is M`
- Blocks inside lists, quotes, or alerts, and fences still open while a reply streams, stay as source.

## Driving it with control-prism

Preconditions:

- `.pi/skills/verify/scripts/control-prism.mjs doctor --run-id "$RUN_ID"` exits `0`.
- `which plantuml` prints a path. `plantuml-live` also needs `which tmux`. Each drive fails with a clear message when one is missing.

- **Render text, blocked include, and PNG.** Run `.pi/skills/verify/scripts/control-prism.mjs drive --run-id "$RUN_ID" --feature plantuml --out "artifacts/verify/$RUN_ID"`. Exit code `0` and stdout contains `"ok":true`.
- **Proof.** `artifacts/verify/$RUN_ID/plantuml-text.txt` contains `│Alice│`, `│A│`, `│Carol│`, the note `plantuml non-sequence diagrams require an image-capable terminal`, and `plantuml error (line 2): cannot include`. It does not contain `LOCALFILE`. `artifacts/verify/$RUN_ID/plantuml-png.ansi` contains the kitty escape `ESC _ G`.
- **Live redraw and overlay close.** Run `.pi/skills/verify/scripts/control-prism.mjs drive --run-id "$RUN_ID" --feature plantuml-live --out "artifacts/verify/$RUN_ID"`. It starts `test/prism.sh` in a tmux server on its own socket, `prism-verify-$RUN_ID`, sends `/prism demo`, and sends no other keys. The `overlay-close` case first opens `/prism setup` and closes it with Escape. Exit code `0` and stdout contains `"ok":true` with `sourceAtMs` and `artAtMs` for each case.
- **Live proof.** `plantuml-live-redraw-source.txt` contains `You -> prism : markdown`. `plantuml-live-redraw-art.txt` contains the `┌───┐` and `┌─────┐` boxes for `You` and `prism`. The same pair exists for `overlay-close`. The art JSON reports `"keysAfterDemo": 0`.

## Gotchas

- Each `plantuml-live` case starts a fresh Pi, because a second `/prism demo` in one session hits the PlantUML cache and draws the art at once.
- `plantuml-live` sets `TMPDIR` to the run directory, so the `prism-test.*` directory that `test/prism.sh` creates is removed by `cleanup`. Running `test/prism.sh` by hand leaves one under the real `$TMPDIR` per run.
- PlantUML 1.2026.9 is lenient. A half-written arrow such as `Bob ->` still renders. A bad directive or a blocked include gives `ERROR`.
- The art arrived 0.9 to 1.5 s after `/prism demo` in the runs so far. The drive allows 15 s, and the CLI times out at 5 s.
- tmux cannot show kitty images, so the PNG check reads the protocol escape and the cache entry. `-darkmode` is passed only in dark themes, and `test/prism.test.ts` test 9 checks the argument.
- When the CLI reports `ERROR`, `plantumlServer` is never contacted. `test/prism.test.ts` test 14 covers that with a fake server.
