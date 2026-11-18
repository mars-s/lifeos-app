#!/bin/bash
set -euo pipefail
SOURCE="${1:?usage: build-art.sh <folder with spots-light, spots-dark, backdrops, icon>}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/art"
mkdir -p "$OUT/spots/light" "$OUT/spots/dark" "$OUT/backdrops" "$OUT/covers" "$OUT/painted" "$OUT/rituals" "$OUT/blur"

spot() {
  local theme="$1" file="$2" levels="$3"
  local name; name="$(basename "$file" .png)"; name="${name#spot-}"
  ffmpeg -y -loglevel error -i "$file" -vf "crop=iw*0.68:ih*0.68,scale=900:600:flags=lanczos,$levels" "$OUT/spots/$theme/$name.png"
  cwebp -quiet -q 84 "$OUT/spots/$theme/$name.png" -o "$OUT/spots/$theme/$name.webp"
  rm "$OUT/spots/$theme/$name.png"
}

for file in "$SOURCE"/spots-light/spot-*.png; do
  [ -e "$file" ] && spot light "$file" "colorlevels=rimax=0.962:gimax=0.950:bimax=0.930"
done
for file in "$SOURCE"/spots-dark/spot-*.png; do
  [ -e "$file" ] && spot dark "$file" "colorlevels=rimin=0.078:gimin=0.082:bimin=0.086"
done
for file in "$SOURCE"/backdrops/backdrop-*.png "$SOURCE"/backdrops/material-*.png; do
  [ -e "$file" ] || continue
  name="$(basename "$file" .png)"
  cwebp -quiet -q 92 -sharp_yuv -resize 1536 0 "$file" -o "$OUT/backdrops/${name#backdrop-}.webp"
done

tile() {
  local folder="$1" prefix="$2" size="$3"
  for file in "$SOURCE/$folder/$prefix"-*.png; do
    [ -e "$file" ] || continue
    local name; name="$(basename "$file" .png)"
    cwebp -quiet -q 88 -sharp_yuv -resize "$size" 0 "$file" -o "$OUT/$folder/${name#"$prefix"-}.webp"
  done
}
tile covers cover 768
tile rituals ritual 768
tile painted painted 1536
tile blur blur 1536

ICON="$SOURCE/icon"
if [ -e "$ICON/icon-paper-2.png" ] && [ -e "$ICON/icon-graphite-2.png" ]; then
  REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
  WORK="$(mktemp -d)"
  mkdir -p "$OUT/icon"
  ffmpeg -y -loglevel error -i "$ICON/icon-paper-2.png" -vf "crop=1080:1080:87:99,scale=1024:1024:flags=lanczos" "$WORK/paper.png"
  ffmpeg -y -loglevel error -i "$ICON/icon-graphite-2.png" -vf "crop=1040:1040:107:109,scale=1024:1024:flags=lanczos" "$WORK/graphite.png"
  cwebp -quiet -q 90 -resize 512 512 "$WORK/paper.png" -o "$OUT/icon/paper.webp"
  cwebp -quiet -q 90 -resize 512 512 "$WORK/graphite.png" -o "$OUT/icon/graphite.webp"

  MOBILE="$REPO/apps/mobile/assets"
  cp "$WORK/paper.png" "$MOBILE/icon.png"
  cp "$WORK/graphite.png" "$MOBILE/icon-dark.png"

  ffmpeg -y -loglevel error -i "$WORK/graphite.png" -f lavfi -i "color=c=black:s=1024x1024,format=gray,geq=lum='255*clip((1-pow(abs((X-511.5)/412)\,5)-pow(abs((Y-511.5)/412)\,5))*60\,0\,1)'" \
    -filter_complex "[0]scale=824:824:flags=lanczos,pad=1024:1024:100:100:color=black,format=rgb24[tile];[tile][1]alphamerge" -frames:v 1 "$WORK/mac.png"
  mkdir -p "$REPO/apps/desktop/art"
  cp "$WORK/mac.png" "$REPO/apps/desktop/art/app-icon.png"
  echo "icon masters in $WORK"
fi
