import { z } from "zod";
import { FitMode } from "./common.js";

/**
 * RenderSpec —— 渲染中间表示 (Intermediate Representation)。
 * 模板引擎(Node)产出，svc/render(Go)消费并翻译成 ffmpeg -filter_complex。
 * 这是 Node 与 Go 之间的核心契约。
 */

export const TransitionType = z.enum([
  "none",
  "fade",
  "dissolve",
  "wipeleft",
  "wiperight",
  "slideleft",
  "slideright",
  "circlecrop",
]);
export type TransitionType = z.infer<typeof TransitionType>;

export const Transition = z.object({
  type: TransitionType,
  durMs: z.number().nonnegative(),
});

export const Canvas = z.object({
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  fps: z.number().positive().default(30),
});

export const Bgm = z.object({
  src: z.string(),
  gainDb: z.number().default(-3),
  /** 节拍时间戳(秒)，卡点用；无卡点时为空 */
  beats: z.array(z.number()).default([]),
});

export const Segment = z.object({
  clipId: z.string(),
  src: z.string(),
  srcInMs: z.number().nonnegative(),
  srcDurMs: z.number().positive(),
  targetStartMs: z.number().nonnegative(),
  targetDurMs: z.number().positive(),
  speed: z.number().positive().default(1),
  fit: FitMode.default("crop"),
  transform: z
    .object({ scale: z.number().positive().optional() })
    .default({}),
  transitionOut: Transition.optional(),
});
export type Segment = z.infer<typeof Segment>;

export const TitleAnim = z.enum(["none", "fadein", "grow_fadein", "slide_up"]);

export const TextLayer = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("title"),
    content: z.string(),
    startMs: z.number().nonnegative(),
    endMs: z.number().positive(),
    style: z.object({
      font: z.string().default("NotoSansCJKsc"),
      size: z.number().positive().default(96),
      x: z.string().default("(w-tw)/2"),
      y: z.string().default("h*0.12"),
      anim: TitleAnim.default("grow_fadein"),
      color: z.string().default("white"),
    }),
  }),
  z.object({
    kind: z.literal("caption"),
    /** 由 ASR 生成的 .ass 文件路径 */
    assPath: z.string(),
  }),
]);
export type TextLayer = z.infer<typeof TextLayer>;

export const Output = z.object({
  format: z.literal("mp4").default("mp4"),
  vcodec: z.enum(["h264", "hevc"]).default("h264"),
  crf: z.number().int().min(0).max(51).default(20),
  preset: z
    .enum(["ultrafast", "veryfast", "fast", "medium", "slow"])
    .default("veryfast"),
});

export const RenderSpec = z.object({
  canvas: Canvas,
  bgm: Bgm.nullable().default(null),
  segments: z.array(Segment).min(1),
  textLayers: z.array(TextLayer).default([]),
  output: Output.default({}),
});
export type RenderSpec = z.infer<typeof RenderSpec>;
