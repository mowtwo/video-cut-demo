# 开发进度

> 里程碑定义见 [`DESIGN.md`](DESIGN.md) §14。本文件随开发滚动更新。

## 当前状态：M0 脚手架 ✅ 完成

### 已完成
- [x] monorepo 骨架：pnpm workspaces + Turborepo（`package.json` / `turbo.json` / `pnpm-workspace.yaml`）
- [x] `.gitignore` / `.env.example`
- [x] `packages/shared`：Zod 契约 —— `common` / `domain`(Project/Source/Clip/Analysis/Render) / `renderspec`(RenderSpec) / `template`(TemplateDef) / `job`(Job/JobEvent/Capabilities)
- [x] `packages/db`：**node:sqlite**(Node 内置) + WAL + **版本化迁移**（projects/sources/clips/analyses/renders/jobs/job_events）
- [x] `apps/api`：Hono 空壳 —— `/health`、`/capabilities`（探测 AI/ASR/hwaccel）
- [x] `apps/web`：Vite+React+TS+Tailwind v4+Radix 空壳 —— 向导步骤占位 + 后端连通状态徽章
- [x] `svc/render`：Go+Gin 空壳 —— `/health`、`/probe`(真实 ffprobe)、`/jobs/:id` 占位
- [x] `docker-compose.yml`：asr(faster-whisper) 现成服务；api/render/web 待补 Dockerfile
- [x] `README.md`

### 验证结果（M0 完成标准，全绿）
- [x] `pnpm install` 成功，无原生编译
- [x] `pnpm -r typecheck` 通过（shared/db/api/web）
- [x] `cd svc/render && go mod tidy && go build && go vet` 通过（gin 经代理拉取）
- [x] 运行时冒烟：render `/health`、api `/health` + `/capabilities` 均 200；SQLite 自动建库 + WAL
- [x] 迁移幂等性测试：重复打开数据保留、user_version 稳定在 1

### M0 期间的两个技术决策（已更新进 DESIGN.md）
1. **放弃 better-sqlite3，改用 Node 24+ 内置 `node:sqlite`**：Node 26 的 ABI(v147) 太新，better-sqlite3 无预编译包、源码编译不可靠；内置方案零原生依赖、零编译。
2. **版本化迁移系统**（`packages/db/src/migrations.ts`）：`PRAGMA user_version` 记录版本，启动时事务内增量应用，**只进不退、禁止 DROP 重建**，重复启动不覆盖数据。改表只追加新 migration。

## M1–M7 全业务流程已实现并端到端跑通 ✅

### 端到端验证（2026-06-09，真实出片）
用 ffmpeg 生成的 15s 测试视频 + BGM，走完整 API 链路：
- 上传 → probe(15s) → 封面缩略图 ✅
- 自动分割 → clips(8s-max 分块，无场景切点时降级) + 评分 + 每段缩略图 ✅
- 渲染 highlight/9:16/bgm → **1080×1920 h264+aac 2.6s**（xfade + bgm + crop + videotoolbox）✅
- 渲染 dialogue/original/无bgm → **1280×720 6s**（concat + 原声拼接）✅
- 前端 vite 构建/serve/`/api` 代理全通 ✅

### 已实现
- **svc/render(Go)**：probe / thumbnail / scene(scdet) / beat(aubio) / render(filter_complex: scale·crop·pad·blur_pad / xfade·concat / drawtext / ass / bgm / 多画幅 / videotoolbox·libx264 / -progress 进度) / burnsub。启动探测滤镜可用性，优雅降级。
- **apps/api(Hono)**：projects/sources/clips/render 全 CRUD、SQLite 队列 + worker、SSE 进度、模板引擎(5 模板 + compile→RenderSpec)、AI refine(可选)、ASR→ASS(可选)。
- **apps/web(React)**：上传 / 素材(网格·排序·勾选·预览) / 模板(5选+画幅+开关) / 生成(SSE进度) / 结果(标题·模板·时长·下载·regenerate) 完整向导。

### 已知降级（本机 ffmpeg 限制，见 docs + 记忆）
- 本机 brew ffmpeg 缺 **libfreetype/libass** → 大字标题(drawtext)、字幕(ass) 自动跳过。装全功能 ffmpeg 或用 Docker render 镜像即可启用。
- 本机无 **aubio** → 卡点降级为固定节奏。
- 未配 ANTHROPIC_API_KEY / ASR_URL → AI、字幕 跳过（不影响主流程）。

### 里程碑总览
| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | 脚手架 + 契约 | ✅ |
| M1 | 上传与预览 | ✅ |
| M2 | 自动分割 + 高光评分 | ✅ |
| M3 | 模板引擎 + 核心闭环出片 | ✅ |
| M4 | 五模板 + 多画幅 + 大字标题* | ✅ (*标题受 ffmpeg 限制降级) |
| M5 | 卡点 beat-sync* | ✅ (*本机无 aubio 降级) |
| M6 | 自动字幕* | ✅ (*受 ffmpeg/ASR 限制降级) |
| M7 | AI refine | ✅ (无 key 降级) |

### 后续可打磨（bug/增强）
- 装全功能 ffmpeg（libfreetype+libass）后回归测试大字标题/字幕烧录。
- 高光评分升级为真实运动/音频能量分析。
- svc/render Dockerfile + compose 完整编排；进程组取消(Setpgid)。
- 前端 HTML5 拖拽排序替代上/下按钮。
