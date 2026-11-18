#!/bin/sh
set -eu

cd "$(dirname "$0")/../src"
check() {
  echo "## $1"
  shift
  grep -rnE "$@" --include='*.tsx' --include='*.ts' --include='*.css' . | cut -c1-200 || true
}

check "transition: all" 'transition-all|transition: ?all'
check "three dots instead of an ellipsis" '[A-Za-z]\.\.\.["<`]'
check "click handler on a div, span, li or p" '<(div|span|li|p)[^>]*onClick='
check "blocked paste, autoFocus, blocked zoom" 'onPaste|autoFocus|user-scalable|maximum-scale'
check "img tags (each needs width and height)" '<img'
check "hardcoded date formats" 'toLocale(Date|Time)?String|getMonth\(\)|getDate\(\)'
check "hover motion outside a hover media query" 'hover:scale|hover:translate|hover:-translate'
check "inputs (each needs a label, a name and autocomplete)" '<(input|textarea)'
check "theme and viewport metadata" 'color-scheme|theme-color|safe-area-inset|overscroll-behavior:'
echo "## outline-none per file (each needs a focus-visible replacement)"
grep -rnc 'outline-none' --include='*.tsx' . | grep -v ':0$' || true
