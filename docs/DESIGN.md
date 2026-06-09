# video-cut-demo · 架构与实现设计

> 面向**非专业剪辑 / 非开发者**的本地视频混剪 App。
> 核心：上传视频 → 自动分割素材 → 选混剪模板 → ffmpeg 拼接出片 →（可选 AI refine）→ 预览/下载。
> 设计原则：清晰易用、无过度设计、本地完全可调试、AI 一律可选且可降级、尽量复用现成高性能方案。

---

## 0. 关键技术决策（已确认）

| 维度 | 决策 | 理由 |
|---|---|---|
| 前端 | Vite + React + TS + Tailwind + Radix | 需求指定 |
| Monorepo | pnpm workspaces + Turborepo | 标准、缓存快、单语言主导 |
| 编排后端 | **Node.js + Hono** | 单人本地、和前端共享 TS 类型、AI SDK 生态最全、SSE 一等支持 |
| ffmpeg 执行 | **独立 Go (Gin) 微服务** `svc/render` | 并发跑多个 ffmpeg、进程池/取消/进度，Go 在并发进程管理上最合适（需求第15点） |
| 分析（场景/卡点） | **纯 CLI：ffmpeg `scdet` + `aubio`**，零 Python | 都能进 Go 容器，不再引入第三种语言 |
| 数据库 | **Node 24+ 内置 `node:sqlite`**（WAL）+ 内置作业队列 | 零原生依赖/零编译（不用 better-sqlite3，避免 Node 26 ABI 编译问题）、ACID、崩溃可恢复，单用户够用 |
| 迁移 | `PRAGMA user_version` 版本化增量迁移，只进不退 | 重复启动不覆盖数据；生产只能 migrate 不能 drop 重建 |
| ASR/字幕 | 现成 `faster-whisper` Docker 服务 `svc/asr` | 可选、可降级；不自己维护 Python 依赖 |
| AI refine | Anthropic Client（`claude-opus-4-8` / `claude-sonnet-4-6`） | 可选，无 key 跳过，不阻塞主流程 |
| 进度推送 | SSE（ffmpeg `-progress` → 解析 → 转发） | 单向、自动重连，比 WebSocket 简单 |
| 出片渲染 | ffmpeg `-filter_complex`（concat / xfade / overlay / drawtext / ass / scale+pad/crop） | 现成、最快 |

**本地工具链现状**：ffmpeg 8.0.1 ✓、Node 26 ✓、pnpm 11 ✓、Docker 29 ✓；**Go 暂未安装（待装）**、aubio 仅在容器内。`gh` 已登录账号 `mowtwo`。

---

## 1. 系统架构

```
┌────────────────────────────────────────────────────────────────┐
│  apps/web  (Vite + React + TS + Tailwind + Radix)                │
│  上传 / 原视频预览 / clips 预览 / 模板选择 / 结果页 / 进度条       │
└───────────────▲───────────────────────────┬──────────────────────┘
                │ REST + SSE(进度)            │
┌───────────────┴───────────────────────────▼──────────────────────┐
│  apps/api  (Node + Hono)  —— 编排大脑                              │
│  • 工程/素材/clip/作业 状态机 (SQLite, WAL)                        │
│  • 内置作业队列 (jobs 表 + 认领循环)                               │
│  • 模板引擎：模板 + 分析结果 → RenderSpec(JSON)                    │
│  • AI Client (可选, fallback)                                     │
│  • SSE：把 render/asr 的进度转发给前端                            │
└──────┬───────────────────────┬────────────────────┬──────────────┘
       │ HTTP(RenderSpec)       │ HTTP               │ HTTP(可选)
┌──────▼──────────────┐ ┌──────▼──────────┐ ┌────────▼───────────┐
│ svc/render (Go+Gin) │ │ (复用 render)   │ │ svc/asr (可选)      │
│ ffmpeg 进程池/并发   │ │  分析:           │ │ faster-whisper      │
│ • probe(ffprobe)    │ │  • scene: scdet  │ │ Docker 现成镜像     │
│ • thumbnail         │ │  • beat: aubio   │ │ /asr → SRT/JSON     │
│ • clip 切片          │ │                  │ │ 无服务则跳过字幕    │
│ • render(filter)     │ └──────────────────┘ └────────────────────┘
│ • burn subtitle      │
│ -progress pipe → SSE │      所有服务共享一个 ./data 卷(媒体文件 + sqlite)
└──────────────────────┘
```

**进程隔离而非网络微服务的"教条"**：`svc/render` 是独立 OS 服务（Go），但和 `api` 通过 HTTP + 共享文件卷通信。这样 ffmpeg 崩溃/吃满 CPU 不会拖垮编排层，也便于"在宿主机跑 ffmpeg 拿 VideoToolbox 硬件加速、其余进 Docker"。

> **Mac 硬件加速注意**：Docker on Mac **拿不到 VideoToolbox**（无 GPU 透传），容器内只能软编 `libx264`。因此 `svc/render` 支持两种部署：①容器内 `libx264`（可移植，慢）；②宿主机直跑 `h264_videotoolbox`（快一个量级，推荐本地开发）。通过 `RENDER_HWACCEL=videotoolbox|none` 切换。

---

## 2. Monorepo 结构

```
video-cut-demo/
├─ pnpm-workspace.yaml          # packages: apps/*, packages/*, svc/render(go 用 shim)
├─ turbo.json                   # build/dev/lint/test 流水线
├─ package.json                 # root devDeps: turbo, typescript
├─ docker-compose.yml           # 一键起全栈 (api, render, asr, web)
├─ .env.example
├─ data/                        # 运行时数据卷(gitignore): media/, thumbs/, out/, app.db
├─ apps/
│  ├─ web/                      # 前端
│  └─ api/                      # Hono 编排 API + SQLite + 队列 + 模板引擎 + AI
├─ svc/
│  └─ render/                   # Go + Gin ffmpeg 微服务 (含 ffmpeg + aubio CLI)
│     ├─ go.mod                 # 独立 go module
│     └─ package.json           # shim: scripts.dev=`go run .` 让 turbo 能编排
└─ packages/
   ├─ shared/                   # ★ 跨服务的 TS 类型 + Zod schema: RenderSpec/Clip/Template/Job
   ├─ db/                       # SQLite schema + 版本化迁移(node:sqlite)
   └─ templates/                # 5 个混剪模板的声明式定义(JSON/TS) + 编译规则
```

`packages/shared` 是**契约中心**：`RenderSpec`、`AnalysisResult`、`Template`、`Job` 都用 Zod 定义，前端、API 共享类型；Go 侧用对应的 struct（手写或由 schema 生成）保持一致。

---

## 3. 数据模型 (SQLite)

```sql
-- 工程：一次混剪任务的容器
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,        -- uuid
  title       TEXT NOT NULL,
  template_id TEXT,                    -- 选用的模板
  aspect      TEXT DEFAULT 'original', -- '9:16' | '3:4' | 'original'
  status      TEXT NOT NULL,           -- draft|analyzing|ready|rendering|done|failed
  created_at  INTEGER, updated_at INTEGER
);

-- 源视频：可多个
CREATE TABLE sources (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  filename   TEXT, path TEXT,          -- data/media/...
  duration_ms INTEGER, width INTEGER, height INTEGER, fps REAL,
  codec TEXT, has_audio INTEGER,
  thumb_path TEXT,                     -- 缩略图(封面)
  probe_json TEXT,                     -- ffprobe 原始结果
  created_at INTEGER
);

-- clips：自动分割出的素材片段（相对某个 source 的 time range）
CREATE TABLE clips (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  source_id   TEXT NOT NULL REFERENCES sources(id),
  start_ms    INTEGER NOT NULL,        -- 相对源视频
  end_ms      INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  thumb_path  TEXT,
  score       REAL,                    -- 高光评分(运动+音频能量+场景变化)
  order_index INTEGER,                 -- 前端可调整的工程内顺序
  included    INTEGER DEFAULT 1,       -- 是否纳入本次出片
  created_at  INTEGER
);

-- 分析结果缓存(场景切点、节拍点)
CREATE TABLE analyses (
  id TEXT PRIMARY KEY, project_id TEXT, source_id TEXT,
  kind TEXT,                           -- 'scene' | 'beat' | 'highlight'
  data_json TEXT,                      -- [切点ms] / [节拍ms] / [评分段]
  created_at INTEGER
);

-- 出片结果
CREATE TABLE renders (
  id TEXT PRIMARY KEY, project_id TEXT,
  spec_json TEXT,                      -- 本次用的 RenderSpec
  out_path TEXT, thumb_path TEXT,
  duration_ms INTEGER, aspect TEXT,
  template_id TEXT, ai_refined INTEGER DEFAULT 0,
  prompt TEXT,                         -- regenerate with prompt 时记录
  status TEXT, created_at INTEGER
);

-- 作业队列(队列即一张表)
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT,                           -- probe|thumb|segment|analyze|render|asr
  project_id TEXT, payload_json TEXT,
  status TEXT,                         -- queued|running|done|failed|canceled
  priority INTEGER DEFAULT 0,
  progress REAL DEFAULT 0,             -- 0..1
  worker_id TEXT, error TEXT,
  lease_until INTEGER,                 -- 心跳租约，崩溃后可重新认领
  created_at INTEGER, started_at INTEGER, finished_at INTEGER
);

CREATE TABLE job_events (              -- SSE 事件总线(进程间)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT, project_id TEXT,
  progress REAL, message TEXT, ts INTEGER
);
```

> **持久化与迁移**：用 Node 内置 `node:sqlite`（`DatabaseSync`，同步 API，零原生依赖）。建表/改表走 `packages/db/src/migrations.ts` 的版本化迁移：`PRAGMA user_version` 记录已应用版本，启动时在事务内增量应用未执行的迁移，**只进不退、禁止 DROP 重建**。改表 = 追加一条 `version+1` 的 `ALTER TABLE` 迁移，已发布迁移永不修改。

**队列认领**（WAL + 事务，`node:sqlite` 同步 API）：
```sql
UPDATE jobs SET status='running', worker_id=?, started_at=?, lease_until=?
WHERE id = (SELECT id FROM jobs WHERE status='queued'
            ORDER BY priority DESC, created_at ASC LIMIT 1)
RETURNING *;
```
崩溃恢复：启动时把 `status='running' AND lease_until < now` 的作业重置回 `queued`。

---

## 4. 核心数据流（端到端）

```
1. 上传        POST /projects/:id/sources (multipart) → 存 data/media
2. probe       job(probe): ffprobe → 写 sources(duration/wh/fps/codec)
3. 封面+缩略    job(thumb): ffmpeg 抽帧 → sources.thumb_path
   ── 此时前端已可"预览原视频 + 缩略图/时长" ──
4. 自动分割    job(segment): ffmpeg scdet 场景检测 → 写 clips(start/end/dur/thumb/score)
   ── 前端可预览每个 clip：缩略图/开始/结束/相对time range/时长，可拖动排序、勾选 ──
5. 选模板      用户选 高光/POV/剧情/人物/悬念 之一 + aspect(9:16/3:4/original)
6. 编译        api 模板引擎: Template + clips + (beat分析) → RenderSpec(JSON)
7. 渲染        job(render): POST svc/render /render {RenderSpec}
               → Go 拼 -filter_complex → ffmpeg -progress → SSE 进度
8. (可选)字幕   job(asr): svc/asr 转写 → 生成 ASS → 二次 ffmpeg burn(或合进 6 的 spec)
9. (可选)AI     refine: 调 AI 调整 RenderSpec(选段/顺序/文案) → 重渲染；无 key 则跳过
10. 结果页     renders: 标题 / 模板引用 / 预览 / 总时长 / 下载(mp4)
11. 扩展        regenerate(换随机种子重选段) / regenerate with prompt(AI)
```

每一步都是一个 `job`，前端通过 `GET /projects/:id/events` (SSE) 实时看进度。

---

## 5. 混剪模板系统 ★（本项目的核心）

### 5.1 原理（来自调研）

短视频"自动混剪/剪同款"的本质：**一个声明式模板 = 带占位槽位(slot)的时间线**。模板规定了"几个片段、各多长、什么转场、文字放哪、是否卡点"，用户素材被填进这些槽位。CapCut/剪映的 `draft_content.json` 就是 `tracks → segments`（每个 segment 有 `target_timerange` 时间线位置 + `source_timerange` 源切片 + speed + transform + effects），加一个 materials 资源池。我们借用同一模型，但**渲染引擎无关**：模板编译成中间产物 `RenderSpec`，再由 Go 翻成 ffmpeg `-filter_complex`。

参考工业标准：OpenTimelineIO（Timeline→Track→Clip/Gap/Transition，RationalTime/TimeRange，Apache-2.0）。我们的 `RenderSpec` 是它的精简实用版。

### 5.2 RenderSpec（渲染中间表示，packages/shared 用 Zod 定义）

```jsonc
{
  "canvas": { "w": 1080, "h": 1920, "fps": 30 },        // 由 aspect 决定
  "bgm":    { "src": "bgm.mp3", "gain_db": -3,
              "beats": [0.5, 1.0, 1.52, ...] },          // 可空(无卡点时)
  "segments": [
    {
      "clip_id": "c1",
      "src": "data/media/a.mp4",
      "src_in_ms": 2000, "src_dur_ms": 800,              // 取源哪一段
      "target_start_ms": 0, "target_dur_ms": 800,        // 落在时间线哪
      "speed": 1.0,
      "fit": "crop",                                     // crop|pad|blur_pad 适配画幅
      "transform": { "scale": 1.05 },
      "transition_out": { "type": "dissolve", "dur_ms": 200 }
    }
  ],
  "text_layers": [
    { "kind": "title",                                   // 大字标题
      "content": "{{title}}", "start_ms": 0, "end_ms": 2000,
      "style": { "font": "NotoSansCJKsc", "size": 120,
                 "x": "(w-tw)/2", "y": "h*0.12",
                 "anim": "grow_fadein" } },
    { "kind": "caption", "ass_path": "data/out/x.ass" }  // 字幕(由 ASR 生成)
  ],
  "output": { "format": "mp4", "vcodec": "h264", "crf": 20, "preset": "veryfast" }
}
```

映射到 ffmpeg：
- 每个 segment：`trim/atrim` 取段 → `setpts`(speed) → `scale/pad/crop`(fit, 画幅适配) → 标签
- `transition_out`：相邻片段用 `xfade transition=…:duration=…:offset=累计偏移`（offset 数学：前面所有片段时长之和 − 前面所有转场时长之和）；音频并行 `acrossfade`
- 无转场的硬切：`concat=n=N:v=1:a=1`（输入须先归一化分辨率/SAR/fps）
- `text_layers.title`：`drawtext`（或 `ass`）+ `enable='between(t,a,b)'`，动画用 ASS `\t(...)`/`\fscx`/`\fad`
- `text_layers.caption`：`ass=x.ass` 烧录
- 画幅：`scale=W:H:force_original_aspect_ratio=decrease` + `pad`(letterbox) 或 `…=increase` + `crop`(填满裁切)，`blur_pad` = `split`→一路 `gblur` 背景一路 fit 前景再 `overlay`

### 5.3 五个模板的设计

每个模板 = 一个**选段策略 (selection)** + **节奏策略 (pacing)** + **文字/转场风格 (style)**。都不依赖 AI（AI 仅作 refine 可选项）。

| 模板 | 选段策略 | 节奏 | 转场 | 文字 | 音频 |
|---|---|---|---|---|---|
| **高光混剪** | 按 clip.score(运动+音频能量+场景密度) top-K，min 间隔去重 | 中速 1.2–2s/段，可卡点 | dissolve / 快切 | 标题大字 | BGM 卡点 |
| **POV 文案视频** | 顺序保留为主，慢节奏 | 慢 2–4s/段 | fade | 逐段字幕条 + 标题，文案占主导 | BGM 轻 + 原声 |
| **剧情/对话混剪** | 保留**有语音**的段（ASR/silencedetect 找说话段），按时间顺序 | 跟对话节奏 | 硬切为主 | 对话字幕(ASR) | 原声为主 |
| **人物混剪** | 优先**含人脸**的段（v1 用运动+居中启发式；后续可加人脸检测） | 中速，可卡点 | slide/dissolve | 人名/标题大字 | BGM |
| **悬念引流** | 开头放最高 score 片段(钩子) + 信息留白，结尾 CTA | 前快后留白 | 快切 + 黑场 | 悬念文案大字("看到最后") | BGM 紧张 |

模板声明式定义放 `packages/templates/<id>.ts`：
```ts
export const highlight: TemplateDef = {
  id: "highlight", name: "高光混剪",
  selection: { strategy: "top_score", maxClips: 12, minGapMs: 300 },
  pacing: { mode: "beat_sync", fallbackSegMs: 1500, beatsPerCut: 1 },
  style: { transition: "dissolve", transitionMs: 200,
           title: { anim: "grow_fadein", pos: "top" } },
  audio: { useBgm: true, duckOriginal: true },
};
```
编译器 `compile(template, clips, analysis, opts) → RenderSpec` 是纯函数，易测试、`regenerate` 只需换随机种子重跑。

### 5.4 卡点 (beat-sync) 实现

- BGM → `svc/render` 调 `aubiotrack -i bgm.mp3`（aubio 的节拍 CLI）→ 输出节拍时间戳数组，存 `analyses(kind=beat)`
- 编译时：`pacing.mode='beat_sync'` 则每个 segment 的 `target_dur_ms` = 相邻节拍间隔（或每 N 拍切一次），片段边界精确落在节拍上
- 无 BGM / aubio 不可用 → 降级到 `fallbackSegMs` 固定节奏

---

## 6. 自动分割 / 高光评分（纯 CLI，无 Python）

- **场景分割**：`ffmpeg -i src -vf "select='gt(scene,0.4)',showinfo" -f null -` 解析 `pts_time`，或用 `scdet=threshold=10` 滤镜；得到切点 → 生成 clips。阈值可调（默认 scene>0.3~0.4）。
- **高光评分**（heuristic，加权归一化）：
  - 运动能量：相邻帧差 / `freezedetect` 反向；或 `select` 配合场景分变化
  - 音频能量：`ffmpeg ... -af astats` 或 `silencedetect=noise=-30dB:d=0.5` 找非静音/高能量段
  - 场景密度：单位时间切点数
  - `score = w1·motion + w2·audio + w3·density`，按段归一化
- v1 不强求人脸检测；"人物混剪"先用"运动+主体居中"近似，后续可在 Go 容器加 OpenCV/DNN。

---

## 7. 自动字幕（svc/asr，可选可降级）

- **服务**：现成镜像 `onerahmet/openai-whisper-asr-webservice`，`ASR_ENGINE=faster_whisper`，`ASR_MODEL=large-v3`(中文强) 或 `large-v3-turbo`(快)；CPU int8（Docker on Mac 无 GPU）。模型缓存挂卷避免重复下载。
- **流程**：ffmpeg 抽音轨 → `POST /asr?output=srt`（或 json 拿词级时间戳）→ 生成字幕文件。
- **格式**：普通字幕用 **SRT**（软挂可编辑）；**大字标题 / 卡拉OK 逐字高亮**用 **ASS**（`\k` 逐字、`\t`/`\fscx`/`\fad` 动画）。中文需在容器内内嵌 **Noto Sans CJK** 字体，否则豆腐块。
- **烧录**：`ffmpeg -vf "ass=captions.ass:fontsdir=./fonts"`（硬字幕，带样式）；或软挂 `-c:s mov_text`。
- **降级**：`svc/asr` 未起或超时 → 跳过字幕，主流程照常出片（需求第17点）。性能参考：faster-whisper int8 CPU ≈ 7~8s/分钟音频。

---

## 8. 大字标题 + 多画幅（纯 ffmpeg）

- **多 ratio**：`aspect ∈ {9:16, 3:4, original}` → 决定 `canvas.w/h`；`fit` 决定 letterbox / 填满裁切 / 模糊填充。
- **大字标题**：ASS 样式 + `{\fad(150,150)\fscx40\fscy40\t(0,300,\fscx110\fscy110)...}` 做"放大淡入弹出"，居中/顶部可配。模板的 `style.title.anim` 选预设。

---

## 9. AI refine（可选，强制 fallback）

- **位置**：`apps/api` 内置 `AiClient`，封装 Anthropic SDK，模型默认 `claude-sonnet-4-6`（refine 这种结构化任务足够、便宜快），复杂重排可升 `claude-opus-4-8`。
- **能力**：
  - *refine*：把 `clips 元数据 + 当前 RenderSpec` 给模型，让它**只输出调整后的 RenderSpec(JSON)**（选段取舍、顺序、片段时长、文案润色），用 tool/structured output 约束 schema，再重渲染。
  - *regenerate with prompt*：用户输入提示（如"更燃一点、突出第3个人"）→ 模型据此重排 → 新 RenderSpec。
- **Fallback**：无 `ANTHROPIC_API_KEY` 或调用失败 → 接口返回"AI 不可用"，前端隐藏/置灰 AI 按钮，普通 `regenerate`（换种子重跑模板编译器）始终可用。AI 永不出现在核心出片链路上。

---

## 10. svc/render —— Go ffmpeg 微服务设计

**职责**：无状态执行单元，吃 JSON、吐文件 + 进度。端点：
```
POST /probe        {path}                 → ffprobe json
POST /thumbnail    {path, atMs, w}        → 缩略图
POST /clip         {path, startMs, endMs} → 切片(stream copy 优先)
POST /scene        {path, threshold}      → [切点ms]   (scdet)
POST /beat         {path}                 → [节拍ms]   (aubiotrack)
POST /render       {RenderSpec}           → 出片 + jobId, 进度走回调/轮询
GET  /jobs/:id     → 状态/进度
DELETE /jobs/:id   → 取消(kill 进程组)
```

**并发与进度**（调研结论）：
- 进程池：`maxConcurrent = max(1, cores/4)` 重型车道（render/transcode）+ 独立轻型车道（thumb/probe/scene）。每个 ffmpeg `-threads` 设为核数一半，避免 CPU 过订阅。
- 进度：ffmpeg `-progress pipe:1 -nostats` → 解析 `out_time_us / 总时长`(先 ffprobe 拿总时长) → 每个 `progress=continue` 块上报一次百分比。
- 取消：`exec.CommandContext` + 独立**进程组**（`Setpgid`），取消时杀整组（ffmpeg 可能拉子进程）。超时同理。
- 原子产出：先写临时文件，成功后 rename。

**进度回传链**：`svc/render` 把进度 `POST /internal/progress` 回 `api`（或 api 轮询 `GET /jobs/:id`）→ api 写 `job_events` 表 → api 的 SSE 端点 tail 该表推给前端。

**容器**：基于带 ffmpeg + aubio 的镜像（`apt install ffmpeg aubio-tools` 或 `jrottenberg/ffmpeg` 派生），内嵌 Noto CJK 字体。

---

## 11. API 表面（apps/api，Hono）

```
# 工程
POST   /projects                         {title} → project
GET    /projects/:id
PATCH  /projects/:id                      {title, templateId, aspect}

# 素材
POST   /projects/:id/sources             multipart 上传 → 触发 probe+thumb job
GET    /projects/:id/sources             列表(含缩略图/时长/分辨率)

# clips
POST   /projects/:id/segment             触发自动分割 job
GET    /projects/:id/clips               列表(缩略图/start/end/相对range/时长/score/order)
PATCH  /projects/:id/clips/reorder       {orderedIds[]}     前端拖动排序
PATCH  /projects/:id/clips/:cid          {included}

# 出片
POST   /projects/:id/render              {templateId, aspect, withSubtitle?} → render job
POST   /projects/:id/regenerate          {seed?}            非 AI 重生成
POST   /projects/:id/regenerate-ai       {prompt}           AI(可选)
GET    /projects/:id/renders             结果列表
GET    /renders/:id/download             mp4 下载

# 实时
GET    /projects/:id/events              SSE 进度流

# 能力探测(给前端决定是否显示 AI/字幕按钮)
GET    /capabilities                     {ai: bool, asr: bool, hwaccel: string}
```

---

## 12. 前端 UX（apps/web）—— 为非专业用户设计

线性向导式，单页分步，左侧步骤指示，避免时间线编辑器那种专业复杂度。

1. **上传页**：拖拽上传 → 立即出现原视频播放器 + 缩略图 + 时长/分辨率。
2. **素材页**：网格展示自动分割出的 clips，每张卡片 = 缩略图 + 起止时间 + 相对原视频 range + 时长；支持**拖动排序**、勾选纳入/排除、点击预览该 clip。原视频缩略图常驻顶部可回看。
3. **模板页**：5 个模板卡片（封面 + 一句话说明 + 示意），选画幅(9:16/3:4/原始)、是否加字幕/大字标题。
4. **生成中**：进度条(SSE) + 当前阶段文案。
5. **结果页**：视频标题、**模板引用信息**(用了哪个模板/画幅/是否AI refine)、预览播放器、总时长、**下载**按钮；下方 `regenerate` / `regenerate with prompt`(AI 可用时才显示)。

Radix 用于 Dialog/Tabs/Slider/Select/Progress/Toast 等无样式可访问基础件，Tailwind 做视觉。

---

## 13. 本地开发与调试

- **一键起栈**：`docker-compose up`（api + render + asr + web）；或本地裸跑 `pnpm dev`（turbo 并行起 web/api，render 用 `go run`，需先装 Go）。
- **完全可调试**（需求第7点）：
  - api/web：Node/Vite 原生调试，断点直连。
  - render：本地 `go run .`，ffmpeg 命令打到日志可复制到终端复跑。
  - 所有 ffmpeg 命令在 `svc/render` 落 debug 日志（完整命令行），便于人肉复现。
  - SQLite 文件 `data/app.db` 可用任意工具直接看。
- **可降级矩阵**：无 Go → render 退而用 Node 子进程跑 ffmpeg(临时桥, 见里程碑)；无 asr → 跳过字幕；无 AI key → 隐藏 AI；Docker 无 VideoToolbox → libx264。
- `.env`：`ANTHROPIC_API_KEY?`、`ASR_URL?`、`RENDER_URL`、`RENDER_HWACCEL`、`DATA_DIR`。

---

## 14. 实施里程碑（建议顺序）

| 阶段 | 内容 | 产出 |
|---|---|---|
| **M0 脚手架** | monorepo(pnpm+turbo)、packages/shared(Zod)、db schema、空 api/web/render | 能跑起空壳 + compose |
| **M1 上传与预览** | 上传 → probe → thumb；前端原视频预览/缩略图/时长 | 跑通 1→3 步 |
| **M2 自动分割** | scdet 切 clips + 高光评分；前端 clips 网格、排序、预览 | 跑通 4 步 |
| **M3 模板拼接(MVP)** | 高光模板 + RenderSpec + Go render(concat/xfade) + 结果页 + 下载 | **核心闭环出片** |
| **M4 五模板 + 多画幅 + 大字标题** | 其余 4 模板、aspect、ASS 标题 | 模板齐全 |
| **M5 卡点** | aubio beat → beat-sync 编译 | 卡点模板 |
| **M6 字幕** | svc/asr 接入 → SRT/ASS 烧录 + 降级 | 自动字幕 |
| **M7 AI refine** | AiClient + refine/regenerate-with-prompt + fallback | AI 可选项 |

> M3 之前若 Go 尚未安装：先用 `apps/worker`(Node + fluent-ffmpeg) 临时承担 render，把 `svc/render` 的 HTTP 契约定义好；装好 Go 后平移实现，api 侧不改。**遇到 Go 跑不通会停下来请你安装，不绕开 Go 方案。**

---

## 15. 风险与取舍

- **Mac/Docker 无硬件加速**：长视频软编慢 → 本地开发建议宿主机直跑 render 用 VideoToolbox；产品化在 Linux + GPU 上获 VAAPI/NVENC。
- **xfade offset 计算**易错：编译器里写纯函数 + 单测覆盖累计偏移。
- **concat 输入须归一化**：每段先 `scale/pad/fps/setsar` 统一，否则报错。
- **中文字体**：容器必须内嵌 Noto Sans CJK，否则字幕/标题豆腐块。
- **剪映模板加密**：v6+ `draft_content.json` 加密，无法直接复用其模板文件；我们自定义 RenderSpec，不依赖其格式（仅借鉴数据模型）。
- **SQLite 写串行**：单用户无碍；多用户/多机再迁 River/BullMQ。

---

## 16. 复用的现成方案清单

| 用途 | 方案 | 许可 |
|---|---|---|
| 渲染引擎 | FFmpeg `-filter_complex` | LGPL/GPL |
| 节拍检测 | aubio (`aubiotrack`) | GPL(CLI 调用) |
| 场景检测 | ffmpeg `scdet`/`select=scene` | — |
| ASR | faster-whisper / whisper-asr-webservice | MIT |
| 字幕渲染 | libass (ffmpeg `ass`/`subtitles`) | — |
| 时间线模型参考 | OpenTimelineIO 概念 | Apache-2.0 |
| 队列 | node:sqlite 自建认领循环 | — |
| Node SQLite | 内置 node:sqlite (Node ≥24) | — |
| 进度 | ffmpeg `-progress` + SSE | — |
| Monorepo | pnpm workspaces + Turborepo | — |
| CJK 字体 | Noto Sans CJK / Source Han Sans | OFL |
```
