# pele engine

[`../pele.js`](../pele.js) is a generated file: [pele](https://github.com/obsidianmd/pele), a Mermaid renderer written in JavaScript, bundled with [`@resvg/resvg-wasm`](https://github.com/thx/resvg-js) and the worker in this folder into one ES module. The fonts it draws with sit beside it in [`fonts/`](fonts). `core/pele.ts` runs it as a worker thread. Do not edit it by hand. Rebuild it with [`build.sh`](build.sh) from the files in this folder.

The first line of `pele.js` records the versions it was built from. [`package.json`](package.json) and [`package-lock.json`](package-lock.json) pin pele 1.13.0, `@resvg/resvg-wasm` 2.6.2, esbuild 0.28.2 and the three font packages, so two builds from the same files give the same bundle and the same fonts. pele is MIT licensed, with its notice in [`LICENSE.pele`](LICENSE.pele), which `build.sh` copies from the package. `@resvg/resvg-wasm` is MPL-2.0, with the text in [`LICENSE.resvg-wasm`](LICENSE.resvg-wasm), taken from [resvg-js v2.6.2](https://github.com/thx/resvg-js/tree/v2.6.2), where its source is. The npm package ships no license file, so that copy is kept by hand.

## Rebuild

You need Node and npm. Run this from the root of pi-stuff:

```sh
extensions/prism/core/vendor/pele/build.sh
```

The script installs the pinned packages into a temporary folder, copies the fonts `fonts.js` names and their licenses into `fonts/`, bundles `worker.js` with esbuild, overwrites `../pele.js`, and prints the sizes and versions. Run `npm test` afterwards: tests 28 to 45, 71 and 74 in `test/prism.test.ts` drive the real bundle. Rebuild after every change to `worker.js`, `svg.js` or `fonts.js`, since prism loads only the bundle.

To move to a newer pele, change its version in `package.json`, run `npm install --package-lock-only --ignore-scripts` in this folder, run `build.sh`, run `npm test`, and look at a few pictures from `/prism checkhealth`. pele releases often and draws in its own style, so a new version can change how every picture looks.

## What the worker does

[`worker.js`](worker.js) answers `{ id, source, theme }` messages with `{ id, png }` or `{ id, error }`:

1. pele turns the source into SVG, with a 100 000 character limit. Its default is 50 000. A parse error or an unknown header word becomes `error`, and prism keeps its note.
2. [`svg.js`](svg.js) writes every `var()` in the SVG's attributes as a plain value. pele colors everything through CSS custom properties, and resvg reads none, so without this step every shape draws black. A value comes from `theme`, then from the declarations on the root `<svg>`, then from the fallback in the `var()` itself. Each `var()` is matched to its own closing parenthesis, so a fallback that is itself a `var()` or a color function such as `rgb(255,0,0)` comes out whole. CSS strings and entities such as `&quot;` are skipped whole, so a font named `'var(--x'` stays a name, and `font-family:&quot;Fira Code&quot;` keeps its last `;`. A `var()` with no value at all becomes `error`, so a diagram never draws as black boxes. Text between tags is left alone, and so are attributes that hold names or label text, such as `data-id`, where pele copies labels: a label that reads `var(--x)` stays a label. The same step moves `rx` and `ry` out of `style` attributes, because resvg reads corners only as attributes. As in CSS, the last declaration wins, and it replaces an `rx` or `ry` attribute already on the shape, so `style A rx:20` gives one `rx="20"`. A corner in `%`, `em` and the other SVG length units keeps its unit.
3. resvg draws the SVG at twice its size on white, smaller when the longest side would pass 4096 pixels, with the fonts in `fonts/`, so every machine draws the same picture. resvg-wasm cannot read the disk, so `loadSystemFonts` and `fontDirs` do nothing, and the worker reads each font file itself, once. [`fonts.js`](fonts.js) picks the fonts for each picture from the text it draws:
   - Arimo, regular, bold and their italics, comes from `@expo-google-fonts/arimo`. resvg does not slant or embolden a face itself, so pele's italic labels, such as an abstract class member, need the italic files. pele measures text with a Helvetica width table, and Arimo has the same widths, so labels stay inside their boxes. It covers Latin, Greek, Cyrillic, Vietnamese and Hebrew.
   - Noto Sans Arabic comes from `@expo-google-fonts/noto-sans-arabic` and adds Arabic.
   - Noto Sans TC comes from `@expo-google-fonts/noto-sans-tc` and adds Chinese, Japanese kana, and the arrows, math signs and box lines Arimo lacks. It is 7 MB, and resvg copies every font it is given on every render, so a picture gets it only when its text has a character outside what Arimo and Noto Sans Arabic cover.
   - Korean, Thai, Devanagari and emoji are in none of them and draw as empty boxes.

   The fonts are SIL OFL 1.1, with each package's license in `fonts/OFL.*.txt`. They come from Expo's Google Fonts packages because those ship plain TTF files. Fontsource ships only WOFF and WOFF2, which resvg either cannot read or has to decompress on every render: 117 ms for a Chinese label against 6 ms.
4. The worker frees resvg's objects after each render. They live in wasm memory, which garbage collection never reaches.

Prism sends no `theme` yet, so every picture uses pele's light palette.
