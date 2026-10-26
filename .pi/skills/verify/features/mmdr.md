# mmdr diagrams

When the text renderer cannot draw a closed top-level ` ```mermaid ` block, and the terminal shows images, and `mmdr` is on `PATH`, prism draws the block with `mmdr` instead. The result is a PNG with `[ ⧉ source ] [ ⧉ image ] [ ⧉ preview ]` buttons. The render runs in the background: the first frame shows the source under the note `drawing with mmdr…`, and the picture replaces it when `mmdr` finishes, with no keypress.

## Sub-features

- `mmdr-picture` draws a diagram kind the text renderer lacks (a `timeline`) as a kitty image.
- `mmdr-too-wide` draws a flowchart whose text art is wider than the terminal as a picture, and goes back to box art once the terminal is wide enough.
- `mmdr-misread` keeps today's note for a header word `mmdr` reads as a flowchart (`notADiagram diagrams draw as source for now`).
- `mmdr-misread` keeps today's note and code block when `mmdr` split a source into nodes the source does not hold, as for the hyphenated ids of `api-gateway --> auth-service`.
- `mmdr-off` leaves main's notes and starts no job when the terminal shows no images.
- `mmdr-kinds` runs real `mmdr --dumpLayout` on a minimal body for each kind word the model hint names and asserts that none reports a flowchart.
- `mmdr-demo` renders `/prism demo` and asserts that each of its 14 `mmdr` kind samples ends as a kitty image, not a note.
- `mmdr-setting` leaves main's notes and starts no job when `prism.json` sets `"mmdr": false`, or when `SSH_CONNECTION` or `SSH_TTY` is set, because `mmdr` is off over SSH like prism's image and preview copy. `test/prism.test.ts` test 39 covers both.

## How to get to it (user POV)

- Put a mermaid block that text art cannot draw in an assistant reply: a kind outside the supported set, a source over 80 lines, or a diagram wider than the terminal.
- Rendering needs the `mmdr` command on `PATH`, found once per pi session, so restart pi after installing it. Without it every note reads as on main and no `drawing with mmdr…` note appears.
- While `mmdr` draws the note reads `drawing with mmdr…`. When `mmdr` cannot draw the block, for any reason (timeout, a non-zero exit, a layout the check refuses, a picture over 3 MiB, a source over 100000 characters), the block shows exactly what it showed before `mmdr` existed: main's note and the plain code block, with no mention of `mmdr`.
- `mmdr` never runs over SSH. The `[ ⧉ image ]` and `[ ⧉ preview ]` buttons appear only on macOS. Elsewhere the picture has `[ ⧉ source ]` alone.
- Fences still open while a reply streams, blocks inside lists, quotes or alerts, and the markdown transformer path never start `mmdr`.

## Driving it with control-prism

Preconditions:

- `.pi/skills/verify/scripts/control-prism.mjs doctor --run-id "$RUN_ID"` exits `0`.
- `which mmdr` prints a path. The drive fails with a clear message when it does not.
- `SSH_CONNECTION` and `SSH_TTY` are unset. The drive fails with a clear message over SSH, where prism turns `mmdr` off.

- **Draw, refuse and fall back.** Run `.pi/skills/verify/scripts/control-prism.mjs drive --run-id "$RUN_ID" --feature mmdr --out "artifacts/verify/$RUN_ID"`. Exit code `0` and stdout contains `"ok":true`.
- **What it asserts, in order.** One reply holds a timeline, `notADiagram`, a 4-child fan-out and the same fan-out with hyphenated ids. At 80 columns the first frame shows `drawing with mmdr…` four times. After `mmdrJobs.idle()` there are two kitty images (`ESC _ G`), the timeline and the fan-out, and on macOS each has `[ ⧉ source ] [ ⧉ image ] [ ⧉ preview ]`. `notADiagram diagrams draw as source for now` stays, and the hyphenated fan-out keeps `diagram is 81 cols, terminal is 80` with its code block and no `(mmdr` suffix anywhere. At 140 columns both fan-outs are box art. With `images: null` the notes are main's and nothing is pending.
- **Kinds the hint names.** Before the pictures, the drive runs `mmdr` on a minimal body for each word in `MMDR_KINDS` and asserts the reported kind is not a flowchart. It also fails when `MMDR_KINDS` and its table of bodies differ.
- **Demo samples.** After the text checks, the drive runs `/prism demo` through the real `prism-output` renderer at 104 columns, waits for `mmdrJobs.idle()`, and asserts that the demo holds one sample per `MMDR_KINDS` word, that each is cached as a drawn picture with no note, and that the frame has at least that many kitty images.
- **Proof.** `artifacts/verify/$RUN_ID/mmdr-demo.ansi` has the demo with its pictures, `artifacts/verify/$RUN_ID/mmdr-pending.txt` has the four pending notes, `mmdr-images.ansi` has the kitty images, `mmdr-wide.txt` has the box art and `mmdr-text.txt` has main's notes. `mmdr-timeline.png` is the timeline picture decoded from the job cache. Open it to check the pixels.

## Gotchas

- tmux cannot show kitty images, so `mmdr` never runs in `plantuml-live`'s tmux pane. The drive instead renders the real `AssistantMessageComponent` under a forced `setCapabilities({ images: "kitty" })`. The redraw after the job settles is the shared `core/background.ts`, which `plantuml-live` proves in tmux.
- The picture is mmdr's light theme on an opaque white background in every pi theme.
- `mmdr` exits 0 for almost any input, so prism reads its `--dumpLayout` file to decline a misread header, an empty body, ids that hold syntax and, in a flowchart, ids that are not tokens of the source. A broken body inside a kind `mmdr` detects correctly, such as an empty timeline card or a mindmap node labelled `-->`, still draws.
- A render has 5 s, one runs at a time, and a PNG over 3 MiB is declined. Results, declines included, are cached for the session.
- The 4-child fan-out is 81 columns of box art, so it needs 80 columns or fewer to give up and 100 or more to fit. A reply draws its blocks 4 columns narrower than its render width, so the drive renders at 84 and 144.
- `test/prism.test.ts` tests 28 to 42 cover the same paths with `test/fake-mmdr.sh`. Test 37 runs real `mmdr` and is skipped without it.
