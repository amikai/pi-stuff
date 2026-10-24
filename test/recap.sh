#!/usr/bin/env bash
# Runs this repo's recap extension in a real pi TUI against the faux provider
# (test/faux-provider.ts). Everything it writes goes to a fresh agent dir, so
# your store and sessions under ~/.pi/agent stay untouched.
#
# In the session, the side agent's recap reply is read from ctrl/recap.txt on
# every check, so edit it while pi runs to test different states.
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
dir=$(mktemp -d "${TMPDIR:-/tmp}/recap-test.XXXXXX")
mkdir -p "$dir/ctrl" "$dir/work"
printf 'goal: Test session recap\nnow: Testing the recap overlay\nnext: Review output\nwaiting: no\n' >"$dir/ctrl/recap.txt"

echo "recap reply: $dir/ctrl/recap.txt"
echo "store:       $dir/recap.json"
echo "sessions:    $dir/recap"

cd "$dir/work"
PI_CODING_AGENT_DIR="$dir" RECAP_CTRL="$dir/ctrl" \
	exec pi -ne \
	-e "$repo/extensions/recap/index.ts" \
	-e "$repo/test/faux-provider.ts" \
	--model faux/faux-1 \
	--session-dir "$dir/sessions"
