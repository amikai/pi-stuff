# pele diagrams

When the text renderer cannot draw a closed top-level ` ```mermaid ` block, and the terminal shows images, prism draws the block with the bundled [pele](https://github.com/obsidianmd/pele) instead. The result is a PNG with `[ ⧉ source ] [ ⧉ image ] [ ⧉ preview ]` buttons. The render runs in a worker thread: the first frame shows the source under the note `drawing with pele…`, and the picture replaces it when pele finishes, with no keypress.

## Sub-features

- `pele-picture` draws a diagram kind the text renderer lacks (a `timeline`) as a kitty image.
- `pele-too-wide` draws a flowchart whose text art is wider than the terminal as a picture, hyphenated ids included, and goes back to box art once the terminal is wide enough.
- `pele-rejected` keeps today's note for a header word pele does not know (`notADiagram diagrams draw as source for now`).
- `pele-off` leaves main's notes and starts no job when the terminal shows no images.
- `pele-kinds` draws a minimal body for each kind word the model hint names and asserts that each ends as a picture.
- `pele-demo` renders `/prism checkhealth` and asserts that each of its 14 pele kind samples ends as a kitty image, not a note.
- `pele-setting` leaves main's notes and starts no job when `prism.json` sets `"pele": false`, or when `SSH_CONNECTION` or `SSH_TTY` is set, because pele is off over SSH like prism's image and preview copy. `test/prism.test.ts` test 39 covers both.

## How to get to it (user POV)

- Put a mermaid block that text art cannot draw in an assistant reply: a kind outside the supported set, a source over 80 lines, or a diagram wider than the terminal.
- Nothing has to be installed: pele and resvg ship in `extensions/prism/core/vendor/pele.js`.
- While pele draws the note reads `drawing with pele…`. When pele cannot draw the block, for any reason (timeout, its own parse error, a picture over 3 MiB, a source over 100000 characters), the block shows exactly what it showed before pele existed: main's note and the plain code block, with no mention of pele.
- pele never runs over SSH. The `[ ⧉ image ]` and `[ ⧉ preview ]` buttons appear only on macOS. Elsewhere the picture has `[ ⧉ source ]` alone.
- Fences still open while a reply streams, blocks inside lists, quotes or alerts, and the markdown transformer path never start pele.

## Driving it with control-prism

Preconditions:

- `.pi/skills/verify/scripts/control-prism.mjs doctor --run-id "$RUN_ID"` exits `0`.
- `SSH_CONNECTION` and `SSH_TTY` are unset. The drive fails with a clear message over SSH, where prism turns pele off.

- **Draw, refuse and fall back.** Run `.pi/skills/verify/scripts/control-prism.mjs drive --run-id "$RUN_ID" --feature pele --out "artifacts/verify/$RUN_ID"`. Exit code `0` and stdout contains `"ok":true`.
- **What it asserts, in order.** One reply holds a timeline, `notADiagram`, a 4-child fan-out and the same fan-out with hyphenated ids. At 80 columns the first frame shows `drawing with pele…` four times. After `peleJobs.idle()` there are three kitty images (`ESC _ G`), the timeline and both fan-outs, and on macOS each has `[ ⧉ source ] [ ⧉ image ] [ ⧉ preview ]`. `notADiagram diagrams draw as source for now` stays with no `(pele` suffix anywhere. At 140 columns both fan-outs are box art. With `images: null` the notes are main's and nothing is pending.
- **Kinds the hint names.** Before the pictures, the drive draws a minimal body for each word in `PELE_KINDS` through `pelePicture` and asserts it ends as a picture. It also fails when `PELE_KINDS` and its table of bodies differ.
- **Demo samples.** After the text checks, the drive runs `/prism checkhealth` through the real `prism-output` renderer at 104 columns, waits for `peleJobs.idle()`, and asserts that the demo holds one sample per `PELE_KINDS` word, that each is cached as a drawn picture with no note, and that the frame has at least that many kitty images.
- **Proof.** `artifacts/verify/$RUN_ID/pele-demo.ansi` has the demo with its pictures, `artifacts/verify/$RUN_ID/pele-pending.txt` has the four pending notes, `pele-images.ansi` has the kitty images, `pele-wide.txt` has the box art and `pele-text.txt` has main's notes. `pele-timeline.png` is the timeline picture decoded from the job cache. Open it to check the pixels: colored period boxes with rounded corners, not black boxes.

## Gotchas

- tmux cannot show kitty images, so pele never runs in a tmux pane. The drive renders the real `AssistantMessageComponent` under a forced `setCapabilities({ images: "kitty" })`. The redraw after the job settles is the shared `core/background.ts`, which `test/prism.test.ts` test 9 covers for PlantUML.
- The picture is pele's light palette on an opaque white background in every pi theme, drawn at 2x and reported at half its pixels. The longest side is capped at 4096 pixels.
- resvg reads no CSS custom properties, and pele colors everything through `var()`. `core/vendor/pele/svg.js` writes each `var()` as its value before resvg draws, and declines when one has no value. A black-box picture means that step was skipped.
- pele throws on an unknown header word, an empty source and a broken body, and prism declines on any error.
- Text is drawn with the fonts in `extensions/prism/core/vendor/pele/fonts/`, not the system's, so a picture looks the same on every machine. Chinese labels are drawn with Noto Sans TC, which the worker loads only for a picture whose text needs it. Korean, Thai, Devanagari and emoji draw as empty boxes.
- A render has 5 s, one runs at a time, and a PNG over 3 MiB is declined. Results, declines included, are cached for the session.
- The 4-child fan-out is 81 columns of box art, so it needs 80 columns or fewer to give up and 100 or more to fit. A reply draws its blocks 4 columns narrower than its render width, so the drive renders at 84 and 144.
- `test/prism.test.ts` tests 28 to 45 cover the same paths against the real bundle, and test 69 covers `svg.js`.
