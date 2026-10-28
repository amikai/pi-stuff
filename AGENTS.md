# Agent Notes

## Extensions

Pi extensions live in `./extensions`: a single `.ts` file, or a folder with an `index.ts` entry point and a `README.md` that documents it. `package.json` loads every `extensions/*.ts` and `extensions/*/index.ts`, so anything placed there runs in every pi session. Other files in an extension folder are not loaded unless `index.ts` imports them. Helpers shared between extensions live in `extensions/lib/`, which is never loaded as an extension.

Test-only code lives in `./test` and is never listed in the `pi` manifest. `test/faux-provider.ts` registers a scripted model provider; loading it outside a test session would replace real model output.

## Testing

Run `npm test` for the automated test suites (`test/recap.test.ts`, `test/you-should-know.test.ts`, `test/prism.test.ts`, `test/prism-quicklook.test.ts`, `test/pi-built-in-render.test.ts`, and `test/uv.test.ts`). `test/prism-quicklook.test.ts` builds prism's Quick Look helper, injects `test/quicklook-probe.swift` into it, and opens real panels on the screen for about 25 seconds, one of them fullscreen. Leave the screen alone and open no other Quick Look panel meanwhile: a panel opened by another process empties the one under test. Set `QLF_SCREEN` to part of a screen's name, such as `QLF_SCREEN=Built-in`, to open every panel, the fullscreen one included, on that screen and keep the main one free. The suite skips off macOS, over SSH and without the Xcode command line tools, and skips its zoom checks when the terminal may not record the screen. Use `test/recap.sh`, `test/you-should-know.sh`, `test/prism.sh`, or `test/pi-built-in-render.sh` to drive each extension in a real pi TUI against the faux provider. Each uses its own temp agent dir, so the personal store, log and sessions under `~/.pi/agent` are never touched. See `extensions/recap/README.md`, `extensions/you-should-know/README.md`, `extensions/prism/README.md`, and `extensions/pi-built-in-render/README.md` for what to check.
