# Setup overlay and commands

Setup overlay and commands let the user preview and save the 7 Prismantis style options via `/prismantis setup`, render `✻ prismantis rendering for ...` turn footers, and view display-only `/prismantis` help/demo output without sending messages into the LLM context.

## Sub-features

- `setup-overlay` opens the 7-step interactive style picker (`Tables` through `Pie charts`), saves picks to `prismantis.json` without legacy keys, and closes on `Escape`.
- `turn-duration` renders `✻ prismantis rendering for ...` at the end of a turn.
- `command-context-isolation` appends `/prismantis` output via `pi.appendEntry` (`type: "custom"`) and filters legacy `prismantis-output` messages in `context` events so command output never reaches the LLM.

## How to get to it (user POV)

- Run `/prismantis setup` in TUI mode, use `Up`/`Down` or `Tab` to preview options, press `Enter` to save and advance, and `Escape` to close.
- Run `/prismantis` or `/prismantis demo` to view help or showcase output in the transcript.

## Driving it with control-prismantis

Preconditions:

- `.pi/skills/verify/scripts/control-prismantis.mjs doctor --run-id "$RUN_ID"` exits `0`.

- **Drive setup overlay and help command.** Run `.pi/skills/verify/scripts/control-prismantis.mjs drive --run-id "$RUN_ID" --feature setup-commands --out "artifacts/verify/$RUN_ID"`. Exit code `0` and stdout contain `"ok": true`.
- **Proof.** Inspect `artifacts/verify/$RUN_ID/setup-step1.txt`, `artifacts/verify/$RUN_ID/setup-step2.txt`, and `artifacts/verify/$RUN_ID/help-entry.json`. `setup-step1.txt` shows `Setup 1/7: Tables`, `setup-step2.txt` shows `Setup 2/7: Tasks`, and `help-entry.json` shows `"sentCustomMessagesCount": 0`, `"appendedEntryType": "prismantis-output"`, and `"turnPlain": "✻ prismantis rendering for 2m 5s"`.

## Gotchas

- Never use `pi.sendMessage` for command output; `CustomMessageEntry` participates in LLM context and steers active turns.
