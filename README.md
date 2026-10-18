# pi stuff

amikai's [pi coding agent](https://buildwithpi.ai/) package. The layout follows [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff): the `pi` manifest in [`package.json`](package.json) exports every `.ts` file under [`extensions`](extensions).

## Install

```sh
pi install ~/Workspace/pi-stuff
```

A local-path package is loaded straight from this directory, not copied, so edits take effect on the next pi start (or `/reload`).

## Extensions

- [`you-should-know.ts`](extensions/you-should-know.ts) - Port of Claude Code's `cc-plugin-you-should-know`: every 6 steps a side agent reads the session and, when there is something you should know but might miss, flags it above the prompt. Rules, how to trigger it, and testing are in [`docs/you-should-know.md`](docs/you-should-know.md).

## Tests

[`test`](test) holds a faux model provider and a launcher script for testing. They are not in the `pi` manifest, so installing the package never loads them.
