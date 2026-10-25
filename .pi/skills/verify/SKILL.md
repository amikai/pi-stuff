---
name: verify
description: Drive and verify the prismantis Pi TUI extension across assistant replies, Mermaid/figure diagrams, setup commands, and Pi theme synchronization in an isolated agent directory.
---

# Verify prismantis

This skill drives `extensions/prismantis/index.ts` inside the real Pi TUI component and extension runtime using an isolated `PI_CODING_AGENT_DIR` (`/tmp/prismantis-verify-$RUN_ID`) so `~/.pi/agent` is never touched. Read [`features/README.md`](features/README.md) before driving a feature.

## Launch

Initialize an isolated verification workspace for a unique `$RUN_ID`:

```bash
RUN_ID="run-$(date +%s)"
.pi/skills/verify/scripts/control-prismantis.mjs launch --run-id "$RUN_ID"
```

When ready, `launch` prints `{"status":"ready","runId":"...","runDir":"/tmp/prismantis-verify-..."}` and exits `0` after creating `work/`, `sessions/`, and `instance.json` inside `/tmp/prismantis-verify-$RUN_ID`.

## Doctor

Before driving any feature, run the read-only health check:

```bash
.pi/skills/verify/scripts/control-prismantis.mjs doctor --run-id "$RUN_ID"
```

Require exit code `0` and `"ok": true` in stdout (`instanceExists: true`, `extensionExists: true`, `rendererExists: true`).

## Drive

Run the harness against a mapped feature in [`features/`](features/):

```bash
.pi/skills/verify/scripts/control-prismantis.mjs drive --run-id "$RUN_ID" --feature reply-markdown --out "artifacts/verify/$RUN_ID"
.pi/skills/verify/scripts/control-prismantis.mjs drive --run-id "$RUN_ID" --feature diagrams-figures --out "artifacts/verify/$RUN_ID"
.pi/skills/verify/scripts/control-prismantis.mjs drive --run-id "$RUN_ID" --feature rtl-latex --out "artifacts/verify/$RUN_ID"
.pi/skills/verify/scripts/control-prismantis.mjs drive --run-id "$RUN_ID" --feature setup-commands --out "artifacts/verify/$RUN_ID"
.pi/skills/verify/scripts/control-prismantis.mjs drive --run-id "$RUN_ID" --feature theme-sync --out "artifacts/verify/$RUN_ID"
```

For manual interactive TUI inspection against the scripted faux provider in an isolated temp agent dir, run `test/prismantis.sh`.

## Evidence

Every `drive` command writes three proof files per captured state into `artifacts/verify/$RUN_ID/`:

- `<state>.ansi` — the exact ANSI-escaped terminal lines produced by `PrismantisComponent` / Pi TUI components.
- `<state>.txt` — the stripped plain-text terminal rendering for structural inspection (box borders, folded/unfolded lines, diagram glyphs).
- `<state>.json` — structured side-effect proof (`prismantis.json` contents, `setThemeCalls: 0`, `sentCustomMessagesCount: 0`, resolved theme palette, line counts).

Proof standards:

- Exercise the real `AssistantMessageComponent`, `UserMessageComponent`, `SetupPaneComponent`, and `/prismantis` command handlers registered by `extensions/prismantis/index.ts`.
- Capture both before and after states for interactive elements (folded vs. unfolded code blocks, setup step transitions, dark vs. light Pi theme switches).
- Verify side effects alongside rendered lines: `prismantis.json` writes only style keys (`theme`, `syncPiTheme`, and `toolRows` stay `undefined`), `ctx.ui.setTheme` is never called (`setThemeCalls: 0`), and `/prismantis` output uses `pi.appendEntry` (`sentCustomMessagesCount: 0`).

## Cleanup

Remove the disposable `/tmp/prismantis-verify-$RUN_ID` directory while preserving `artifacts/verify/$RUN_ID/`:

```bash
.pi/skills/verify/scripts/control-prismantis.mjs cleanup --run-id "$RUN_ID"
```

Always confirm that `artifacts/verify/$RUN_ID/` still exists after `cleanup`.

## Helpers

- `.pi/skills/verify/scripts/control-prismantis.mjs` — executable Node harness supporting `launch`, `doctor`, `drive`, and `cleanup`.
