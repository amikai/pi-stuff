#!/bin/sh
PATH=/usr/bin:/bin
printf '%s\n' "$*" >"$FAKE_MERMAN_DIR/last-args.txt"
src=$(cat)
log=$FAKE_MERMAN_DIR/calls.log
echo start >>"$log"
printf '%s\n' "$src" >"$FAKE_MERMAN_DIR/last-stdin.txt"
case "$src" in *fake:sleep*) exec sleep 30 ;; esac
case "$src" in *fake:slow*) sleep 0.2 ;; esac
case "$src" in *fake:fail*) echo end >>"$log"; exit 1 ;; esac
image=fixture.png
case "$src" in *fake:huge*) image=huge.png ;; esac
case "$src" in *fake:big*) image=big.png ;; esac
cat "$FAKE_MERMAN_DIR/$image"
echo end >>"$log"
