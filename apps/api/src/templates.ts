import type {
  AspectRatio,
  Clip,
  RenderSpec,
  Segment,
  Source,
  TemplateDef,
  TemplateId,
  TextLayer,
} from "@vcd/shared";

// ---------- 5 个模板定义（声明式：选段 + 节奏 + 风格 + 音频）----------
export const TEMPLATES: Record<TemplateId, TemplateDef & { fit: Segment["fit"] }> = {
  highlight: {
    id: "highlight", name: "高光混剪", description: "按精彩度自动挑出高光片段，快节奏卡点混剪",
    selection: { strategy: "top_score", maxClips: 12, minGapMs: 300 },
    pacing: { mode: "beat_sync", fallbackSegMs: 1400, beatsPerCut: 1 },
    style: { transition: "dissolve", transitionMs: 200, title: { enabled: true, pos: "top" } },
    audio: { useBgm: true, duckOriginal: true },
    fit: "crop",
  },
  pov: {
    id: "pov", name: "POV 文案视频", description: "第一视角慢节奏，文案/字幕主导的氛围感视频",
    selection: { strategy: "sequential", maxClips: 8, minGapMs: 0 },
    pacing: { mode: "fixed", fallbackSegMs: 2600, beatsPerCut: 2 },
    style: { transition: "fade", transitionMs: 350, title: { enabled: true, pos: "center" } },
    audio: { useBgm: true, duckOriginal: true },
    fit: "blur_pad",
  },
  dialogue: {
    id: "dialogue", name: "剧情/对话混剪", description: "保留有人声的段落，按时间顺序串成剧情",
    selection: { strategy: "has_speech", maxClips: 14, minGapMs: 0 },
    pacing: { mode: "fixed", fallbackSegMs: 3000, beatsPerCut: 1 },
    style: { transition: "none", transitionMs: 0, title: { enabled: true, pos: "top" } },
    audio: { useBgm: false, duckOriginal: false },
    fit: "crop",
  },
  character: {
    id: "character", name: "人物混剪", description: "聚焦人物主体的中速混剪",
    selection: { strategy: "has_face", maxClips: 10, minGapMs: 300 },
    pacing: { mode: "beat_sync", fallbackSegMs: 1600, beatsPerCut: 1 },
    style: { transition: "slideleft", transitionMs: 250, title: { enabled: true, pos: "bottom" } },
    audio: { useBgm: true, duckOriginal: true },
    fit: "crop",
  },
  suspense: {
    id: "suspense", name: "悬念引流视频", description: "最强钩子开头 + 悬念文案，前快后留白",
    selection: { strategy: "hook_first", maxClips: 8, minGapMs: 300 },
    pacing: { mode: "fixed", fallbackSegMs: 1200, beatsPerCut: 1 },
    style: { transition: "fade", transitionMs: 180, title: { enabled: true, pos: "center" } },
    audio: { useBgm: true, duckOriginal: true },
    fit: "crop",
  },
};

export function canvasFor(aspect: AspectRatio, sources: Source[]): { w: number; h: number; fps: number } {
  const fps = 30;
  if (aspect === "9:16") return { w: 1080, h: 1920, fps };
  if (aspect === "3:4") return { w: 1080, h: 1440, fps };
  // original: 取第一个源的尺寸（偶数化），缺省 1280x720
  const s = sources[0];
  let w = s?.width || 1280;
  let h = s?.height || 720;
  w -= w % 2;
  h -= h % 2;
  return { w, h, fps };
}

// 种子随机（mulberry32），让 regenerate 产生差异
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CompileOpts {
  templateId: TemplateId;
  aspect: AspectRatio;
  clips: Clip[];
  sources: Source[];
  beats?: number[];
  title?: string;
  bgmPath?: string | null;
  assPath?: string | null;
  seed?: number;
}

export function compile(opts: CompileOpts): RenderSpec {
  const tpl = TEMPLATES[opts.templateId];
  const canvas = canvasFor(opts.aspect, opts.sources);
  const srcMap = new Map(opts.sources.map((s) => [s.id, s]));
  const rand = rng(opts.seed ?? 1);

  const usable = opts.clips.filter((c) => c.included && srcMap.has(c.sourceId));
  const selected = select(tpl, usable, srcMap, rand);

  // ---- 节奏：决定每段时长 ----
  const useBgm = tpl.audio.useBgm && !!opts.bgmPath;
  const beats = opts.beats ?? [];
  const segs: Segment[] = [];
  let cursor = 0;
  let beatIdx = 0;

  for (let i = 0; i < selected.length; i++) {
    const c = selected[i];
    const src = srcMap.get(c.sourceId)!;

    let durMs: number;
    if (tpl.pacing.mode === "beat_sync" && beats.length > 1) {
      const a = beats[Math.min(beatIdx, beats.length - 1)];
      const b = beats[Math.min(beatIdx + tpl.pacing.beatsPerCut, beats.length - 1)];
      beatIdx += tpl.pacing.beatsPerCut;
      durMs = Math.max(400, Math.round((b - a) || tpl.pacing.fallbackSegMs));
    } else {
      durMs = tpl.pacing.fallbackSegMs;
    }
    durMs = Math.min(durMs, c.durationMs); // 不超过该 clip 实际长度

    const seg: Segment = {
      clipId: c.id,
      src: src.path,
      srcInMs: c.startMs,
      srcDurMs: durMs,
      targetStartMs: cursor,
      targetDurMs: durMs,
      speed: 1,
      fit: tpl.fit,
      transform: {},
      transitionOut:
        useBgm && tpl.style.transition !== "none" && i < selected.length - 1
          ? { type: tpl.style.transition, durMs: tpl.style.transitionMs }
          : undefined,
    };
    segs.push(seg);
    cursor += durMs;
  }

  const totalMs = cursor;

  // ---- 文字图层 ----
  const textLayers: TextLayer[] = [];
  if (tpl.style.title.enabled && opts.title) {
    const pos = tpl.style.title.pos;
    const y = pos === "top" ? "h*0.10" : pos === "bottom" ? "h*0.82" : "(h-th)/2";
    textLayers.push({
      kind: "title",
      content: opts.title,
      startMs: 200,
      endMs: Math.min(2800, totalMs),
      style: {
        font: "NotoSansCJKsc",
        size: Math.round(canvas.w * 0.075),
        x: "(w-tw)/2",
        y,
        anim: "grow_fadein",
        color: "white",
      },
    });
  }
  if (opts.assPath) {
    textLayers.push({ kind: "caption", assPath: opts.assPath });
  }

  return {
    canvas,
    bgm: useBgm
      ? { src: opts.bgmPath!, gainDb: tpl.audio.duckOriginal ? -2 : 0, beats: beats.map((b) => b / 1000) }
      : null,
    segments: segs.length > 0 ? segs : fallbackSegment(opts, canvas),
    textLayers,
    output: { format: "mp4", vcodec: "h264", crf: 20, preset: "veryfast" },
  };
}

function select(
  tpl: TemplateDef,
  clips: Clip[],
  srcMap: Map<string, Source>,
  rand: () => number,
): Clip[] {
  const max = tpl.selection.maxClips;
  const byOrder = [...clips].sort((a, b) => a.orderIndex - b.orderIndex || a.startMs - b.startMs);
  const byScore = [...clips].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  switch (tpl.selection.strategy) {
    case "sequential":
      return byOrder.slice(0, max);
    case "top_score":
    case "has_face": {
      // 取高分 top-K，再按时间线顺序排列；seed 微扰：偶尔下移一个名次
      const pool = byScore.slice(0, Math.min(byScore.length, max + 2));
      shuffleLight(pool, rand);
      const chosen = pool.slice(0, max);
      return chosen.sort((a, b) => a.orderIndex - b.orderIndex);
    }
    case "has_speech": {
      const withAudio = byOrder.filter((c) => srcMap.get(c.sourceId)?.hasAudio);
      return (withAudio.length ? withAudio : byOrder).slice(0, max);
    }
    case "hook_first": {
      const hook = byScore[0];
      const rest = byOrder.filter((c) => c.id !== hook?.id).slice(0, max - 1);
      return hook ? [hook, ...rest] : rest;
    }
    default:
      return byOrder.slice(0, max);
  }
}

// 轻度打乱：相邻元素按 seed 概率交换，制造 regenerate 差异但不破坏整体顺序
function shuffleLight<T>(arr: T[], rand: () => number) {
  for (let i = 0; i < arr.length - 1; i++) {
    if (rand() < 0.35) {
      [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
    }
  }
}

// 极端兜底：没有可用 clip 时，用第一个源的前 3 秒
function fallbackSegment(opts: CompileOpts, canvas: { w: number; h: number }): Segment[] {
  const s = opts.sources[0];
  if (!s) throw new Error("no sources to render");
  return [
    {
      clipId: "fallback",
      src: s.path,
      srcInMs: 0,
      srcDurMs: Math.min(3000, s.durationMs || 3000),
      targetStartMs: 0,
      targetDurMs: Math.min(3000, s.durationMs || 3000),
      speed: 1,
      fit: "crop",
      transform: {},
    },
  ];
}
