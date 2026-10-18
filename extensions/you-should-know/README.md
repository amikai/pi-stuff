# you-should-know

A pi port of Claude Code's built-in plugin `cc-plugin-you-should-know`. While the main agent works, a side agent reads the session. When it finds something you should know but might miss, it flags it above the prompt.

Source version: Claude Code 2.1.302. The plugin has no version of its own; it is bundled in the Claude Code binary, so the Claude Code version identifies it.

It also carries a retell feature taken from [cc-mod-waitwhat](https://github.com/GGGODLIN/cc-mod-waitwhat) 0.8.2: **Plain words** retells the last turn plainly and **Lost track** retells the whole session (see [Retell](#retell), and [What comes from cc-mod-waitwhat](#what-comes-from-cc-mod-waitwhat) for everything borrowed from it).

The code is in [`index.ts`](index.ts). The rules below were read from that code. Items marked "verified" were exercised in a real pi TUI against the faux provider (see [Testing](#testing)).

## Setup

Install the package; nothing else is required:

```sh
pi install git:github.com/amikai/pi-stuff
```

With no settings file it runs with the defaults below: checks on, the session's model, the retell buttons shown.

### Settings

Settings live in `~/.pi/agent/you-should-know.json` (pi's agent dir, so `PI_CODING_AGENT_DIR` moves it). The file appears the first time the extension saves state; create it yourself to change a setting before that. Every field is optional:

```json
{
  "enabled": true,
  "model": "",
  "yskModel": "",
  "reasoning": "low",
  "buttons": true
}
```

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Run the background checks. Only an explicit `false` turns them off. Retell is not affected. `4 Disable` on the card writes `false`. |
| `model` | `""` | `provider/modelId` for checks and retell, for example `"moxa/gpt-5-4"`. Empty uses the session's current model, and follows it when you switch models. |
| `yskModel` | `""` | `provider/modelId` for checks only. Empty falls back to `model`. |
| `reasoning` | `"low"` | `minimal`, `low`, `medium` or `high`, for checks. Retell leaves it to the model. |
| `buttons` | `true` | Show the `[Plain words]` `[Lost track]` row below the card. `/plain` and `/lost` work either way. |

The same file also holds state the extension writes itself: `seen`, `known`, `typedPastInARow` and `looksToSkip`. Leave those alone, or empty `seen` and `known` to let old topics come back.

Settings are read when a session starts. The extension also rewrites the file whenever its state changes, so an edit made while pi runs can be overwritten: close pi first, or run `/new` right after saving. A broken JSON file counts as missing, and the next save replaces it. A model name that cannot be found falls back to the session's model without a warning; the log's `model` field shows which one answered.

### Replacing the retell prompts

Put your own system prompt in `~/.pi/agent/you-should-know-prompts/plain.md` or `lost.md`. A file that exists and is not empty replaces that retell's built-in prompt; delete it to go back. It lives outside the package, so `pi update` leaves it alone. The check prompt cannot be replaced.

### Showing the checks

`PI_YOU_SHOULD_KNOW_DEBUG=1` lists the last 3 checks above the prompt, with their step, outcome and time. Logging does not depend on it.

## The card

Answer with the number keys while the editor is empty. In fullscreen mode you can also click a choice.

| View | Choices |
|---|---|
| Offer | `1 Learn more` · `2 Knew this already` · `3 What is this` · `4 Disable` (press twice) · `0 Dismiss` |
| Explanation | `1 Understood` · `2 Chat in main session` · `0 Dismiss` |
| After dismissing an offer | `1 That was helpful` · `2 Not relevant` · `3 Couldn’t understand` · `4 Turn off suggestions` · `0 Dismiss` |
| After dismissing an explanation | `1 That was helpful` · `2 Didn’t understand` · `0 Dismiss` |

- `Knew this already`, `Understood`, `That was helpful` and `Chat in main session` add the topic to `known`, so it is never offered again.
- `Chat in main session` pastes the note and its explanation into the editor as a quote. If the editor already has text, it refuses and shows a warning.

## Trigger rules

### When it checks

- Steps are counted per prompt, starting at 0. A check runs at steps 6, 12, 18 and so on. Steps never carry over to the next prompt. (verified)
- A check only asks the side agent. It does not guarantee a card. The side agent defaults to `learn: none` and the bar is deliberately high, so most checks end as `none`.

### Before a check: any of these skips it (logged as `skip`)

| reason | Meaning |
|---|---|
| `already offered this run` | A card was already shown for this prompt |
| `card open (...)` | A card is still on screen: offer, explaining, follow-up question or error |
| `check in flight` | The previous check has not returned yet |
| `disabled` | `enabled` is `false` (verified) |
| `mode ...` | pi is not in TUI mode |
| `backing off` | Too many offers were typed past in a row, so checks are spaced out (verified) |

### After a check: a reply can still produce no card (logged as `outcome`)

| outcome | Cause |
|---|---|
| `none` | The side agent found nothing worth interrupting for |
| `deduped` | Same as one of the last 50 offers or a `known` topic; the match ignores case and punctuation (verified) |
| `parse_failed` | The reply had no `learn:` line, or that line was over 240 characters |
| `stale` | While waiting, a new session started, the feature was turned off, or another card appeared |
| `api_error` | No model, no credentials, or an API error |

### What the side agent sees

- Only the session messages. It never sees the system prompt, so it knows nothing from CLAUDE.md or AGENTS.md.
- Each tool result keeps its first 600 and last 600 characters, so an error at the end of a long output stays visible. Tool arguments are cut to their first 400. (verified)
- At most 150k characters in total. Beyond that it keeps the first prompt (first 4k characters) plus the most recent part.
- The exact input of every check is saved, so you can read what it saw (see [Files](#files)). (verified)

### After a card appears

- An offer survives one prompt. The second prompt clears it, which counts as typing past it. Input sent by an extension does not count. (verified)
- After 3 or more offers typed past in a row, it skips 1, then 2, then 4 checks, up to 16. Pressing any choice resets the streak. (verified)
- The follow-up question clears itself after 20 seconds without an answer, or when you send a new prompt. (verified)

## Retell

Two retells, both taken from cc-mod-waitwhat with their prompts translated:

| | Plain words | Lost track |
|---|---|---|
| Use it when | You read the last answer and did not understand it | You lost track of how the session got here |
| What it sends | Your last prompt and everything after it | The whole session |
| What it asks for | Cut to 40-60% of the length, explain internal names on first use, give one recommendation where a decision is needed | Conclusion first, then the story from the start; lead with trees, pseudocode or +/- lists where the topic has a shape |

Starting one:

- Click `[Plain words]` or `[Lost track]` in the row below the card (fullscreen mode), or run `/plain` or `/lost`. (verified)
- Set `"buttons": false` to hide the row; the commands keep working. (verified)
- Retell works whether or not the checks are turned on. (verified)

What you see:

- An overlay: on the right at 45% width when the terminal is at least 120 columns wide, otherwise full width above the editor. (verified)
- Its header names the mode, how many characters were sent, the model that answered and how long it took, or `cache hit` with the model that answered then. (verified)
- `↑` `↓` `PgUp` `PgDn` `Home` `End` and the mouse wheel scroll it; `Esc` closes it. (verified)
- Pressing again while a retell is running only reopens the overlay; it does not start a second one. (verified)

What goes to the model:

- Each message's words in full, with each tool result as one line cut to 200 characters. Tool arguments are left out. There is no size limit, as in cc-mod-waitwhat; a session larger than the model's context fails and the overlay shows the error.
- Nothing is written to the session, and the main agent never sees the retell.

Repeats are cached: the key is the mode plus what you and the agent said, without tool output or model, so an unchanged conversation gets the stored answer without a model call. (verified)

## What comes from cc-mod-waitwhat

[cc-mod-waitwhat](https://github.com/GGGODLIN/cc-mod-waitwhat) 0.8.2 is a Claude Code mod with three buttons above the prompt: 白話 (plain words), 跟丟了 (lost track) and 該知道 (should know), plus an automatic recap. This extension borrows its retell and part of its record keeping, and keeps the Claude Code original's check.

Borrowed:

| Here | In cc-mod-waitwhat |
|---|---|
| `Plain words` retell of the last turn | 白話 |
| `Lost track` retell of the whole session | 跟丟了 |
| The button row | The button row above the prompt |
| The overlay with the result | The pane |
| The header: characters sent, model, seconds, or `cache hit` | The same header |
| A second press while a retell runs only reopens it | The same |
| The retell cache: same key, 200 entries | `~/.cache/cc-sidecar-waitwhat.json` |
| Prompt override files | `~/.config/cc-sidecar-waitwhat/*.md` |
| Every check logged (last 2,000 lines) and its input saved | `cc-ysk-log.jsonl` and `cc-ysk-payloads/` |
| `yskModel` for checks only | `YSK_MODEL` |
| Tool results cut to both ends | Its check input, which keeps both ends |

Different on purpose:

| | cc-mod-waitwhat | Here | Why |
|---|---|---|---|
| Language | Prompts and labels in Chinese | English; both retell prompts add "Chinese means Traditional Chinese" | The repo is in English |
| Starting a retell | Click, or `ctrl+x tab` into the row and pick with the keyboard; no slash commands on purpose | Click only, plus `/plain` and `/lost` | The number keys belong to the card; pi commands never reach the transcript |
| The row | Three buttons and a recap line | Two retell buttons below the card | The check keeps the original's card; no recap |
| Where the result shows | Claude Code places its pane | Right side at 45% from 120 columns, otherwise full width above the editor | pi has overlays, not panes |
| Keyboard while it is open | Not checked | The overlay holds the keyboard until `Esc` | A pi overlay needs focus to scroll |
| Which model | `cmd`, then `http` (default `gemini-3.8-flash-high`), then `haiku`, falling through on failure and saying why | One model: `model`, else the session's; an error is shown, nothing else is tried | pi can already reach any configured model |
| Reply length | No limit over `http`, 1,500 tokens for `haiku` | 8,000 tokens | |
| `yskModel` | `YSK_MODEL` only changes the `http` step | Replaces the check's model | No fallback chain here |
| Files | `~/.cache`, `~/.config`; the lost-track prompt is `wait-what.md` | pi's agent dir; the prompt is `lost.md` | pi convention, and tests swap the agent dir |
| Cache | Shared with its sidecar tool | This extension only | No sidecar |
| Check log | `checked` and `answered` | Checks, skips, explanations, key presses and cleared cards | Keeps the events this port already logged |
| Tool output cut for checks | 300 at each end, arguments too | 600 at each end; arguments keep their first 400 | Keeps this port's sizes |

Not borrowed:

- **The automatic recap** (goal, now, next after every turn).
- **Its own check, 該知道.** It runs once after the main agent stops and waits, sends the session trimmed to about 60,000 tokens, asks for JSON with a short title, and lights its button with a `●` instead of showing a card; you open it when ready and answer 有幫助 (helpful) or 不相關 (not relevant). It never touches Claude Code's built-in plugin, so in Claude Code the two can run side by side. This extension keeps the original's check: every 6 steps while the agent works, with a card. The trade-off is timing: a card can arrive while there is still time to stop the agent, but it can also go stale a moment later.

## Making it trigger more often

The side agent flags:

- decisions the main agent made that you never engaged with;
- results that may be wrong, unchecked assumptions, skipped steps and failures that went by quietly;
- constraints or risks that shape how the task turns out;
- concepts you visibly do not understand.

It does not flag anything you asked about or replied to, anything the main agent is about to address, trivia, or things that are merely interesting.

Tasks that tend to trigger it:

- **"Make it pass"**: the agent may quietly lower the bar, for example by adding `//nolint`, skipping tests or weakening assertions.
- **Incomplete environment**: the agent works around a missing tool or service, for example switching from `pytest` to `unittest`, or reporting "needs the service, skipping".
- **Vague spec**: the agent has to choose on its own, for example sort order, time zone or which data to delete.
- **Changes that spread**: for example `go get -u` upgrading a pile of indirect dependencies.

How to run them:

- Give the whole task in one prompt and let the agent run past 12 steps. Do not ask about the decision along the way.
- Set `PI_YOU_SHOULD_KNOW_DEBUG=1` to see each check's result above the prompt.
- Checks use the session's model with reasoning `low` by default. Set `"yskModel": "provider/modelId"` and `"reasoning": "medium"` in `~/.pi/agent/you-should-know.json` to pin a stronger one. Flash-class models at `low` rarely flag anything.
- When a check ends as `none` and you think it should not have, read its payload file to see exactly what the side agent was given.

Known limitation: checks run while the main agent is still working, so a note can go stale seconds after it appears. For example, it points out that the tests never ran, the agent fixes that in its next step, and the card stays on screen.

## Files

Besides the settings file, the extension writes these to pi's agent dir, `~/.pi/agent` unless `PI_CODING_AGENT_DIR` says otherwise:

| File | Contents |
|---|---|
| `you-should-know.log` | One JSON line per check, skip, explanation, key press and cleared card, with the side agent's raw reply. Always written; keeps the last 2,000 lines. (verified) |
| `you-should-know-payloads/<session id>-<message count>.txt` | The exact input of each check: the system prompt, `---`, then the transcript and lists it was given. The log line names the file. Always written and never cleaned up, so it holds whatever the session contained, secrets included. (verified) |
| `you-should-know-cache.json` | Retell answers, keyed as described in [Retell](#retell). Keeps the last 200. (verified) |
| `you-should-know-prompts/plain.md`, `lost.md` | Yours, not written by the extension: see [Replacing the retell prompts](#replacing-the-retell-prompts). (verified) |

## Differences from the Claude Code original

Compared against the original code in the Claude Code 2.1.302 binary:

- Same: a check every 6 steps, one card per prompt, an offer survives one prompt, the 20-second clear, 50 `seen` entries, the back-off formula, and every choice on the card.
- Disable: the original only fills `/plugin disable cc-plugin-you-should-know@builtin` into the prompt, which takes effect once you send it. This port writes `enabled: false` directly.
- Cost: the original uses `model.fork` to reuse the main conversation. This port rebuilds the transcript for every check and sends it with `cacheRetention: "none"`, so nothing is cached.
- Transcript: the original sends the conversation whole. This port caps it at 150k characters and cuts tool results to their two ends.
- Side model: the original always uses the main conversation's model. This port can pin another one with `yskModel` or `model`.
- Records: the original reports to telemetry. This port keeps a local log and the input of every check.
- Retell, its buttons and its commands come from cc-mod-waitwhat; the original has nothing like them.
- The original contains code for "make it a learning page (artifact)" and for "explain it again differently", but 2.1.302 has no way to reach either. Neither is ported.

## Testing

```sh
test/you-should-know.sh
```

This runs the repo's extension in a real pi TUI, with the model replaced by [`test/faux-provider.ts`](../../test/faux-provider.ts):

- Main agent: a prompt containing `steps N` makes it call bash N times, then answer `done`. Adding the word `long` makes every call print 3,000 lines.
- Side agent: every check reads `ctrl/side.txt` as its reply, with `{n}` replaced by a call counter. You can edit the file while pi runs.
- Retell: answers with its mode and a counter plus 40 lines to scroll. A prompt override containing `OVERRIDE-MARKER` is marked `(override)` in the title. Creating `ctrl/slow` makes it take 5 seconds.
- Two models, `faux/faux-1` and `faux/faux-2`, so `model` and `yskModel` can be told apart.
- `-ne` loads only these two extensions, and the agent dir is a fresh temp directory, so `~/.pi/agent` is never touched. `/new` starts a new session and rereads the settings.

Acceptance checklist:

1. `steps 13` with `learn: none` in `side.txt`: checks run only at steps 6 and 12.
2. Fix one note and press `2`: it is added to `known`, and the next run logs `deduped`.
3. `3` toggles `What is this` / `Return to topic`; `1` opens the explanation; `2` pastes it into the editor.
4. Type into the editor, then click `Chat in main session`: it shows `Your prompt box has text in it...`.
5. Press `0` on the explanation: after 20 seconds the log records `cleared` by `timeout`.
6. Let three offers in a row be cleared by two prompts each: `looksToSkip` becomes 1 and the next check logs `backing off`.
7. Press `4` twice: `enabled` becomes `false` and later checks log `disabled`.
8. `long steps 6`: the payload file shows tool results as start `…[N chars cut]…` end, and the log line names the file.
9. `/plain`, scroll, `Esc`, `/plain` again: the second header says `cache hit`. Click `[Lost track]`: the overlay switches to the whole session.
10. Write `OVERRIDE-MARKER` into `you-should-know-prompts/lost.md`, send a prompt, run `/lost`: the title says `(override)`.
11. Settings `{"model": "faux/faux-2", "yskModel": "faux/faux-1", "buttons": false}` then `/new`: the row is gone, checks log `faux/faux-1`, retell says `faux/faux-2`.
12. With `ctrl/slow`, run `/lost`, press `Esc`, run `/plain`: the overlay still shows `Lost track · whole session · retelling…` and only one retell call is made.
13. At 100 columns the overlay is full width with the editor visible below it.
