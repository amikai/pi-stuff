# Pi theme synchronization

Pi theme synchronization derives `prism`'s 22 semantic color slots directly from Pi's active `ctx.ui.theme.colors` and repaints rendered components when Pi switches themes, without `prism` ever mutating Pi's global theme setting.

## Sub-features

- `theme-derive` maps Pi's `Theme.colors` tokens (`accent`, `mdHeading`, `mdCode`, `syntax*`, `toolDiff*`, etc.) into `prism`'s 22 color slots.
- `theme-live-repaint` invalidates `PrismComponent` caches when `theme.colors` changes reference so switching between `dark` and `light` in Pi repaints immediately.
- `theme-no-global-mutation` never calls `ctx.ui.setTheme`.

## How to get to it (user POV)

- Open `/settings` → `Theme` in Pi and switch between `system`, `dark`, and `light` (or let the terminal switch between dark and light appearance).

## Driving it with control-prism

Preconditions:

- `.pi/skills/verify/scripts/control-prism.mjs doctor --run-id "$RUN_ID"` exits `0`.

- **Switch Pi theme from dark to light.** Run `.pi/skills/verify/scripts/control-prism.mjs drive --run-id "$RUN_ID" --feature theme-sync --out "artifacts/verify/$RUN_ID"`. Exit code `0` and stdout contain `"ok": true`.
- **Proof.** Inspect `artifacts/verify/$RUN_ID/theme-dark.json`, `artifacts/verify/$RUN_ID/theme-light.json`, `artifacts/verify/$RUN_ID/theme-dark.ansi`, and `artifacts/verify/$RUN_ID/theme-light.ansi`. Both JSON files report `"setThemeCalls": 0` with distinct hex palettes for `dark` and `light`, and the `.ansi` files contain the updated RGB escape sequences.

## Gotchas

- Individual `*Color` fields in `prism.json` (such as `headingColor`) intentionally override the corresponding slot on top of Pi's active theme.
