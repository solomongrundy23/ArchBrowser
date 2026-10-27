#!/usr/bin/env bash
# Сборка ArchBrowser для Apple Silicon (arm64).
# Запускать на macOS: bash scripts/build-mac-arm64.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Ошибка: macOS-сборку нужно запускать на macOS." >&2
  exit 1
fi

if [ "$(uname -m)" != "arm64" ]; then
  echo "Внимание: вы не на Apple Silicon. Соберётся arm64-приложение," >&2
  echo "но запустить его на этом Mac не получится." >&2
fi

if [ ! -d node_modules ]; then
  npm ci
fi

# Xray для macOS arm64. Без него браузер соберётся, но VPN не заработает.
if [ ! -f resources/xray/xray ]; then
  echo "Скачиваю Xray-core для macOS arm64…"
  tmpdir="$(mktemp -d)"
  curl -L --fail -o "$tmpdir/xray.zip" \
    "https://github.com/XTLS/Xray-core/releases/latest/download/Xray-macos-arm64-v8a.zip"
  unzip -o "$tmpdir/xray.zip" -d "$tmpdir/xray"
  cp "$tmpdir/xray/xray" resources/xray/xray
  rm -rf "$tmpdir"
fi
chmod +x resources/xray/xray
xattr -dr com.apple.quarantine resources/xray/xray 2>/dev/null || true

npm run dist:mac
ls -lh dist/*.dmg
