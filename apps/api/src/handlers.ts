import type { JobType } from "@vcd/shared";
import { absPath, callbackUrl } from "./config.js";
import { buildClipRanges, scoreClip } from "./analysis.js";
import { asrAvailable, transcribe, writeAss } from "./asr.js";
import {
  createClip, enqueueJob, getRender, getRenderSpec, listSources, newId,
  saveAnalysis, setJobProgress, updateProject, updateRender, updateSource,
  deleteClips, type JobRow,
} from "./db.js";
import { renderClient } from "./render-client.js";

type Handler = (job: JobRow) => Promise<void>;

export const handlers: Partial<Record<JobType, Handler>> = {
  probe: probeJob,
  segment: segmentJob,
  beat: beatJob,
  render: renderJob,
  asr: asrJob,
};

// ---- probe：探测源 + 生成封面缩略图 ----
async function probeJob(job: JobRow) {
  const { sourceId } = job.payload as { sourceId: string };
  const src = listSources(job.projectId).find((s) => s.id === sourceId);
  if (!src) throw new Error("source not found");

  const abs = absPath(src.path);
  const pr = await renderClient.probe(abs);
  updateSource(sourceId, {
    durationMs: pr.durationMs, width: pr.width, height: pr.height,
    fps: pr.fps, codec: pr.codec, hasAudio: pr.hasAudio,
  });
  setJobProgress(job.id, 0.5, "已探测视频信息");

  const thumbRel = `thumbs/${sourceId}.jpg`;
  await renderClient.thumbnail(abs, Math.min(1000, Math.floor(pr.durationMs / 2)), absPath(thumbRel), 480);
  updateSource(sourceId, { thumbPath: thumbRel });
  setJobProgress(job.id, 1, "封面已生成");
}

// ---- segment：场景检测 -> 切 clips + 评分 + 每段缩略图 ----
async function segmentJob(job: JobRow) {
  updateProject(job.projectId, { status: "analyzing" });
  deleteClips(job.projectId);
  const sources = listSources(job.projectId);

  let order = 0;
  for (let si = 0; si < sources.length; si++) {
    const src = sources[si];
    const abs = absPath(src.path);
    const { cutsMs } = await renderClient.scene(abs, 0.4);
    const ranges = buildClipRanges(src.durationMs, cutsMs);

    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      const clipId = newId();
      const thumbRel = `thumbs/clip-${clipId}.jpg`;
      await renderClient.thumbnail(abs, r.start + Math.min(200, (r.end - r.start) / 2), absPath(thumbRel), 320);
      createClip({
        id: clipId, projectId: job.projectId, sourceId: src.id,
        startMs: r.start, endMs: r.end, durationMs: r.end - r.start,
        thumbPath: thumbRel, score: scoreClip(r, cutsMs, order),
        orderIndex: order++, included: true,
      });
    }
    setJobProgress(job.id, (si + 1) / sources.length, `已分割 ${si + 1}/${sources.length} 个视频`);
  }
  updateProject(job.projectId, { status: "ready" });
}

// ---- beat：BGM 节拍检测（aubio，缺则降级空）----
async function beatJob(job: JobRow) {
  const { bgmRel } = job.payload as { bgmRel: string };
  const r = await renderClient.beat(absPath(bgmRel));
  saveAnalysis(job.projectId, null, "beat", r.beatsMs);
  setJobProgress(job.id, 1, r.degraded ? "无 aubio，已降级为固定节奏" : "节拍检测完成");
}

// ---- render：调 svc/render 出片 + 结果缩略图 ----
async function renderJob(job: JobRow) {
  const { renderId, withSubtitle } = job.payload as { renderId: string; withSubtitle?: boolean };
  const spec = getRenderSpec(renderId);
  if (!spec) throw new Error("render spec not found");
  updateProject(job.projectId, { status: "rendering" });
  updateRender(renderId, { status: "rendering" });

  const relOut = `out/${renderId}.mp4`;
  let res: { outPath: string; durationMs: number };
  try {
    res = await renderClient.render(job.id, absPath(relOut), callbackUrl(), spec);
  } catch (e) {
    updateRender(renderId, { status: "failed" });
    throw e;
  }

  const thumbRel = `thumbs/render-${renderId}.jpg`;
  try {
    await renderClient.thumbnail(absPath(relOut), Math.min(1000, Math.floor(res.durationMs / 2)), absPath(thumbRel), 480);
  } catch { /* 缩略图失败不致命 */ }

  updateRender(renderId, { outPath: relOut, thumbPath: thumbRel, durationMs: res.durationMs, status: "done" });
  updateProject(job.projectId, { status: "done" });

  // 可选字幕：渲染成功后再起 asr 任务（不阻塞主结果）
  if (withSubtitle && asrAvailable()) {
    enqueueJob("asr", job.projectId, { renderId });
  }
}

// ---- asr：转写成片 -> ASS -> 烧录（可选，失败则保留无字幕版本）----
async function asrJob(job: JobRow) {
  const { renderId } = job.payload as { renderId: string };
  const r = getRender(renderId);
  if (!r?.outPath) throw new Error("render output not found");
  const absIn = absPath(r.outPath);

  try {
    setJobProgress(job.id, 0.1, "提取人声…");
    // 关键：用「混入背景音乐之前」的纯人声轨识别(音乐会干扰识别)。
    // speech-track 产出与成片时间轴对齐的纯原声 wav。
    const spec = getRenderSpec(renderId);
    const wavRel = `out/${renderId}.speech.wav`;
    if (spec) {
      await renderClient.speechTrack(spec, absPath(wavRel));
    } else {
      await renderClient.extractAudio(absIn, absPath(wavRel)); // 兜底
    }

    setJobProgress(job.id, 0.3, "转写中…");
    const segs = await transcribe(absPath(wavRel));
    if (!segs.length) { setJobProgress(job.id, 1, "无可识别语音，跳过字幕"); return; }

    const pr = await renderClient.probe(absIn);
    const assRel = `out/${renderId}.ass`;
    await writeAss(absPath(assRel), segs, pr.width || 1080, pr.height || 1920);

    setJobProgress(job.id, 0.6, "烧录字幕…");
    const burnedRel = `out/${renderId}-sub.mp4`;
    await renderClient.burnSub(absIn, absPath(assRel), absPath(burnedRel));

    const thumbRel = `thumbs/render-${renderId}.jpg`;
    updateRender(renderId, { outPath: burnedRel, thumbPath: thumbRel });

    // 清理中间产物(无字幕原片 + 人声 wav + ass)，避免磁盘堆积
    const { rm } = await import("node:fs/promises");
    await Promise.allSettled([
      rm(absIn, { force: true }),
      rm(absPath(wavRel), { force: true }),
      rm(absPath(assRel), { force: true }),
    ]);
    setJobProgress(job.id, 1, "字幕已添加");
  } catch (e) {
    // 字幕是可选项，失败不影响已出片结果
    console.warn("[asr] 字幕失败，保留无字幕版本:", String(e));
    setJobProgress(job.id, 1, "字幕生成失败，已跳过");
  }
}
