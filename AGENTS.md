# Agent Notes

## Extensions

Pi extensions live in `./extensions`, one `.ts` file per extension. `package.json` loads every `extensions/*.ts`, so anything placed there runs in every pi session.

Test-only code lives in `./test` and is never listed in the `pi` manifest. `test/faux-provider.ts` registers a scripted model provider; loading it outside a test session would replace real model output.

## Testing you-should-know

Run `test/you-should-know.sh` to drive the extension in a real pi TUI against the faux provider. It uses its own agent dir, so the personal store, log and sessions under `~/.pi/agent` are never touched. See `docs/you-should-know.md` for what to check.
