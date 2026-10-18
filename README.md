# pi stuff

amikai's [pi coding agent](https://buildwithpi.ai/) package. The layout follows [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff): the `pi` manifest in [`package.json`](package.json) exports every extension under [`extensions`](extensions), either a single `.ts` file or a folder with an `index.ts` and its own `README.md`.

## Install

```sh
pi install git:github.com/amikai/pi-stuff
```

Pi clones the repo to `~/.pi/agent/git/github.com/amikai/pi-stuff` and loads it from there. To pick up pushed changes, run `pi update --extensions`.

## Extensions

- [`you-should-know`](extensions/you-should-know) - Port of Claude Code's `cc-plugin-you-should-know`: every 6 steps a side agent reads the session and, when there is something you should know but might miss, flags it above the prompt. Also retells the last turn in plain words (`/plain`) or the whole session when you lost track (`/lost`), after [cc-mod-waitwhat](https://github.com/GGGODLIN/cc-mod-waitwhat), in an overlay the main agent never sees. Rules, settings, how to trigger it, and testing are in its [README](extensions/you-should-know/README.md).

## Tests

[`test`](test) holds a faux model provider and a launcher script for testing. They are not in the `pi` manifest, so installing the package never loads them.
