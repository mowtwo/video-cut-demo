#!/usr/bin/env bash
# 停止本地全栈（不动 asr 容器；如需停 asr：docker compose down）
cd "$(dirname "$0")/.."
pkill -f 'svc/render/bin/render' 2>/dev/null && echo "stopped render" || true
pkill -f 'tsx .*apps/api/src/index.ts' 2>/dev/null && echo "stopped api" || true
pkill -f 'apps/web/node_modules/.bin/vite' 2>/dev/null && echo "stopped web" || true
echo "done. (asr 容器如需停止：docker compose down)"
