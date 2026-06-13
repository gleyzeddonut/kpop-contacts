#!/usr/bin/env bash
#
# Build the signed + notarized Briefs DMG OUTSIDE iCloud Drive.
#
# Why: this project lives in iCloud Drive, which attaches extended attributes
# (com.apple.FinderInfo, quarantine, etc.) to files. codesign rejects those with
# "resource fork, Finder information, or similar detritus not allowed". Building in
# a plain local folder avoids it. The DMG is copied back to ./dist at the end.
#
# Usage:
#   export APPLE_ID="firen00770@yahoo.com"
#   export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
#   export APPLE_TEAM_ID="K7VM2MP885"
#   ./build-dmg.sh
#
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
BUILD="$HOME/.briefs-build"   # local, non-iCloud, persists node_modules between runs

echo "▸ Syncing source to $BUILD (outside iCloud)…"
mkdir -p "$BUILD"
# Copy everything needed (incl. apikey.local.js, build/, icon-export/) but never
# node_modules or dist. --delete keeps it clean; excluded dirs are preserved.
rsync -a --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  "$SRC"/ "$BUILD"/

cd "$BUILD"

echo "▸ Installing deps (fast if already present)…"
npm install --no-audit --no-fund --silent

echo "▸ Stripping extended attributes…"
xattr -cr . || true

echo "▸ Building signed + notarized DMG…"
npm run dist

echo "▸ Copying DMG back to $SRC/dist/…"
mkdir -p "$SRC/dist"
cp "$BUILD"/dist/*.dmg "$SRC/dist/"

echo "✓ Done. DMG is in: $SRC/dist/"
ls -lh "$SRC"/dist/*.dmg
