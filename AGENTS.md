# Agent Notes

## Extensions

Pi extensions live in `./extensions`: a single `.ts` file, or a folder with an `index.ts` entry point and a `README.md` that documents it. `package.json` loads every `extensions/*.ts` and `extensions/*/index.ts`, so anything placed there runs in every pi session. Other files in an extension folder are not loaded unless `index.ts` imports them.

Test-only code lives in `./test` and is never listed in the `pi` manifest. `test/faux-provider.ts` registers a scripted model provider; loading it outside a test session would replace real model output.

## Testing you-should-know

Run `npm test` for the automated test suite (`test/you-should-know.test.ts`), or `test/you-should-know.sh` to drive the extension in a real pi TUI against the faux provider. Both use their own temp agent dir, so the personal store, log and sessions under `~/.pi/agent` are never touched. See `extensions/you-should-know/README.md` for what to check.
