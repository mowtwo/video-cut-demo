#!/usr/bin/env bash
# 一键启动本地全栈：render(Go) + api(Hono) + web(Vite)，可选 asr(faster-whisper)。
# 用法：
#   ./scripts/start.sh           # 起 render+api+web；docker 在跑则自动带上 asr
#   ./scripts/start.sh --no-asr  # 不启动 asr
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
DATA="$ROOT/data"

# 读取 .env（若存在）
if [ -f .env ]; then set -a; . ./.env; set +a; fi

# ffmpeg：优先 .env 的 FFMPEG_BIN；否则用全功能 ffmpeg-full（若装了）；再否则系统 ffmpeg
FFFULL=/opt/homebrew/opt/ffmpeg-full/bin
: "${FFMPEG_BIN:=$([ -x "$FFFULL/ffmpeg" ] && echo "$FFFULL/ffmpeg" || echo ffmpeg)}"
: "${FFPROBE_BIN:=$([ -x "$FFFULL/ffprobe" ] && echo "$FFFULL/ffprobe" || echo ffprobe)}"
: "${API_PORT:=8787}"; : "${RENDER_PORT:=8790}"; : "${WEB_PORT:=5173}"
: "${RENDER_HWACCEL:=videotoolbox}"

mkdir -p "$DATA/assets" "$DATA/media" "$DATA/thumbs" "$DATA/out"

# 可选 asr：docker 在跑且未禁用，则起容器并接上 ASR_URL
if [ "${1:-}" != "--no-asr" ] && docker info >/dev/null 2>&1; then
  echo "[start] docker 在跑，启动 asr(faster-whisper)…"
  docker compose up -d asr >/dev/null 2>&1 || echo "[start] asr 启动失败，跳过(字幕功能降级)"
  export ASR_URL="${ASR_URL:-http://127.0.0.1:9000}"
fi

echo "[start] render @ $RENDER_PORT  (ffmpeg=$FFMPEG_BIN)"
FFMPEG_BIN="$FFMPEG_BIN" FFPROBE_BIN="$FFPROBE_BIN" RENDER_PORT="$RENDER_PORT" RENDER_HWACCEL="$RENDER_HWACCEL" \
  nohup "$ROOT/svc/render/bin/render" > "$ROOT/.render.log" 2>&1 & disown

echo "[start] api @ $API_PORT"
API_PORT="$API_PORT" DATA_DIR="$DATA" RENDER_URL="http://127.0.0.1:$RENDER_PORT" RENDER_HWACCEL="$RENDER_HWACCEL" \
  ASR_URL="${ASR_URL:-}" AI_API_KEY="${AI_API_KEY:-}" AI_BASE_URL="${AI_BASE_URL:-https://api.openai.com/v1}" AI_MODEL="${AI_MODEL:-gpt-4o-mini}" \
  nohup "$ROOT/apps/api/node_modules/.bin/tsx" "$ROOT/apps/api/src/index.ts" > "$ROOT/.api.log" 2>&1 & disown

echo "[start] web @ $WEB_PORT"
( cd "$ROOT/apps/web" && API_PORT="$API_PORT" nohup "$ROOT/apps/web/node_modules/.bin/vite" --port "$WEB_PORT" --host 127.0.0.1 > "$ROOT/.web.log" 2>&1 & disown )

sleep 3
echo "------------------------------------------------------------"
echo "  Web:    http://localhost:$WEB_PORT"
echo "  API:    http://127.0.0.1:$API_PORT   (日志 .api.log)"
echo "  Render: http://127.0.0.1:$RENDER_PORT (日志 .render.log)"
[ -n "${ASR_URL:-}" ] && echo "  ASR:    $ASR_URL (首次需拉模型，稍等)"
echo "  停止：  ./scripts/stop.sh"
echo "------------------------------------------------------------"
