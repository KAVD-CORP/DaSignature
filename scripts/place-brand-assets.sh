#!/usr/bin/env bash
# Copies the Designer's brand pack into the repo, per design/brand/README.md (SPEC Sec 11).
# Usage: scripts/place-brand-assets.sh /path/to/design/brand
# Re-run whenever Designer ships a new pack. Everything is copied, never edited.
set -euo pipefail
B="${1:?usage: $0 <brand-dir>}"
R="$(cd "$(dirname "$0")/.." && pwd)"

# Logo sources and lockups -> assets/logo
mkdir -p "$R/assets/logo/android" "$R/assets/logo/glyph" "$R/assets/logo/lockup" "$R/assets/logo/source/fonts"
cp "$B"/master/* "$R/assets/logo/"
cp "$B"/android/source/*.svg "$R/assets/logo/android/"
cp "$B"/android/play-store-512.png "$R/assets/logo/android/"
cp "$B"/ios/AppIcon-1024-master.png "$R/assets/logo/"
cp "$B"/glyph/* "$R/assets/logo/glyph/"
cp "$B"/lockup/* "$R/assets/logo/lockup/"
cp "$B"/source/*.py "$R/assets/logo/source/"
cp "$B"/source/fonts/* "$R/assets/logo/source/fonts/"
cp "$B"/README.md "$R/assets/logo/README.md"

# UI glyph SVGs -> packages/ui/src/icons
mkdir -p "$R/packages/ui/src/icons"
cp "$B"/glyph/*.svg "$R/packages/ui/src/icons/"

# iOS (Capacitor shell)
IOS="$R/apps/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset"
rm -rf "$IOS" && mkdir -p "$IOS"
cp "$B"/ios/AppIcon.appiconset/* "$IOS/"

# Android (Capacitor shell): mipmaps, adaptive XML, background colour
RES="$R/apps/mobile/android/app/src/main/res"
for d in "$B"/android/res/*/; do
  name="$(basename "$d")"
  mkdir -p "$RES/$name"
  cp "$d"* "$RES/$name/"
done
# Template launcher drawables are superseded by the mipmap foreground/background colour.
rm -f "$RES/drawable/ic_launcher_background.xml" "$RES/drawable-v24/ic_launcher_foreground.xml"
rmdir "$RES/drawable-v24" 2>/dev/null || true

# Web: favicons at the root, PWA icons under /icons
WEB="$R/apps/web/public"
mkdir -p "$WEB/icons"
cp "$B"/favicon/* "$WEB/"
cp "$B"/pwa/*.png "$B"/pwa/maskable.svg "$WEB/icons/"

# Tauri
ICONS="$R/apps/desktop/src-tauri/icons"
rm -rf "$ICONS" && mkdir -p "$ICONS"
cp "$B"/desktop/dasignature.ico "$ICONS/icon.ico"
cp "$B"/desktop/dasignature.icns "$ICONS/icon.icns"
cp "$B"/desktop/dasignature.png "$ICONS/icon.png"
cp "$B"/desktop/png/dasignature-32.png "$ICONS/32x32.png"
cp "$B"/desktop/png/dasignature-128.png "$ICONS/128x128.png"
cp "$B"/desktop/png/dasignature-256.png "$ICONS/128x128@2x.png"

echo "Brand assets placed from $B"
