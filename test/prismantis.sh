#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
dir=$(mktemp -d "${TMPDIR:-/tmp}/prismantis-test.XXXXXX")
mkdir -p "$dir/work"

echo "config: $dir/prismantis.json"
echo "try:    /prismantis demo | /prismantis setup"

cd "$dir/work"
PI_CODING_AGENT_DIR="$dir" \
	exec pi -ne \
	-e "$repo/extensions/prismantis/index.ts" \
	-e "$repo/test/faux-provider.ts" \
	--model faux/faux-1 \
	--session-dir "$dir/sessions"
