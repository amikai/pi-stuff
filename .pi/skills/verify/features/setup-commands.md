# Setup overlay and commands

Setup overlay and commands let the user preview and save the 6 essential `prism` style options via `/prism setup`, the 12 table layout and table mode options via `/prism setup more` (or `/prism <option> <value>`), render `✻ prism rendering for ...` turn footers, and view display-only `/prism` help/demo output without sending messages into the LLM context.

## Sub-features

- `setup-overlay` opens the 6-step essential style picker (`Tables` through `Pie charts`), or the 12-step `More styles` picker via `/prism setup more` (`tableLayout` plus the 11 table modes), saves picks to `prism.json` without legacy keys, and closes on `Escape` or after the pick on the last step of the current tier.
- `setup-text` walks the same steps in the transcript with `/prism setup <step> [pick]` (accepting either step name like `table-layout` or option key like `tableLayout`), and `/prism <option> <value>` sets an option directly.
- `turn-duration` renders `✻ prism rendering for ...` at the end of a turn that took at least 1 s.
- `command-context-isolation` appends `/prism` output via `pi.appendEntry` (`type: "custom"`) and filters legacy `prism-output` messages in `context` events so command output never reaches the LLM.

## How to get to it (user POV)

- Run `/prism setup` (or `/prism setup more`) in TUI mode, use `Up`/`Down` or `Tab` to preview options, press `Enter` to save and advance, and `Escape` to close.
- Run `/prism` or `/prism checkhealth` to view help or showcase output in the transcript.

## Driving it with control-prism

Preconditions:

- `.pi/skills/verify/scripts/control-prism.mjs doctor --run-id "$RUN_ID"` exits `0`.

- **Drive setup overlay and help command.** Run `.pi/skills/verify/scripts/control-prism.mjs drive --run-id "$RUN_ID" --feature setup-commands --out "artifacts/verify/$RUN_ID"`. Exit code `0` and stdout contains `"ok":true`.
- **Proof.** Inspect `artifacts/verify/$RUN_ID/setup-step1.txt`, `artifacts/verify/$RUN_ID/setup-step2.txt`, and `artifacts/verify/$RUN_ID/help-entry.json`. `setup-step1.txt` shows `Setup 1/6: Tables`, `setup-step2.txt` shows `Setup 2/6: Tasks`, and `help-entry.json` shows `"sentCustomMessagesCount": 0`, `"appendedEntryType": "prism-output"`, and `"turnPlain": "✻ prism rendering for 2m 5s"`.

## Gotchas

- Never use `pi.sendMessage` for command output; `CustomMessageEntry` participates in LLM context and steers active turns.
- Closing the overlay also clears its TUI handle, so later redraws go to the screen TUI. The `setup-commands` drive cannot observe this. `test/prism.test.ts` test 17 covers it with a PlantUML render.
- The drive renders a synthetic turn entry (125000 ms, shown as `2m 5s`). It does not fire `agent_end`, so the 1 s threshold is not exercised.
