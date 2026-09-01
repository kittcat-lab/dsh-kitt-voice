#!/bin/sh
# Start the companion window. See start.cmd for why Electron is not bundled.
set -e
cd "$(dirname "$0")"

if [ -n "$DSH_KITT_ELECTRON" ]; then exec "$DSH_KITT_ELECTRON" .; fi
if [ -x node_modules/electron/dist/electron ]; then exec node_modules/electron/dist/electron .; fi
if command -v npx >/dev/null 2>&1; then exec npx --no-install electron .; fi

echo "The companion window needs Electron, and none was found."
echo "Either run 'npm install' here, or set DSH_KITT_ELECTRON to one you have."
exit 1
