# PlantUML engine

[`../plantuml.js`](../plantuml.js) is a generated file: PlantUML compiled to JavaScript, bundled with everything it needs into one 8.4 MB ES module. `core/plantuml.ts` runs it as a worker thread. Do not edit it by hand. Rebuild it with [`build.sh`](build.sh) from the files in this folder.

The first line of `plantuml.js` records what it was built from. The current file comes from [PlantUML](https://github.com/plantuml/plantuml) commit `e6c3adc2be7a50daa5f04b2b0f9d24928aa08efa`, which reports `PlantUML version 1.2026.10beta1 / e6c3adc`.

## Rebuild

You need JDK 17 or later, Node, and a clone of PlantUML. Check out the commit to build, then run this from the root of pi-stuff:

```sh
extensions/prism/core/vendor/plantuml/build.sh <plantuml-checkout>
```

The script overwrites `../plantuml.js` and prints its size, the PlantUML version, and the commit. The Gradle step takes about 2.5 minutes. Run `npm test` afterwards: the PlantUML tests in `test/prism.test.ts` drive the real bundle.

To move to a newer PlantUML, check out the new commit in the clone, run `build.sh`, run `npm test`, and update the commit and version in this file. If a patch no longer applies, `build.sh` stops at `git apply`.

## What `build.sh` does

1. It makes a throwaway `git worktree` of the checkout's `HEAD`. The checkout itself is never modified, and uncommitted changes in it are ignored.
2. It applies every file in [`patches/`](patches) to that worktree.
3. It runs `./gradlew :plantuml-mcp-js:npmPackage -Pfast` there. TeaVM compiles the headless entry point of PlantUML's `plantuml-mcp-js` subproject, `net.sourceforge.plantuml.teavm.js.headless.PlantUMLHeadless`, into `engine.js`. `npmPackage` stamps the real version into the engine, where the plain `generateJavaScript` task leaves `$version$`. `-Pfast` builds only the GPL jar, which is the license this bundle carries.
4. It bundles these files with esbuild into `../plantuml.js`:
   - `engine.js`, the compiled engine.
   - [`worker.js`](worker.js), the worker source. It loads the engine and the system fonts, serves the bundled C4 library and its themes to the engine and declines every other file, paints the SVG's CSS background behind the picture because `resvg` ignores it, and answers `{ id, source }` messages with `{ id, png }` or `{ id, error, line }`.
   - PlantUML's `src/main/teavm/generated/themes.js`, for `!theme`.
   - PlantUML's `src/main/teavm/stdlib/c4.min.js`, the C4-PlantUML v2.14.0 library, as text.
   - `@viz-js/viz` 3.31.0, Graphviz compiled to WebAssembly, which lays out the diagrams.
   - `@resvg/resvg-wasm` 2.6.2, which turns the SVG into a PNG at twice its size.
5. It deletes the worktree.

[`package.json`](package.json) and [`package-lock.json`](package-lock.json) pin the npm packages and esbuild 0.28.2, so between two builds only the PlantUML commit and the patches change the result.

## Patches

[`patches/space-width.patch`](patches/space-width.patch) sets the width of U+0020 to 44 in `UnicodeFontWidthSansSerif`. The JavaScript engine measures text with that table instead of a real font, and upstream gives the space a width of 0, so wrapped words ran together. It is not reported upstream yet. See [issue #4](https://github.com/amikai/pi-stuff/issues/4). Test 50 in `test/prism.test.ts` fails if a build loses it.
