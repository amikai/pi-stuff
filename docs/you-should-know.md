# you-should-know

A pi port of Claude Code's built-in plugin `cc-plugin-you-should-know`. While the main agent works, a side agent reads the session. When it finds something you should know but might miss, it flags it above the prompt.

Source version: Claude Code 2.1.302. The plugin has no version of its own; it is bundled in the Claude Code binary, so the Claude Code version identifies it.

The code is in [`extensions/you-should-know.ts`](../extensions/you-should-know.ts). The rules below were read from that code. Items marked "verified" were exercised in a real pi TUI against the faux provider (see [Testing](#testing)).

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
- Each tool result is cut to its first 1,200 characters and tool arguments to 400. An error near the end of a long output is invisible to it.
- At most 150k characters in total. Beyond that it keeps the first prompt (first 4k characters) plus the most recent part.

### After a card appears

- An offer survives one prompt. The second prompt clears it, which counts as typing past it. Input sent by an extension does not count. (verified)
- After 3 or more offers typed past in a row, it skips 1, then 2, then 4 checks, up to 16. Pressing any choice resets the streak. (verified)
- The follow-up question clears itself after 20 seconds without an answer, or when you send a new prompt. (verified)

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
- The side agent uses the session's model with reasoning `low` by default. Set `"model": "provider/modelId"` and `"reasoning": "medium"` in `~/.pi/agent/you-should-know.json` to pin a stronger one. Flash-class models at `low` rarely flag anything.

Known limitation: checks run while the main agent is still working, so a note can go stale seconds after it appears. For example, it points out that the tests never ran, the agent fixes that in its next step, and the card stays on screen.

## Settings and files

- Store: `~/.pi/agent/you-should-know.json`, with `enabled`, `model`, `reasoning`, `seen`, `known`, `typedPastInARow` and `looksToSkip`.
- To turn it back on, set `enabled` to `true`.
- `PI_YOU_SHOULD_KNOW_DEBUG=1` lists the last 3 checks above the prompt and appends every check, skip, explanation and key press to `~/.pi/agent/you-should-know.log`, which rotates to `.log.1` past 5 MB.

## Differences from the Claude Code original

Compared against the original code in the Claude Code 2.1.302 binary:

- Same: a check every 6 steps, one card per prompt, an offer survives one prompt, the 20-second clear, 50 `seen` entries, the back-off formula, and every choice on the card.
- Disable: the original only fills `/plugin disable cc-plugin-you-should-know@builtin` into the prompt, which takes effect once you send it. This port writes `enabled: false` directly.
- Cost: the original uses `model.fork` to reuse the main conversation. This port rebuilds the transcript for every check and sends it with `cacheRetention: "none"`, so nothing is cached.
- Side model: the original always uses the main conversation's model. This port can pin another one with `model`.
- The original contains code for "make it a learning page (artifact)" and for "explain it again differently", but 2.1.302 has no way to reach either. Neither is ported.

## Testing

```sh
test/you-should-know.sh
```

This runs the repo's extension in a real pi TUI, with the model replaced by [`test/faux-provider.ts`](../test/faux-provider.ts):

- Main agent: a prompt containing `steps N` makes it call bash N times, then answer `done`.
- Side agent: every check reads `ctrl/side.txt` as its reply, with `{n}` replaced by a call counter. You can edit the file while pi runs.
- `-ne` loads only these two extensions, and the agent dir is a fresh temp directory, so `~/.pi/agent` is never touched.

Acceptance checklist:

1. `steps 13` with `learn: none` in `side.txt`: checks run only at steps 6 and 12.
2. Fix one note and press `2`: it is added to `known`, and the next run logs `deduped`.
3. `3` toggles `What is this` / `Return to topic`; `1` opens the explanation; `2` pastes it into the editor.
4. Type into the editor, then click `Chat in main session`: it shows `Your prompt box has text in it...`.
5. Press `0` on the explanation: after 20 seconds the log records `cleared` by `timeout`.
6. Let three offers in a row be cleared by two prompts each: `looksToSkip` becomes 1 and the next check logs `backing off`.
7. Press `4` twice: `enabled` becomes `false` and later checks log `disabled`.
