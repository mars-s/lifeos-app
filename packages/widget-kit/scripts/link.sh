#!/bin/sh
set -eu

KIT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$KIT/../.." && pwd)"

relink() {
  folder="$1"
  shift
  mkdir -p "$folder"
  find "$folder" -type l -delete
  for file in "$@"; do
    ln -s "$(python3 -c 'import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))' "$file" "$folder")" "$folder/"
  done
}

relink "$ROOT/apps/mobile/targets/widgets/Kit" "$KIT"/Sources/LifeOSWidgetKit/*.swift
relink "$ROOT/apps/mobile/targets/widgets/Fonts" "$KIT"/Fonts/*.ttf
relink "$ROOT/apps/mobile/modules/lifeos-widgets/ios/Kit" \
  "$KIT/Sources/LifeOSWidgetKit/Snapshot.swift" \
  "$KIT/Sources/LifeOSWidgetKit/Store.swift" \
  "$KIT/Sources/LifeOSWidgetKit/Token.swift" \
  "$KIT/Sources/LifeOSWidgetKit/FocusActivity.swift"
