# Quick Look preview

On macOS, `[ ⧉ preview ]` under a PlantUML image opens the PNG in a Quick Look panel in front of the terminal. The panel comes from `extensions/prism/quicklook.swift`, a small helper app that prism compiles on first use. Its title bar shows the close and fullscreen buttons, the file name, a Liquid Glass pill with Preview's three zoom buttons (Zoom Out, Actual Size, Zoom In), and Quick Look's own Share and Open with Preview. Closing the panel ends the helper.

## Sub-features

- `quicklook-title-bar` keeps the file name, the zoom pill and Quick Look's buttons apart at every width a user can drag the panel to. The file name is cut with an ellipsis before the buttons. Quick Look switches Open with Preview to its short title, Preview, when space runs out. There is exactly one Open button.
- `quicklook-zoom-buttons` are Preview's `zoom_and_actual` toolbar item from `/System/Applications/Preview.app/Contents/Resources/CommonToolbar.proplist`: the same order, labels and tooltips. They send Cmd+-, Cmd+0 and Cmd+= to the panel.
- `quicklook-zoom` steps the scale up and down. Actual Size always shows one image pixel per point, on every press.
- `quicklook-fullscreen` leaves the title bar laid out as before after a trip through fullscreen.
- `quicklook-close` ends the helper process whichever way the panel closes: the close button, Esc, Space, or `panel.close()`.

## How to get to it (user POV)

- Run prism on macOS outside SSH, get a reply with a PlantUML diagram drawn as an image (or run `/prism demo` on an image-capable terminal), and press `[ ⧉ preview ]`.
- The first preview builds the helper with `swiftc -O` into `~/.pi/agent/prism/quicklook-<first 12 hex of the source's SHA-256>` in about 10 s. A changed source builds a new one. Without the Xcode command line tools prism falls back to `qlmanage -p`, whose panel opens behind the terminal and has no zoom pill.
- The installed package's copy of `quicklook.swift` is the one compiled (`~/.pi/agent/git/github.com/amikai/pi-stuff/...` for a git install), not the checkout. A pi session that already opened a preview keeps its helper until pi restarts.
- Keyboard: Cmd+- and Cmd+= zoom, Cmd+0 shows actual size, Cmd+9 fits the window. Esc and Space close the panel.

## Driving it with control-prism

Preconditions:

- `.pi/skills/verify/scripts/control-prism.mjs doctor --run-id "$RUN_ID"` exits `0`.
- macOS, not over SSH, with `/usr/bin/swiftc` and `/usr/bin/clang`.
- The terminal may record the screen (System Settings, Privacy & Security, Screen & System Audio Recording). Without it the zoom test skips and the drive fails. Accessibility permission is not needed.
- Nobody uses the screen for about 40 s, and no other Quick Look panel opens meanwhile, including prism's own preview and a second drive.

- **Drive.** Run `.pi/skills/verify/scripts/control-prism.mjs drive --run-id "$RUN_ID" --feature quicklook --out "artifacts/verify/$RUN_ID"`. It runs `test/prism-quicklook.test.ts` with `TMPDIR` set to the run directory and `QLF_EVIDENCE_DIR` set to `--out`. The test builds the helper with the same `swiftc -O` flags as `extensions/prism/desktop.ts`, injects `test/quicklook-probe.swift` with `DYLD_INSERT_LIBRARIES`, and opens real panels on the screen, one of them fullscreen for about 5 s. Exit code `0` and stdout contains `"ok":true`, `"pass":5`, `"fail":0` and `"skipped":0`.
- **Proof, title bar.** `quicklook-long-name-min-width.png` shows the long file name cut with `…`, then the zoom pill, Share and `Preview`, none touching. `quicklook-long-name-wide.png` shows `Open with Preview`. `quicklook-small-forced-narrow.png` is the narrowest frame Auto Layout allows, below what a drag reaches, and still has nothing overlapping. `quicklook-widths.json` and `quicklook-long-name.json` hold every title bar frame; the drag stops at the panel's `minSize` width (370 pt so far).
- **Proof, zoom.** The panel screenshots `quicklook-zoom-big-1-fit.png` through `quicklook-zoom-big-5-zoom-out.png` and `quicklook-zoom-small-*.png` show the 10 px red and blue stripes at each step. `quicklook-zoom-big.json` and `quicklook-zoom-small.json` hold the measured points per image pixel: `1` after both Actual Size presses, larger after Zoom In, smaller after Zoom Out.
- **Proof, zoom buttons.** `quicklook-zoom-buttons.json` lists the pill's labels and tooltips next to the frames.
- **Proof, fullscreen.** `quicklook-before-fullscreen.png` and `quicklook-after-fullscreen.png` show the same title bar.
- **Proof, close.** `quicklook-close.json` lists the four ways with `"status": 0`, `"signal": null` and how many milliseconds the helper took to exit (1 to 2 s so far). A helper still running after 10 s is killed and shows `"signal": "SIGTERM"`.
- **Log.** `quicklook-tests.txt` is the test runner's output, with the five `✔` lines.

## Gotchas

- A Quick Look panel opened by another process empties the one under test, which then shows "No items selected" and loses its title and Quick Look's buttons. The probe stops with `the panel lost its preview, most likely to another Quick Look panel opened meanwhile`. The same happens to a user who previews twice in a row; it is a known limit of the helper, present before the zoom pill, and not yet fixed. Switching to another app does not trigger it.
- Quick Look does not zoom out below the smaller of actual size and fit to window, while Preview does. The zoom steps are Quick Look's own: 1, 1.45, 1.95 for an image smaller than the window, and from fit 0.4, 0.5, 0.75, 1, 1.5 for an image larger than the screen.
- Quick Look adds Share and Open about 250 ms after the panel opens, after the helper has placed the pill. The probe waits for Share before its first step.
- Quick Look sets the title's ellipsis in the attributed string's paragraph style (`byTruncatingTail`); the field's own `lineBreakMode` stays `byWordWrapping`.
- Quick Look handles Esc and Space itself and never passes them to `previewPanel(_:handle:)`. Every close reaches the helper only through `NSWindow.willCloseNotification`, observed through a block token because `endPreviewPanelControl` clears the panel's delegate first.
- Before macOS 26 the pill has no Liquid Glass and is a bare stack view. That path cannot be driven on macOS 26 or later. It was checked by compiling the helper with the glass branch forced off; the drive's pill-width check catches a pill stretched past its buttons.
- The drive never touches `~/.pi/agent/prism`. The helper there is rebuilt only when prism previews with a changed source.
