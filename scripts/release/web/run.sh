#!/bin/sh
# Starts DaSignature in your browser from this folder (needs Node.js 18 or later).
# NO_BROWSER=1 ./run.sh only starts the server; PORT=8080 ./run.sh picks another port.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "DaSignature needs Node.js 18 or later: https://nodejs.org (install it, then run this again)."
  exit 1
fi
if [ -n "$NO_BROWSER" ]; then exec node server.mjs "${PORT:-4173}"; fi
exec node server.mjs "${PORT:-4173}" --open
