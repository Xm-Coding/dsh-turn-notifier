#!/bin/bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
APP="$ROOT/DSHNativeNotifier.app"
BUILD="$ROOT/.native-build"
ICON="$ROOT/AppleScriptNotifier.app/Contents/Resources/AppIcon.icns"
SOURCE="$ROOT/src/DSHNativeNotifier.m"

[[ "$APP" == "$ROOT/DSHNativeNotifier.app" ]] || exit 2
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$BUILD"
cp "$ROOT/native-Info.plist" "$APP/Contents/Info.plist"
cp "$ICON" "$APP/Contents/Resources/AppIcon.icns"

SDK="$(/usr/bin/xcrun --sdk macosx --show-sdk-path)"
for arch in arm64 x86_64; do
  /usr/bin/clang -O2 -fobjc-arc -fmodules -fmodules-cache-path="$BUILD/module-cache" \
    -isysroot "$SDK" -target "$arch-apple-macos11.0" \
    -Wno-deprecated-declarations -framework Cocoa \
    "$SOURCE" -o "$BUILD/DSHNativeNotifier-$arch"
done
/usr/bin/lipo -create "$BUILD/DSHNativeNotifier-arm64" "$BUILD/DSHNativeNotifier-x86_64" \
  -output "$APP/Contents/MacOS/DSHNativeNotifier"
/bin/chmod 755 "$APP/Contents/MacOS/DSHNativeNotifier"
/usr/bin/codesign --force --sign - "$APP" >/dev/null
printf 'Built %s\n' "$APP"
/usr/bin/lipo -info "$APP/Contents/MacOS/DSHNativeNotifier"
