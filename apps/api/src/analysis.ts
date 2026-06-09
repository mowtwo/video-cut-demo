import type { Clip } from "@vcd/shared";

const MIN_CLIP_MS = 800;
const MAX_CLIP_MS = 8000;
const CHUNK_MS = 3000; // 无场景切点时的兜底分块

/** 由场景切点(ms)切出 clip 的时间区间 [start,end]。无切点则定长分块。 */
export function buildClipRanges(durationMs: number, cutsMs: number[] | null): Array<{ start: number; end: number }> {
  const cuts = (cutsMs ?? []).filter((c) => c > 0 && c < durationMs).sort((a, b) => a - b);
  const bounds = [0, ...cuts, durationMs];

  let ranges: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    let start = bounds[i];
    const end = bounds[i + 1];
    if (end - start < MIN_CLIP_MS) continue;
    // 过长的段按 MAX 再切
    while (end - start > MAX_CLIP_MS) {
      ranges.push({ start, end: start + MAX_CLIP_MS });
      start += MAX_CLIP_MS;
    }
    ranges.push({ start, end });
  }

  if (ranges.length === 0) {
    // 完全没有可用切点：定长分块
    for (let s = 0; s < durationMs; s += CHUNK_MS) {
      const e = Math.min(s + CHUNK_MS, durationMs);
      if (e - s >= MIN_CLIP_MS) ranges.push({ start: s, end: e });
    }
  }
  return ranges;
}

/**
 * 高光评分启发式（无 AI、零额外 ffmpeg）：
 *  - 时长甜区：~2s 最佳
 *  - 场景密度：clip 中心附近 ±2s 内的切点数（动作多）
 *  - 轻微确定性抖动：稳定可复现的 tie-break
 * 返回 0..1。后续可升级为运动/音频能量分析。
 */
export function scoreClip(
  range: { start: number; end: number },
  cutsMs: number[] | null,
  index: number,
): number {
  const dur = range.end - range.start;
  const durationScore = clamp01(1 - Math.abs(dur - 2000) / 4000);

  const center = (range.start + range.end) / 2;
  const near = (cutsMs ?? []).filter((c) => Math.abs(c - center) <= 2000).length;
  const densityScore = clamp01(near / 5);

  const jitter = ((Math.sin(index * 12.9898) * 43758.5453) % 1 + 1) % 1; // 确定性

  return clamp01(0.55 * durationScore + 0.35 * densityScore + 0.1 * jitter);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export type NewClip = Omit<Clip, "createdAt">;
