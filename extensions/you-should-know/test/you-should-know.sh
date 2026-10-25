#!/usr/bin/env bash
# Runs this repo's you-should-know in a real pi TUI against the faux provider
# (test/faux-provider.ts). Everything it writes goes to a fresh agent dir, so
# your store, log and sessions under ~/.pi/agent stay untouched.
#
# In the session, a prompt containing "steps N" makes the main agent call bash
# N times. The side agent's propose reply is read from ctrl/side.txt on every
# check, so edit it while pi runs; "{n}" becomes a call counter, which keeps
# each note unique.
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
dir=$(mktemp -d "${TMPDIR:-/tmp}/ysk-test.XXXXXX")
mkdir -p "$dir/ctrl" "$dir/work"
printf 'learn: Faux note number {n} for testing.\ntag: Heads up\nexplain:\n**Faux note title**\nFaux explanation body.\n' >"$dir/ctrl/side.txt"

echo "side agent reply: $dir/ctrl/side.txt"
echo "store:            $dir/you-should-know.json"
echo "log:              $dir/you-should-know.log"

cd "$dir/work"
PI_CODING_AGENT_DIR="$dir" PI_YOU_SHOULD_KNOW_DEBUG=1 YSK_CTRL="$dir/ctrl" \
	exec pi -ne \
	-e "$repo/extensions/you-should-know/index.ts" \
	-e "$repo/test/faux-provider.ts" \
	--model faux/faux-1 \
	--session-dir "$dir/sessions"
