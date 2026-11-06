#!/usr/bin/env bash
# Builds function.zip for Lambda (arm64, Node 22). sharp ships native binaries, so they are installed
# for linux/arm64 into a staging dir instead of being bundled by esbuild.
set -euo pipefail
cd "$(dirname "$0")/.."
version="$(node -p "require('./package.json').dependencies.sharp")"
rm -rf .stage function.zip && mkdir -p .stage
cp dist/index.mjs dist/index.mjs.map .stage/
(
  cd .stage
  echo '{"name":"stage","private":true,"type":"module"}' > package.json
  npm install --no-audit --no-fund --omit=dev --os=linux --cpu=arm64 --libc=glibc "sharp@${version}"
  rm -rf node_modules/.package-lock.json package.json package-lock.json
  zip -qr ../function.zip .
)
rm -rf .stage
echo "built function.zip ($(du -h function.zip | cut -f1))"
