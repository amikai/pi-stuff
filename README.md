# pi stuff

amikai's [pi coding agent](https://buildwithpi.ai/) package. The layout follows [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff): the `pi` manifest in [`package.json`](package.json) exports every extension under [`extensions`](extensions), either a single `.ts` file or a folder with an `index.ts` and its own `README.md`.

## Install

```sh
pi install git:github.com/amikai/pi-stuff
```

Pi clones the repo to `~/.pi/agent/git/github.com/amikai/pi-stuff` and loads it from there. To pick up pushed changes, run `pi update --extensions`.

## Extensions

- [`btw.ts`](extensions/btw.ts) - `/btw` side-chat popover for quick tangential questions, with thread restore/reset and summary handoff into the main chat. Use `Shift+Left` and `Shift+Right`, or `Shift+Tab` and `Tab`, to browse past exchanges. Use `Up` and `Down` to scroll the selected answer. Adapted from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff/blob/a3f8ab1108a48fec9e175f6cd5d9aaa4694ce29d/extensions/btw.ts).
- [`files.ts`](extensions/files.ts) - `/files` browser with git status and session references, plus shortcuts to browse (`ctrl+shift+o`), reveal, diff, and Quick Look (`ctrl+shift+r`) referenced files, from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff/blob/13bc8f87970bec8830aab0f1c0487d35aa7c0917/extensions/files.ts).
- [`no-sleep.ts`](extensions/no-sleep.ts) - `/no-sleep` macOS `caffeinate` integration to prevent sleep while an agent or session is active, from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff/blob/ab0a07b6d3b0e3a2846c4ee3753dee4c683e7ec2/extensions/no-sleep.ts).
- [`view-image.ts`](extensions/view-image.ts) - `view_image` tool for reading image files as inline image attachments, from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff/blob/4fb0c7d68c87c3612af6289f72b5d90a11a726b8/extensions/view-image.ts).
- [`you-should-know`](extensions/you-should-know) - Port of Claude Code's `cc-plugin-you-should-know`: every 6 steps a side agent reads the session and, when there is something you should know but might miss, flags it above the prompt. Also retells the last turn in plain words (`/plain`) or the whole session when you lost track (`/lost`), after [cc-mod-waitwhat](https://github.com/GGGODLIN/cc-mod-waitwhat), in an overlay the main agent never sees. Rules, settings, how to trigger it, and testing are in its [README](extensions/you-should-know/README.md).
- [`recap`](extensions/recap) - At-a-glance session status summary above the prompt, after [cc-mod-waitwhat](https://github.com/GGGODLIN/cc-mod-waitwhat): when the agent settles, a side call summarizes the session's goal, current status, next action, and waiting indicator (`/recap`), sharing the main session's prompt-cache prefix. Settings, cache rules, commands, and testing are in its [README](extensions/recap/README.md).
- [`prismantis`](extensions/prismantis) - Port of [NahumLitvin/prismantis](https://github.com/NahumLitvin/prismantis) 0.35.0: redraws assistant replies, user prompts, tool rows, and diff cards in 17 themes, with Mermaid diagrams, `xychart-beta` bar and line charts, pie and Gantt charts, ` ```figure ` blocks, copy buttons, and right-to-left prose. Ships all 17 palettes as pi themes under [`themes`](themes). Commands, settings, and testing are in its [README](extensions/prismantis/README.md).

## Tests

[`test`](test) holds an automated test suite (`npm test`), a faux model provider and launcher scripts (`test/recap.sh`, `test/you-should-know.sh`, `test/prismantis.sh`) for interactive TUI testing. They are not in the `pi` manifest, so installing the package never loads them.
