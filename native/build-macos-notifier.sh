#!/bin/bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
APP="$ROOT/AppleScriptNotifier.app"
BUILD="$ROOT/.build"
ICONSET="$BUILD/AppIcon.iconset"
SOURCE_IMAGE="$ROOT/../assets/deepseek.png"

[[ "$APP" == "$ROOT/AppleScriptNotifier.app" ]] || exit 2
mkdir -p "$ICONSET"

for spec in \
  '16 icon_16x16.png' \
  '32 icon_16x16@2x.png' \
  '32 icon_32x32.png' \
  '64 icon_32x32@2x.png' \
  '128 icon_128x128.png' \
  '256 icon_128x128@2x.png' \
  '256 icon_256x256.png' \
  '512 icon_256x256@2x.png' \
  '512 icon_512x512.png' \
  '1024 icon_512x512@2x.png'
do
  set -- $spec
  /usr/bin/sips -z "$1" "$1" "$SOURCE_IMAGE" --out "$ICONSET/$2" >/dev/null
done

/usr/bin/osacompile -o "$APP" "$ROOT/src/notifier.applescript"
/usr/bin/iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
PLIST="$APP/Contents/Info.plist"
set_string() {
  /usr/libexec/PlistBuddy -c "Set :$1 \"$2\"" "$PLIST" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c "Add :$1 string \"$2\"" "$PLIST"
}
set_string CFBundleIdentifier ai.deepseek.harness.turn-notifier.applescript
set_string CFBundleDisplayName 'DeepSeek Notifier'
set_string CFBundleName 'DeepSeek Notifier'
set_string CFBundleIconFile AppIcon
/usr/libexec/PlistBuddy -c 'Delete :CFBundleIconName' "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c 'Set :LSUIElement true' "$PLIST" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c 'Add :LSUIElement bool true' "$PLIST"
/usr/bin/codesign --force --sign - "$APP" >/dev/null

rm -rf "$ICONSET"
rmdir "$BUILD" 2>/dev/null || true
printf 'Built %s\n' "$APP"
/usr/bin/lipo -info "$APP/Contents/MacOS/applet"
