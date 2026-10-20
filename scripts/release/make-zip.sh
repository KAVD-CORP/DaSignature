#!/bin/sh
# Assembles the PM #61 release zip from already-built artifacts (see docs/decisions.md E-106).
# Usage: sh scripts/release/make-zip.sh <shared-root> <out.zip>
# Expects: web dist, Linux deb/rpm + lean AppImage, Windows NSIS setup, Android release APKs.
set -eu
REPO=$(cd "$(dirname "$0")/../.." && pwd)
SHARED=${1:?shared root}
OUT=${2:?output zip}
VER=$(node -p "require('$REPO/apps/desktop/src-tauri/tauri.conf.json').version")
T="$REPO/apps/desktop/src-tauri/target"
APK="$REPO/apps/mobile/android/app/build/outputs/apk/release"
STAGE=$(mktemp -d)/DaSignature-$VER
mkdir -p "$STAGE"/windows "$STAGE"/android "$STAGE"/linux "$STAGE"/web "$STAGE"/docs/qa

# Source: a clone carries the full history and only tracked files (no node_modules/target/dist).
git clone -q --no-hardlinks "$REPO" "$STAGE/source"
git -C "$STAGE/source" remote remove origin

cp "$T/x86_64-pc-windows-msvc/release/bundle/nsis/DaSignature_${VER}_x64-setup.exe" "$STAGE/windows/"
cp "$T/release/bundle/deb/DaSignature_${VER}_amd64.deb" "$STAGE/linux/"
cp "$T/release/bundle/rpm/DaSignature-${VER}-1.x86_64.rpm" "$STAGE/linux/"
cp "$T/release/bundle/appimage-lean/DaSignature_${VER}_amd64.AppImage" "$STAGE/linux/"
for abi in arm64-v8a armeabi-v7a x86_64 universal; do
  cp "$APK/app-$abi-release.apk" "$STAGE/android/DaSignature-$VER-$abi.apk"
done

cp -r "$REPO/apps/web/dist" "$STAGE/web/dist"
cp "$REPO/scripts/release/web/server.mjs" "$REPO/scripts/release/web/run.sh" \
  "$REPO/scripts/release/web/run.bat" "$STAGE/web/"
chmod +x "$STAGE/web/run.sh" "$STAGE/linux/"*.AppImage

cp -r "$SHARED/design/brand" "$STAGE/brand"

cp "$REPO/README.md" "$REPO/CONTRIBUTING.md" "$REPO/SECURITY.md" "$REPO/THIRD_PARTY_NOTICES.md" \
  "$REPO/LICENSE" "$STAGE/docs/" 2>/dev/null || true
cp -r "$REPO/docs/"* "$STAGE/docs/"
awk '/^## Run on PC/{p=1} /^## Android and iOS/{p=0} p' "$REPO/README.md" > "$STAGE/docs/run-on-pc.md"
cp "$SHARED/qa/TEST_PLAN.md" "$SHARED/qa/"M*_EXIT_CHECKLIST.md "$STAGE/docs/qa/"
[ -d "$SHARED/release-evidence" ] && cp -r "$SHARED/release-evidence" "$STAGE/docs/qa/release-evidence"
cp "$REPO/render.yaml" "$STAGE/"

cat > "$STAGE/README-FIRST.txt" <<TXT
DaSignature $VER - sign PDFs on your own device. Nothing is uploaded; the apps make no
network requests at runtime.

  windows/   DaSignature_${VER}_x64-setup.exe  (per-user install; unsigned, so SmartScreen may
             ask: More info > Run anyway. Check the hash in SHA256SUMS.txt first.)
  linux/     .deb (Debian/Ubuntu), .rpm (Fedora/openSUSE), .AppImage (any distro with
             WebKitGTK 4.1; chmod +x it). The key is kept in the desktop keyring.
  android/   DaSignature-$VER-arm64-v8a.apk for most phones; universal works everywhere.
             The app requests no permissions, not even Internet.
  web/       No install: run.bat (Windows) or ./run.sh (macOS/Linux), needs Node.js 18+.
             Opens http://127.0.0.1:4173 in your browser; the server only listens locally.
             web/dist can also be hosted on any static host.
  source/    Full git repository (history included). macOS and iOS ship as source only;
             see docs/README.md.
  brand/     Logo, icons and brand guide.
  docs/      run-on-pc.md, README, SPEC, decisions, privacy, test plan and QA checklists,
             deploy-render.md (Render Static Site via render.yaml).
  render.yaml  Render Blueprint for the web app (see docs/deploy-render.md).

Built from commit $(git -C "$REPO" rev-parse --short HEAD) on $(date -u +%Y-%m-%d).
TXT

(cd "$STAGE" && find . -type f ! -path './source/*' ! -name SHA256SUMS.txt -print0 | sort -z \
  | xargs -0 sha256sum > SHA256SUMS.txt)
rm -f "$OUT"
(cd "$STAGE" && zip -qr -X "$OUT" .)
ls -l "$OUT"
