#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
OUT="$PWD/build"

if ! grep -q '^EXPO_PUBLIC_CONVEX_URL=' .env.local 2>/dev/null; then
  echo "Write EXPO_PUBLIC_CONVEX_URL to apps/mobile/.env.local first (see README)." >&2
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT"
npx expo prebuild --platform ios --no-install
(cd ios && pod install)
xcodebuild \
  -workspace ios/LifeOS.xcworkspace \
  -scheme LifeOS \
  -configuration Release \
  -sdk iphoneos \
  -destination generic/platform=iOS \
  -archivePath "$OUT/LifeOS.xcarchive" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
  archive | tail -n 20
mkdir -p "$OUT/Payload"
cp -R "$OUT/LifeOS.xcarchive/Products/Applications/LifeOS.app" "$OUT/Payload/"
(cd "$OUT" && zip -qry LifeOS.ipa Payload && rm -rf Payload)
echo "Built $OUT/LifeOS.ipa"
