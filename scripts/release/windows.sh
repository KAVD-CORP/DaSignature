#!/bin/sh
# Cross-builds the Windows NSIS installer from Linux (PM #63): cargo-xwin (MSVC target), makensis,
# lld. Unsigned, per-user install, WebView2 bootstrapper embedded (tauri.windows.conf.json).
# SQLCipher's crypto provider on Windows is the vendored LibTomCrypt (src-tauri/vendor/libtomcrypt).
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT/apps/desktop"
export LIBSQLITE3_FLAGS="-DSQLCIPHER_CRYPTO_LIBTOMCRYPT"
# clang-cl prepends options from CL (_CL_ would land after cc's "--"); only SQLCipher needs <tomcrypt.h>.
export CL="-I$ROOT/apps/desktop/src-tauri/vendor/libtomcrypt/src/headers"
pnpm tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --config src-tauri/tauri.windows.conf.json
ls -la src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/
