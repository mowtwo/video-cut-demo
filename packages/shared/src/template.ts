import { z } from "zod";
import { TransitionType } from "./renderspec.js";

/**
 * 混剪模板定义 —— 声明式描述「选段策略 + 节奏 + 风格 + 音频」。
 * 编译器 compile(template, clips, analysis, opts) => RenderSpec (纯函数)。
 * 全部不依赖 AI；AI 仅作 refine 可选项。
 */

export const TemplateId = z.enum([
  "highlight", // 高光混剪
  "pov", // POV 文案视频
  "dialogue", // 剧情/对话混剪
  "character", // 人物混剪
  "suspense", // 悬念引流视频
]);
export type TemplateId = z.infer<typeof TemplateId>;

export const SelectionStrategy = z.enum([
  "top_score", // 按高光评分取 top-K
  "sequential", // 按时间顺序保留
  "has_speech", // 优先有语音的段
  "has_face", // 优先含人脸/主体的段(v1 用启发式)
  "hook_first", // 最高分做钩子开头
]);

export const PacingMode = z.enum(["fixed", "beat_sync"]);

export const TemplateDef = z.object({
  id: TemplateId,
  name: z.string(),
  description: z.string(),
  selection: z.object({
    strategy: SelectionStrategy,
    maxClips: z.number().int().positive().default(12),
    minGapMs: z.number().nonnegative().default(300),
  }),
  pacing: z.object({
    mode: PacingMode,
    fallbackSegMs: z.number().positive().default(1500),
    beatsPerCut: z.number().int().positive().default(1),
  }),
  style: z.object({
    transition: TransitionType,
    transitionMs: z.number().nonnegative().default(200),
    title: z
      .object({
        enabled: z.boolean().default(true),
        pos: z.enum(["top", "center", "bottom"]).default("top"),
      })
      .default({}),
  }),
  audio: z.object({
    useBgm: z.boolean().default(true),
    duckOriginal: z.boolean().default(true),
  }),
});
export type TemplateDef = z.infer<typeof TemplateDef>;
