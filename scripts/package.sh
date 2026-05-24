#!/usr/bin/env bash
# scripts/package.sh — Produce the CWS upload artifact.
#
# Usage: bash scripts/package.sh [VERSION]
#   VERSION defaults to the version field in manifest.json.
#
# Output: dist/stayproof-vVERSION.zip
#
# Matches exactly the 16-file manifest from dist/stayproof-v1.0.4.zip
# (verified ground truth of the CWS-submitted package).

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
VERSION="${1:-$(node -e "process.stdout.write(require('./manifest.json').version)")}"
OUTPUT="$REPO_ROOT/dist/stayproof-v${VERSION}.zip"

mkdir -p "$REPO_ROOT/dist"
cd "$REPO_ROOT"

# Remove stale archive if present
rm -f "$OUTPUT"

# Build archive — file list matches dist/stayproof-v1.0.4.zip exactly
zip -X "$OUTPUT" \
  manifest.json \
  src/background/service-worker.js \
  src/content/google-maps/inject.js \
  src/shared/scoring.js \
  src/shared/scoring-config.js \
  src/shared/name-matching.js \
  src/shared/xref-candidates.js \
  src/shared/currency.js \
  src/search/search.html \
  src/search/search.css \
  src/search/search.js \
  src/icons/icon16.png \
  src/icons/icon48.png \
  src/icons/icon128.png \
  src/vendor/leaflet/leaflet.min.css \
  src/vendor/leaflet/leaflet.min.js

echo "Created: $OUTPUT"
echo "Files: $(unzip -l "$OUTPUT" | tail -1)"
