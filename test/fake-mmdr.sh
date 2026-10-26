#!/bin/sh
out=
layout=
while [ $# -gt 0 ]; do
	case "$1" in
	-o) out=$2; shift ;;
	--dumpLayout) layout=$2; shift ;;
	esac
	shift
done
src=$(cat)
log=$FAKE_MMDR_DIR/calls.log
echo start >>"$log"
printf '%s\n' "$src" >"$FAKE_MMDR_DIR/last-stdin.txt"
pwd >"$FAKE_MMDR_DIR/last-cwd.txt"
case "$src" in *fake:sleep*) exec sleep 30 ;; esac
case "$src" in *fake:slow*) sleep 0.2 ;; esac
case "$src" in *fake:fail*) echo end >>"$log"; exit 1 ;; esac
kind=Timeline
nodes='"t"'
size='"width":300,"height":200'
case "$src" in *fake:flowchart*) kind=Flowchart ;; esac
case "$src" in *fake:syntax*) nodes='">","A"' ;; esac
case "$src" in *fake:empty*) nodes=; size='"width":8,"height":8' ;; esac
image=fixture.png
case "$src" in *fake:huge*) image=huge.png ;; esac
case "$src" in *fake:big*) image=big.png ;; esac
cp "$FAKE_MMDR_DIR/$image" "$out"
case "$src" in
*fake:nolayout*) ;;
*) printf '{"kind":"%s",%s,"nodes":[%s],"edges":[]}' "$kind" "$size" "$(echo "$nodes" | sed 's/"\([^"]*\)"/{"id":"\1"}/g')" >"$layout" ;;
esac
echo end >>"$log"
