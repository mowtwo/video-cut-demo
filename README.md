# video-cut-demo

面向非专业用户的本地自动视频混剪 App。上传视频 → 自动分割素材 → 选混剪模板 → ffmpeg 拼接出片 →（可选 AI refine）→ 预览/下载。

> 架构与实现设计：[`docs/DESIGN.md`](docs/DESIGN.md)　·　开发进度：[`docs/PROGRESS.md`](docs/PROGRESS.md)

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vite + React + TS + Tailwind v4 + Radix (`apps/web`) |
| 编排后端 | Node + Hono + SQLite (`apps/api`) |
| ffmpeg 执行 | Go + Gin 微服务 (`svc/render`) |
| 字幕(可选) | faster-whisper Docker (`svc/asr`) |
| 契约 | `packages/shared` (Zod) · `packages/db` (node:sqlite + 迁移) |
| Monorepo | pnpm workspaces + Turborepo |

## 本地开发

前置：Node ≥20、pnpm、Go ≥1.26、ffmpeg、(可选) Docker。

```bash
pnpm install
cp .env.example .env        # 按需填 ANTHROPIC_API_KEY / ASR_URL

# 起前端 + 后端 (turbo 并行)
pnpm dev

# 另开一个终端起 Go 渲染服务
pnpm render:dev

# (可选) 字幕服务
docker compose up asr
```

- web: http://127.0.0.1:5173
- api: http://127.0.0.1:8787 （`/health`、`/capabilities`）
- render: http://127.0.0.1:8790 （`/health`、`/probe`）

### 可选资源与降级

一切可选项缺失时自动跳过、不影响核心出片：

- **BGM / 卡点**：把一个 `bgm.mp3` 放到 `data/assets/bgm.mp3`，启用 BGM 与转场(xfade)。卡点需要 `aubio`（`brew install aubio`），缺失则降级为固定节奏。
- **大字标题 / 字幕**：需要 ffmpeg 构建含 `libfreetype`（drawtext）和 `libass`（ass）。macOS 的精简 `ffmpeg` 不含，装全功能版：`brew install ffmpeg-full`（keg-only），然后在 `.env` 设 `FFMPEG_BIN=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`（及 `FFPROBE_BIN`）。`render` 启动会探测，缺失则自动跳过文字。
- **自动字幕**：`docker compose up asr` 起 faster-whisper，并在 `.env` 设 `ASR_URL=http://127.0.0.1:9000`。
- **AI 优化**：`.env` 设 `ANTHROPIC_API_KEY`。

## 目录

```
apps/web        前端
apps/api        Hono 编排 API + SQLite + 队列(后续) + 模板引擎(后续)
svc/render      Go ffmpeg 微服务
packages/shared 跨服务 Zod 契约 (RenderSpec / Clip / Template / Job ...)
packages/db     SQLite schema + 迁移
docs/           设计与进度文档
data/           运行时数据 (媒体/sqlite/输出, 已 gitignore)
```
