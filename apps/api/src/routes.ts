import type { AspectRatio, Clip, Project, Render, Source, TemplateId } from "@vcd/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { aiAvailable, refineSpec } from "./ai.js";
import { absPath, config, fileUrl, paths } from "./config.js";
import {
  createProject, createRender, deleteSource, enqueueJob, eventsSince, getAnalysis,
  getClip, getProject, getRender, listClips, listRenders, listSources, newId, saveAnalysis,
  setClipIncluded, setClipOrder, createSource, getSource, setJobProgress, setProjectBgm,
  updateProject,
} from "./db.js";
import { renderClient } from "./render-client.js";
import { compile, TEMPLATES } from "./templates.js";

// ---------- 序列化（路径 -> URL）----------
const sourceDTO = (s: Source) => ({ ...s, url: fileUrl(s.path), thumbUrl: fileUrl(s.thumbPath) });
const clipDTO = (c: Clip) => ({ ...c, thumbUrl: fileUrl(c.thumbPath) });
const renderDTO = (r: Render) => ({
  ...r, url: fileUrl(r.outPath), thumbUrl: fileUrl(r.thumbPath),
  downloadUrl: r.outPath ? `/renders/${r.id}/download` : null,
});

export function registerRoutes(app: Hono) {
  // ---- 能力探测 ----
  app.get("/capabilities", (c) =>
    c.json({ ai: aiAvailable(), asr: config.asrUrl.length > 0, hwaccel: config.renderHwaccel }),
  );

  app.get("/templates", (c) =>
    c.json(Object.values(TEMPLATES).map((t) => ({ id: t.id, name: t.name, description: t.description }))),
  );

  // ---- 工程 ----
  app.post("/projects", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const p = createProject(body.title ?? "未命名工程", (body.aspect as AspectRatio) ?? "original");
    return c.json(p);
  });

  app.get("/projects/:id", (c) => {
    const id = c.req.param("id");
    const p = getProject(id);
    if (!p) return c.json({ error: "not found" }, 404);
    return c.json({
      project: { ...p, bgmUrl: fileUrl(p.bgmPath) },
      sources: listSources(id).map(sourceDTO),
      clips: listClips(id).map(clipDTO),
      renders: listRenders(id).map(renderDTO),
    });
  });

  app.patch("/projects/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    updateProject(id, body);
    return c.json(getProject(id));
  });

  // ---- 上传源视频 ----
  app.post("/projects/:id/sources", async (c) => {
    const id = c.req.param("id");
    if (!getProject(id)) return c.json({ error: "project not found" }, 404);

    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) return c.json({ error: "no file" }, 400);

    const sourceId = newId();
    const ext = extname(file.name) || ".mp4";
    const rel = `media/${sourceId}${ext}`;
    await mkdir(paths.media(), { recursive: true });
    await writeFile(absPath(rel), Buffer.from(await file.arrayBuffer()));

    const src = createSource({
      id: sourceId, projectId: id, filename: file.name, path: rel,
      durationMs: 0, width: 0, height: 0, fps: 0, codec: "", hasAudio: false, thumbPath: null,
    });
    const jobId = enqueueJob("probe", id, { sourceId });
    return c.json({ source: sourceDTO(src), jobId });
  });

  app.get("/projects/:id/sources", (c) =>
    c.json(listSources(c.req.param("id")).map(sourceDTO)),
  );

  app.delete("/projects/:id/sources/:sid", (c) => {
    deleteSource(c.req.param("sid")); // 关联 clips 经外键级联删除
    return c.json({ ok: true });
  });

  // ---- 配乐：上传 / 清除 ----
  app.post("/projects/:id/bgm", async (c) => {
    const id = c.req.param("id");
    if (!getProject(id)) return c.json({ error: "project not found" }, 404);
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) return c.json({ error: "no file" }, 400);
    const ext = extname(file.name) || ".mp3";
    const rel = `assets/bgm-${id}${ext}`;
    await mkdir(paths.assets(), { recursive: true });
    await writeFile(absPath(rel), Buffer.from(await file.arrayBuffer()));
    setProjectBgm(id, rel);
    saveAnalysis(id, null, "beat", []); // 失效旧节拍，下次渲染重测
    return c.json({ bgmPath: rel, bgmUrl: fileUrl(rel) });
  });

  app.delete("/projects/:id/bgm", (c) => {
    setProjectBgm(c.req.param("id"), null);
    return c.json({ ok: true });
  });

  // ---- 自动分割 ----
  app.post("/projects/:id/segment", (c) => {
    const id = c.req.param("id");
    if (!getProject(id)) return c.json({ error: "project not found" }, 404);
    const jobId = enqueueJob("segment", id, {});
    return c.json({ jobId });
  });

  app.get("/projects/:id/clips", (c) => c.json(listClips(c.req.param("id")).map(clipDTO)));

  // 下载单个 clip（按需切出，缓存到 out/clip-<id>.mp4）
  app.get("/projects/:id/clips/:cid/download", async (c) => {
    const clip = getClip(c.req.param("cid"));
    if (!clip) return c.json({ error: "clip not found" }, 404);
    const src = getSource(clip.sourceId);
    if (!src) return c.json({ error: "source not found" }, 404);
    const rel = `out/clip-${clip.id}.mp4`;
    if (!existsSync(absPath(rel))) {
      await renderClient.clip(absPath(src.path), clip.startMs, clip.endMs, absPath(rel));
    }
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(absPath(rel));
    c.header("content-type", "video/mp4");
    c.header("content-disposition", `attachment; filename="clip-${clip.id}.mp4"`);
    return c.body(buf as any);
  });

  app.patch("/projects/:id/clips/reorder", async (c) => {
    const id = c.req.param("id");
    const { orderedIds } = await c.req.json();
    setClipOrder(id, orderedIds ?? []);
    return c.json({ ok: true });
  });

  app.patch("/projects/:id/clips/:cid", async (c) => {
    const { included } = await c.req.json();
    setClipIncluded(c.req.param("cid"), !!included);
    return c.json({ ok: true });
  });

  // ---- 出片 ----
  app.post("/projects/:id/render", (c) => doRender(c));
  app.post("/projects/:id/regenerate", (c) => doRender(c, true));

  app.get("/projects/:id/renders", (c) => c.json(listRenders(c.req.param("id")).map(renderDTO)));

  app.get("/renders/:id", (c) => {
    const r = getRender(c.req.param("id"));
    return r ? c.json(renderDTO(r)) : c.json({ error: "not found" }, 404);
  });

  app.get("/renders/:id/download", async (c) => {
    const r = getRender(c.req.param("id"));
    if (!r?.outPath) return c.json({ error: "not ready" }, 404);
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(absPath(r.outPath));
    c.header("content-type", "video/mp4");
    c.header("content-disposition", `attachment; filename="${encodeURIComponent(r.id)}.mp4"`);
    return c.body(buf as any);
  });

  // ---- 进度回调（svc/render -> api）----
  app.post("/internal/progress", async (c) => {
    const { jobId, progress, message } = await c.req.json().catch(() => ({}));
    if (jobId) setJobProgress(jobId, Number(progress) || 0, message);
    return c.json({ ok: true });
  });

  // ---- SSE 进度流 ----
  app.get("/projects/:id/events", (c) => {
    const id = c.req.param("id");
    return streamSSE(c, async (stream) => {
      let lastId = 0;
      while (!stream.closed && !stream.aborted) {
        const events = eventsSince(id, lastId);
        for (const e of events) {
          lastId = e.id;
          await stream.writeSSE({ data: JSON.stringify({ jobId: e.job_id, progress: e.progress, message: e.message, ts: e.ts }) });
        }
        await stream.sleep(500);
      }
    });
  });
}

// 渲染：编译 RenderSpec -> 建 render 行 -> 入队 render 作业
async function doRender(c: any, regenerate = false) {
  const id = c.req.param("id");
  const project = getProject(id);
  if (!project) return c.json({ error: "project not found" }, 404);
  const body = await c.req.json().catch(() => ({}));

  const templateId: TemplateId = body.templateId ?? project.templateId ?? "highlight";
  const aspect: AspectRatio = body.aspect ?? project.aspect ?? "original";
  const withSubtitle = !!body.withSubtitle;
  const useAi = !!body.useAi;
  const prompt: string | null = body.prompt ?? null;
  const seed = body.seed ?? (regenerate ? Math.floor(Date.now() % 100000) : 1);

  updateProject(id, { templateId, aspect });

  const sourcesRel = listSources(id);
  if (sourcesRel.length === 0) return c.json({ error: "请先上传视频" }, 400);
  // compile 需要绝对路径
  const sources = sourcesRel.map((s) => ({ ...s, path: absPath(s.path) }));
  const clips = listClips(id);

  // 音频模式：mix=配乐+原声混合 / bgm=仅配乐 / original=仅原声
  const audioMode: "mix" | "bgm" | "original" = body.audioMode ?? (body.noMusic ? "original" : "bgm");
  const bgmVolume = body.bgmVolume;
  const originalVolume = body.originalVolume;

  // BGM 解析：original 模式不加配乐 > 工程上传的配乐 > 全局 assets/bgm.mp3 > 无
  let bgmAbs: string | null = null;
  if (audioMode !== "original") {
    if (project.bgmPath && existsSync(absPath(project.bgmPath))) {
      bgmAbs = absPath(project.bgmPath);
    } else if (existsSync(absPath("assets/bgm.mp3"))) {
      bgmAbs = absPath("assets/bgm.mp3");
    }
  }
  const hasBgm = !!bgmAbs;
  let beats: number[] = [];
  if (hasBgm && TEMPLATES[templateId].audio.useBgm) {
    beats = (getAnalysis(id, "beat") as number[]) ?? [];
    if (!beats.length) {
      try {
        const r = await renderClient.beat(bgmAbs!);
        beats = r.beatsMs;
        saveAnalysis(id, null, "beat", beats);
      } catch { beats = []; }
    }
  }

  let spec = compile({
    templateId, aspect, clips, sources, beats,
    title: project.title, bgmPath: hasBgm ? bgmAbs : null, assPath: null, seed,
    audioMode, bgmVolume, originalVolume, titleStyle: body.titleStyle,
  });

  let aiRefined = false;
  if (useAi && aiAvailable()) {
    try {
      spec = await refineSpec(spec, clips, prompt);
      aiRefined = true;
    } catch (e) {
      console.warn("[ai] refine 失败，使用原 spec:", String(e));
    }
  }

  const renderId = newId();
  createRender({
    id: renderId, projectId: id, outPath: null, thumbPath: null, durationMs: null,
    aspect, templateId, aiRefined, prompt, status: "pending", specJson: JSON.stringify(spec),
  });
  const jobId = enqueueJob("render", id, { renderId, withSubtitle });
  return c.json({ renderId, jobId });
}
