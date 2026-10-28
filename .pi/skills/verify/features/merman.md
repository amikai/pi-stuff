# merman diagrams

When the text renderer cannot draw a closed top-level ` ```mermaid ` block, and the terminal shows images, and `merman-cli` is on `PATH`, prism draws the block with merman instead. The result is a PNG with `[ ⧉ source ] [ ⧉ image ] [ ⧉ preview ]` buttons. The render runs in the background: the first frame shows the source under the note `drawing with merman…`, and the picture replaces it when merman finishes, with no keypress.

## Sub-features

- `merman-picture` draws a diagram kind the text renderer lacks (a `timeline`) as a kitty image.
- `merman-too-wide` draws a flowchart whose text art is wider than the terminal as a picture, hyphenated ids included, and goes back to box art once the terminal is wide enough.
- `merman-rejected` keeps today's note for a header word merman does not know (`notADiagram diagrams draw as source for now`).
- `merman-off` leaves main's notes and starts no job when the terminal shows no images.
- `merman-kinds` runs real `merman-cli` on a minimal body for each kind word the model hint names and asserts that each exits 0.
- `merman-demo` renders `/prism demo` and asserts that each of its 14 merman kind samples ends as a kitty image, not a note.
- `merman-setting` leaves main's notes and starts no job when `prism.json` sets `"merman": false`, or when `SSH_CONNECTION` or `SSH_TTY` is set, because merman is off over SSH like prism's image and preview copy. `test/prism.test.ts` test 39 covers both.

## How to get to it (user POV)

- Put a mermaid block that text art cannot draw in an assistant reply: a kind outside the supported set, a source over 80 lines, or a diagram wider than the terminal.
- Rendering needs the `merman-cli` command on `PATH` (`brew install merman-cli`), found once per pi session, so restart pi after installing it. Without it every note reads as on main and no `drawing with merman…` note appears.
- While merman draws the note reads `drawing with merman…`. When merman cannot draw the block, for any reason (timeout, a non-zero exit from its own parse error, a picture over 3 MiB, a source over 100000 characters), the block shows exactly what it showed before merman existed: main's note and the plain code block, with no mention of merman.
- merman never runs over SSH. The `[ ⧉ image ]` and `[ ⧉ preview ]` buttons appear only on macOS. Elsewhere the picture has `[ ⧉ source ]` alone.
- Fences still open while a reply streams, blocks inside lists, quotes or alerts, and the markdown transformer path never start merman.

## Driving it with control-prism

Preconditions:

- `.pi/skills/verify/scripts/control-prism.mjs doctor --run-id "$RUN_ID"` exits `0`.
- `which merman-cli` prints a path. The drive fails with a clear message when it does not.
- `SSH_CONNECTION` and `SSH_TTY` are unset. The drive fails with a clear message over SSH, where prism turns merman off.

- **Draw, refuse and fall back.** Run `.pi/skills/verify/scripts/control-prism.mjs drive --run-id "$RUN_ID" --feature merman --out "artifacts/verify/$RUN_ID"`. Exit code `0` and stdout contains `"ok":true`.
- **What it asserts, in order.** One reply holds a timeline, `notADiagram`, a 4-child fan-out and the same fan-out with hyphenated ids. At 80 columns the first frame shows `drawing with merman…` four times. After `mermanJobs.idle()` there are three kitty images (`ESC _ G`), the timeline and both fan-outs, and on macOS each has `[ ⧉ source ] [ ⧉ image ] [ ⧉ preview ]`. `notADiagram diagrams draw as source for now` stays with no `(merman` suffix anywhere. At 140 columns both fan-outs are box art. With `images: null` the notes are main's and nothing is pending.
- **Kinds the hint names.** Before the pictures, the drive runs `merman-cli` on a minimal body for each word in `MERMAN_KINDS` and asserts it exits 0. It also fails when `MERMAN_KINDS` and its table of bodies differ.
- **Demo samples.** After the text checks, the drive runs `/prism demo` through the real `prism-output` renderer at 104 columns, waits for `mermanJobs.idle()`, and asserts that the demo holds one sample per `MERMAN_KINDS` word, that each is cached as a drawn picture with no note, and that the frame has at least that many kitty images.
- **Proof.** `artifacts/verify/$RUN_ID/merman-demo.ansi` has the demo with its pictures, `artifacts/verify/$RUN_ID/merman-pending.txt` has the four pending notes, `merman-images.ansi` has the kitty images, `merman-wide.txt` has the box art and `merman-text.txt` has main's notes. `merman-timeline.png` is the timeline picture decoded from the job cache. Open it to check the pixels.

## Gotchas

- tmux cannot show kitty images, so merman never runs in a tmux pane. The drive renders the real `AssistantMessageComponent` under a forced `setCapabilities({ images: "kitty" })`. The redraw after the job settles is the shared `core/background.ts`, which `test/prism.test.ts` test 9 covers for PlantUML.
- The picture is merman's light theme on an opaque white background in every pi theme, drawn at 2x and reported at half its pixels.
- merman exits non-zero on an unknown header word, an empty source and a broken body, and prism declines on any non-zero exit.
- A render has 5 s, one runs at a time, and a PNG over 3 MiB is declined. Results, declines included, are cached for the session.
- The 4-child fan-out is 81 columns of box art, so it needs 80 columns or fewer to give up and 100 or more to fit. A reply draws its blocks 4 columns narrower than its render width, so the drive renders at 84 and 144.
- `test/prism.test.ts` tests 28 to 45 cover the same paths with `test/fake-merman.sh`. Tests 37, 42, 44 and 45 run real `merman-cli` and are skipped without it.
