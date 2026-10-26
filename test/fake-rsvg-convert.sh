#!/bin/sh
PATH=/usr/bin:/bin
printf '%s\n' "$*" >"$FAKE_MMDR_DIR/rsvg-args.txt"
while [ $# -gt 1 ]; do
	case "$1" in
	-o) out=$2; shift ;;
	esac
	shift
done
case "$(cat "$FAKE_MMDR_DIR/last-stdin.txt")" in *fake:rsvg-fail*) exit 1 ;; esac
cp "$1" "$out"
