#!/usr/bin/env bash
# Build the fork and drop both consumable tarballs into a destination dir
# (typically Paragon-desktop's vendor/). Usage: scripts/pack-paragon.sh <dest-dir>
set -euo pipefail
DEST="${1:?usage: pack-paragon.sh <dest-vendor-dir>}"
cd "$(dirname "$0")/.."
mkdir -p "$DEST"
npm run build
ROOT_TGZ=$(npm pack --pack-destination "$DEST" | tail -1)
CLIENT_TGZ=$(cd client && npm pack --pack-destination "$DEST" | tail -1)
echo "packed: $DEST/$ROOT_TGZ"
echo "packed: $DEST/$CLIENT_TGZ"
