# LibTomCrypt 1.18.2 (vendored, Windows builds only)

Upstream: https://github.com/libtom/libtomcrypt/releases/tag/v1.18.2 (`crypt-1.18.2.tar.xz`).
Only the parts SQLCipher uses (AES, SHA-1/SHA-2, HMAC, PKCS #5, CBC, Fortuna, misc helpers, headers), plus LICENSE
(public domain / WTFPL dual license).

Why: on Windows, SQLCipher uses LibTomCrypt as its crypto provider instead of OpenSSL, because
vendored OpenSSL can't be cross-built for MSVC from Linux (its Configure needs a Windows perl
and nmake). `build.rs` compiles this into a static library for `x86_64-pc-windows-msvc`. Linux
and macOS keep OpenSSL. The database format is the same either way (SQLCipher 4 defaults:
AES-256-CBC, HMAC-SHA512, PBKDF2-HMAC-SHA512), and see docs/decisions.md E-96.
