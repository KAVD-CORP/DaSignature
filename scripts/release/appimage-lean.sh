#!/bin/sh
# Lean AppImage (PM #6 budget < 20 MB): the Tauri binary + desktop entry + icon, using the host's
# WebKitGTK 4.1 (libwebkit2gtk-4.1-0, preinstalled on current Ubuntu/Fedora/Debian desktops)
# instead of bundling ~300 MB of GTK/WebKit libraries like `tauri build --bundles appimage` does.
# Run after `pnpm --filter @dasignature/desktop tauri build`. Needs appimagetool on PATH or $APPIMAGETOOL.
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
REL="$ROOT/apps/desktop/src-tauri/target/release"
VERSION=$(node -p "require('$ROOT/apps/desktop/src-tauri/tauri.conf.json').version")
OUT=${1:-"$REL/bundle/appimage-lean"}
TOOL=${APPIMAGETOOL:-appimagetool}
DIR="$OUT/DaSignature.AppDir"
rm -rf "$DIR" && mkdir -p "$DIR/usr/bin" "$DIR/usr/share/applications" "$DIR/usr/share/icons/hicolor/128x128/apps"
cp "$REL/dasignature" "$DIR/usr/bin/dasignature"
cp "$ROOT/apps/desktop/src-tauri/icons/128x128.png" "$DIR/usr/share/icons/hicolor/128x128/apps/dasignature.png"
cp "$ROOT/apps/desktop/src-tauri/icons/128x128.png" "$DIR/dasignature.png"
cat > "$DIR/dasignature.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=DaSignature
Comment=Sign PDFs privately, on your device.
Exec=dasignature %F
Icon=dasignature
Categories=Office;
MimeType=application/pdf;
Terminal=false
DESK
cp "$DIR/dasignature.desktop" "$DIR/usr/share/applications/"
cat > "$DIR/AppRun" <<'RUN'
#!/bin/sh
HERE=$(dirname "$(readlink -f "$0")")
if ! PATH="$PATH:/sbin:/usr/sbin" ldconfig -p 2>/dev/null | grep -q libwebkit2gtk-4.1.so.0; then
  echo "DaSignature needs WebKitGTK 4.1 (Debian/Ubuntu: sudo apt install libwebkit2gtk-4.1-0; Fedora: sudo dnf install webkit2gtk4.1)." >&2
fi
exec "$HERE/usr/bin/dasignature" "$@"
RUN
chmod +x "$DIR/AppRun"
ARCH=x86_64 "$TOOL" --no-appstream "$DIR" "$OUT/DaSignature_${VERSION}_amd64.AppImage"
ls -la "$OUT"/*.AppImage
