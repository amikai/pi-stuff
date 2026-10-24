# recap

`recap` displays a session status summary (`goal`, `now`, `next`, and a `waiting` indicator) above the prompt editor in the pi TUI after the main agent settles. The trigger rules follow [cc-mod-waitwhat](https://github.com/GGGODLIN/cc-mod-waitwhat) 0.8.2, and the request reuses the main session's prompt-cache prefix across providers.

`recap` runs independently of [`you-should-know`](../you-should-know). It loads from [`index.ts`](index.ts) with its own settings, commands, and session records.

## Setup

Install the package:

```sh
pi install git:github.com/amikai/pi-stuff
```

With no settings file, `recap` runs enabled and uses the session's active model.

### Settings

Settings live in `~/.pi/agent/recap.json` (`PI_CODING_AGENT_DIR` overrides `~/.pi/agent`). Every field is optional:

```json
{
	"enabled": true,
	"model": ""
}
```

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Run the idle recap and show the line above the prompt editor. `/recap off` writes `false`. `/recap on` writes `true`. |
| `model` | `""` | `provider/modelId` override for recap calls. An empty string uses the session's current model so the call shares the session's prompt cache. |

`recap` reads `recap.json` from disk before each scheduled run and before each `/recap` command.

## How it works

### Trigger rules

- When the main agent settles (`agent_settled`), `recap` schedules a timer for `delayFor(now, lastRunAt)`:
  - The first run in a session waits `RECAP_IDLE_MS` (5 seconds).
  - Later runs wait at least `RECAP_IDLE_MS` (5 seconds) and at least `RECAP_MIN_GAP_MS` (60 seconds) after the previous run.
- Any new prompt or turn (`before_agent_start`, `agent_start`, `turn_start`, or user `input`) cancels the pending timer and aborts any in-flight recap call.
- `recap` enforces no minimum turn count.
- Automatic runs skip when any of the following conditions hold:
  - `enabled` is `false`, or pi is not in `tui` mode.
  - A recap request is already in flight.
  - The prompt editor contains draft text.
  - The conversation fingerprint (`fingerprintOf`) matches the fingerprint from the last completed recap.

### Saving token cost across providers

- **Same-model cache fork (default when `model` is `""` or matches the session model).** `recap` captures the LLM message prefix from `context_with_system` and `turn_end`, and falls back to `convertToLlm(buildSessionContext(...).messages)` before the first turn. It appends `RECAP_PROMPT` as one trailing `user` message without setting `systemPrompt`, so the leading system message and tool declarations match the main session's prefix on Anthropic, OpenAI, Codex, Gemini, Vertex, Bedrock, and Mistral. It passes `sessionId` for `prompt_cache_key` and session-affinity headers, `transport: "sse"` so OpenAI Codex WebSocket continuation state stays intact, and the session's `thinkingLevel`. If more than 90% of the model's `promptCache.short` TTL (default 300 seconds) has elapsed since `turn_end`, `recap` skips the automatic run to avoid paying uncached full-context input cost.
- **Cross-model 5,000-token slice (when `model` points to a different model).** Because prompt caches do not cross models, `recap` slices the transcript to `RECAP_INPUT_BUDGET` (5,000 tokens, with 30% for recent user prompts in `<user_messages>` and 70% for the recent conversation tail in `<recent>`) and sends it with `systemPrompt: RECAP_PROMPT` and `cacheRetention: "none"`.

### Plain-text prompt and widget line

The model replies with four plain-text lines instead of JSON:

```text
goal: <overall objective of the session, under 15 words>
now: <what is happening right now or what it is waiting on, under 15 words>
next: <the one next action and who takes it, under 15 words>
waiting: <yes | no>
```

`recap` renders a compact line above the prompt editor (`✦ recap: <goal> · <now> → <next>`). When `waiting` is `yes`, the label highlights as `✦ recap (waiting):`.

## Commands

| Command | Effect |
|---|---|
| `/recap` or `/recap now` | Force a fresh recap immediately, bypassing the 60-second gap, fingerprint check, and cache TTL guard. |
| `/recap hide` | Hide the recap line until the next recap update without disabling background updates. |
| `/recap off` | Disable recaps and clear the recap line. |
| `/recap on` | Enable recaps and restore the recap line or schedule a run. |

## Files

`recap` writes these files under pi's agent directory (`~/.pi/agent` unless `PI_CODING_AGENT_DIR` is set):

| File | Contents |
|---|---|
| `recap.json` | Settings (`enabled`, `model`). |
| `recap/<session id>.json` | Latest `RecapRecord` (`version`, `sessionId`, `at`, `model`, `fingerprint`, `goal`, `now`, `next`, `waiting`), restored on `session_start`. |

## Testing

```sh
npm test
test/recap.sh
```

`npm test` runs [`test/recap.test.ts`](../../test/recap.test.ts). `test/recap.sh` starts pi in TUI mode against [`test/faux-provider.ts`](../../test/faux-provider.ts) with an isolated temporary agent directory and `ctrl/recap.txt` for live edits.
