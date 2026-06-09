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

## 下一步：M1 上传与预览
- 上传 multipart → 落 `data/media`
- job(probe) 调 render `/probe` 回填 sources
- job(thumb) 抽封面
- 前端上传页：原视频播放器 + 缩略图 + 时长/分辨率

## 里程碑总览
| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | 脚手架 + 契约 | ✅ 完成 |
| M1 | 上传与预览 | ⬜ |
| M2 | 自动分割(scdet)+高光评分 | ⬜ |
| M3 | 高光模板核心闭环出片 | ⬜ |
| M4 | 五模板+多画幅+大字标题 | ⬜ |
| M5 | 卡点(aubio beat-sync) | ⬜ |
| M6 | 自动字幕(asr) | ⬜ |
| M7 | AI refine | ⬜ |
