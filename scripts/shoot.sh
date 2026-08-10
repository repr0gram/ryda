#!/usr/bin/env bash
# Capture a route in both themes against a running dev server.
#
#   ./scripts/shoot.sh /design            -> out/design-{light,dark}.png
#   ./scripts/shoot.sh /rides/123 1440 3000
#
# Themes are pinned with ?theme=, which the inline init script in
# src/lib/theme.ts honours before first paint. Byte-identical output for the
# two themes means the pin silently failed — check that, don't trust the files.
set -euo pipefail

ROUTE="${1:-/design}"
WIDTH="${2:-1280}"
HEIGHT="${3:-2100}"
BASE="${BASE_URL:-http://localhost:3000}"
OUT="${OUT_DIR:-out}"
CHROME="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

[ -x "$CHROME" ] || { echo "Chrome not found at: $CHROME (set CHROME_BIN)" >&2; exit 1; }
curl -sf -o /dev/null "$BASE$ROUTE" || { echo "No dev server at $BASE" >&2; exit 1; }

mkdir -p "$OUT"
NAME="$(echo "${ROUTE#/}" | tr '/' '-')"; NAME="${NAME:-index}"

sep=$([[ "$ROUTE" == *"?"* ]] && echo "&" || echo "?")

for theme in light dark; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --virtual-time-budget=5000 \
    --window-size="$WIDTH,$HEIGHT" \
    --screenshot="$OUT/$NAME-$theme.png" \
    "$BASE$ROUTE${sep}theme=$theme" >/dev/null 2>&1
  echo "  $OUT/$NAME-$theme.png"
done

if [ "$(shasum -a 256 "$OUT/$NAME-light.png" | cut -d' ' -f1)" = \
     "$(shasum -a 256 "$OUT/$NAME-dark.png"  | cut -d' ' -f1)" ]; then
  echo "WARNING: both themes rendered identically — the theme pin did not apply." >&2
  exit 1
fi
echo "OK: themes differ."
