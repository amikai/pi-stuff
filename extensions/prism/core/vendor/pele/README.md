# pele engine

[`../pele.js`](../pele.js) is a generated file: [pele](https://github.com/obsidianmd/pele), a Mermaid renderer written in JavaScript, bundled with [`@resvg/resvg-wasm`](https://github.com/yisibl/resvg-js) and the worker in this folder into one ES module. `core/pele.ts` runs it as a worker thread. Do not edit it by hand. Rebuild it with [`build.sh`](build.sh) from the files in this folder.

The first line of `pele.js` records the versions it was built from. [`package.json`](package.json) and [`package-lock.json`](package-lock.json) pin pele 1.13.0, `@resvg/resvg-wasm` 2.6.2 and esbuild 0.28.2, so two builds from the same files give the same bundle. pele is MIT licensed, with its notice in [`LICENSE.pele`](LICENSE.pele), which `build.sh` copies from the package. `@resvg/resvg-wasm` is MPL-2.0, with the text in [`LICENSE.resvg-wasm`](LICENSE.resvg-wasm), taken from [resvg-js v2.6.2](https://github.com/yisibl/resvg-js/tree/v2.6.2), where its source is. The npm package ships no license file, so that copy is kept by hand.

## Rebuild

You need Node and npm. Run this from the root of pi-stuff:

```sh
extensions/prism/core/vendor/pele/build.sh
```

The script installs the pinned packages into a temporary folder, bundles `worker.js` with esbuild, overwrites `../pele.js`, and prints its size and versions. Run `npm test` afterwards: tests 28 to 45 in `test/prism.test.ts` drive the real bundle. Rebuild after every change to `worker.js` or `svg.js`, since prism loads only the bundle.

To move to a newer pele, change its version in `package.json`, run `npm install --package-lock-only --ignore-scripts` in this folder, run `build.sh`, run `npm test`, and look at a few pictures from `/prism checkhealth`. pele releases often and draws in its own style, so a new version can change how every picture looks.

## What the worker does

[`worker.js`](worker.js) answers `{ id, source, theme }` messages with `{ id, png }` or `{ id, error }`:

1. pele turns the source into SVG, with a 100 000 character limit. Its default is 50 000. A parse error or an unknown header word becomes `error`, and prism keeps its note.
2. [`svg.js`](svg.js) writes every `var()` in the SVG's attributes as a plain value. pele colors everything through CSS custom properties, and resvg reads none, so without this step every shape draws black. A value comes from `theme`, then from the declarations on the root `<svg>`, then from the fallback in the `var()` itself. Each `var()` is matched to its own closing parenthesis, so a fallback that is itself a `var()` or a color function such as `rgb(255,0,0)` comes out whole. A `var()` with no value at all becomes `error`, so a diagram never draws as black boxes. Text between tags is left alone, and so are attributes that hold names or label text, such as `data-id`, where pele copies labels: a label that reads `var(--x)` stays a label. The same step moves `rx` and `ry` out of `style` attributes, because resvg reads corners only as attributes. As in CSS, the last declaration wins, and it replaces an `rx` or `ry` attribute already on the shape, so `style A rx:20` gives one `rx="20"`.
3. resvg draws the SVG at twice its size on white, smaller when the longest side would pass 4096 pixels. It loads Helvetica, Hiragino Sans GB, SF Hebrew and Geeza Pro on macOS, and Liberation Sans, DejaVu Sans and Noto Sans CJK on Linux. pele measures text with a Helvetica width table, so a metric-compatible font keeps labels inside their boxes.
4. The worker frees resvg's objects after each render. They live in wasm memory, which garbage collection never reaches.

Prism sends no `theme` yet, so every picture uses pele's light palette.
