#!/bin/sh
set -eu

cd "$(dirname "$0")"
xcodebuild -project LifeOSWidgets.xcodeproj -scheme LifeOSWidgets -configuration Release -derivedDataPath build -quiet
