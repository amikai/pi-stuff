---
name: verify
description: Drive and verify the prism Pi TUI extension across assistant replies, Mermaid/figure diagrams, merman pictures, RTL/LaTeX math, setup commands, Pi theme synchronization, and its macOS Quick Look preview panel in an isolated agent directory.
---

# Verify prism

This skill drives `extensions/prism/index.ts` inside the real Pi TUI component and extension runtime using an isolated `PI_CODING_AGENT_DIR` (`$TMPDIR/prism-verify-$RUN_ID`, from Node's `os.tmpdir()`, under `/var/folders` on macOS) so `~/.pi/agent` is never touched. Read [`features/README.md`](features/README.md) before driving a feature.

## Launch

Initialize an isolated verification workspace for a unique `$RUN_ID`:

```bash
RUN_ID="run-$(date +%s)"
.pi/skills/verify/scripts/control-prism.mjs launch --run-id "$RUN_ID"
```

When ready, `launch` prints `{"status":"ready","runId":"...","runDir":"<tmpdir>/prism-verify-..."}` and exits `0` after creating `work/`, `sessions/`, and `instance.json` inside `$TMPDIR/prism-verify-$RUN_ID`.

## Doctor

Before driving any feature, run the read-only health check:

```bash
.pi/skills/verify/scripts/control-prism.mjs doctor --run-id "$RUN_ID"
```

Require exit code `0` and `"ok": true` in stdout (`instanceExists: true`, `extensionExists: true`, `rendererExists: true`).

## Drive

Run the harness against a mapped feature in [`features/`](features/):

```bash
.pi/skills/verify/scripts/control-prism.mjs drive --run-id "$RUN_ID" --feature reply-markdown --out "artifacts/verify/$RUN_ID"
.pi/skills/verify/scripts/control-prism.mjs drive --run-id "$RUN_ID" --feature diagrams-figures --out "artifacts/verify/$RUN_ID"
.pi/skills/verify/scripts/control-prism.mjs drive --run-id "$RUN_ID" --feature rtl-latex --out "artifacts/verify/$RUN_ID"
.pi/skills/verify/scripts/control-prism.mjs drive --run-id "$RUN_ID" --feature setup-commands --out "artifacts/verify/$RUN_ID"
.pi/skills/verify/scripts/control-prism.mjs drive --run-id "$RUN_ID" --feature theme-sync --out "artifacts/verify/$RUN_ID"
.pi/skills/verify/scripts/control-prism.mjs drive --run-id "$RUN_ID" --feature plantuml --out "artifacts/verify/$RUN_ID"
.pi/skills/verify/scripts/control-prism.mjs drive --run-id "$RUN_ID" --feature plantuml-live --out "artifacts/verify/$RUN_ID"
.pi/skills/verify/scripts/control-prism.mjs drive --run-id "$RUN_ID" --feature merman --out "artifacts/verify/$RUN_ID"
.pi/skills/verify/scripts/control-prism.mjs drive --run-id "$RUN_ID" --feature quicklook --out "artifacts/verify/$RUN_ID"
```

For manual interactive TUI inspection against the scripted faux provider in an isolated temp agent dir, run `test/prism.sh`.

## Evidence

Every `drive` command except `quicklook` (see [`features/quicklook-preview.md`](features/quicklook-preview.md)) writes three proof files per captured state into `artifacts/verify/$RUN_ID/`:

- `<state>.ansi` — the exact ANSI-escaped terminal lines produced by `PrismComponent` and Pi TUI components.
- `<state>.txt` — the stripped plain-text terminal rendering for structural inspection (box borders, folded/unfolded lines, diagram glyphs).
- `<state>.json` — structured side-effect proof (`prism.json` contents, `setThemeCalls: 0`, `sentCustomMessagesCount: 0`, resolved theme palette, line counts).

Proof standards:

- Exercise the real `AssistantMessageComponent`, `UserMessageComponent`, `SetupPaneComponent`, and `/prism` command handlers registered by `extensions/prism/index.ts`.
- Capture both before and after states for interactive elements (folded vs. unfolded code blocks, setup step transitions, dark vs. light Pi theme switches).
- Verify side effects alongside rendered lines: `prism.json` writes only style keys (`theme`, `syncPiTheme`, and `toolRows` stay `undefined`), `ctx.ui.setTheme` is never called (`setThemeCalls: 0`), and `/prism` output uses `pi.appendEntry` (`sentCustomMessagesCount: 0`).

## Cleanup

Remove the disposable `$TMPDIR/prism-verify-$RUN_ID` directory while preserving `artifacts/verify/$RUN_ID/`:

```bash
.pi/skills/verify/scripts/control-prism.mjs cleanup --run-id "$RUN_ID"
```

Always confirm that `artifacts/verify/$RUN_ID/` still exists after `cleanup`.

## Helpers

- `.pi/skills/verify/scripts/control-prism.mjs` — executable Node harness supporting `launch`, `doctor`, `drive`, and `cleanup`.
- The `merman` feature needs `merman-cli` on `PATH`. It writes the decoded timeline picture as `merman-timeline.png` beside its `.ansi`, `.txt` and `.json` proof.
- The `quicklook` feature needs macOS outside SSH, the Xcode command line tools, and a terminal that may record the screen. It runs `test/prism-quicklook.test.ts`, which opens real Quick Look panels on the screen for about 40 s and drives them through `test/quicklook-probe.swift`, injected into the helper with `DYLD_INSERT_LIBRARIES`. Its proof is `.png` screenshots and `.json` reports, not `.ansi` and `.txt`.
