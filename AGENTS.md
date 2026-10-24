# Agent Notes

## Extensions

Pi extensions live in `./extensions`: a single `.ts` file, or a folder with an `index.ts` entry point and a `README.md` that documents it. `package.json` loads every `extensions/*.ts` and `extensions/*/index.ts`, so anything placed there runs in every pi session. Other files in an extension folder are not loaded unless `index.ts` imports them. Helpers shared between extensions live in `extensions/lib/`, which is never loaded as an extension.

Test-only code lives in `./test` and is never listed in the `pi` manifest. `test/faux-provider.ts` registers a scripted model provider; loading it outside a test session would replace real model output.

## Testing

Run `npm test` for the automated test suites (`test/recap.test.ts`, `test/you-should-know.test.ts`, `test/prismantis.test.ts`, and `test/uv.test.ts`). Use `test/recap.sh`, `test/you-should-know.sh`, or `test/prismantis.sh` to drive each extension in a real pi TUI against the faux provider. Each uses its own temp agent dir, so the personal store, log and sessions under `~/.pi/agent` are never touched. See `extensions/recap/README.md`, `extensions/you-should-know/README.md`, and `extensions/prismantis/README.md` for what to check.

To refresh the upstream prismantis core modules and generated pi themes from a local `../prismantis` checkout, run `npm run sync:prismantis`.
