import { z } from "zod";
import { AspectRatio, Id, ProjectStatus } from "./common.js";

/** 工程：一次混剪任务的容器 */
export const Project = z.object({
  id: Id,
  title: z.string(),
  templateId: z.string().nullable(),
  aspect: AspectRatio.default("original"),
  status: ProjectStatus,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Project = z.infer<typeof Project>;

/** 源视频：一个工程可有多个 */
export const Source = z.object({
  id: Id,
  projectId: Id,
  filename: z.string(),
  path: z.string(),
  durationMs: z.number(),
  width: z.number(),
  height: z.number(),
  fps: z.number(),
  codec: z.string(),
  hasAudio: z.boolean(),
  thumbPath: z.string().nullable(),
  createdAt: z.number(),
});
export type Source = z.infer<typeof Source>;

/** clip：自动分割出的素材片段，时间相对其 source */
export const Clip = z.object({
  id: Id,
  projectId: Id,
  sourceId: Id,
  startMs: z.number(),
  endMs: z.number(),
  durationMs: z.number(),
  thumbPath: z.string().nullable(),
  score: z.number().nullable(),
  orderIndex: z.number(),
  included: z.boolean(),
  createdAt: z.number(),
});
export type Clip = z.infer<typeof Clip>;

/** 分析结果：场景切点 / 节拍点 / 高光评分段 */
export const AnalysisKind = z.enum(["scene", "beat", "highlight"]);
export type AnalysisKind = z.infer<typeof AnalysisKind>;

export const Analysis = z.object({
  id: Id,
  projectId: Id,
  sourceId: Id.nullable(),
  kind: AnalysisKind,
  /** scene/beat: number[]（ms）; highlight: {startMs,endMs,score}[] */
  data: z.unknown(),
  createdAt: z.number(),
});
export type Analysis = z.infer<typeof Analysis>;

/** 出片结果 */
export const Render = z.object({
  id: Id,
  projectId: Id,
  outPath: z.string().nullable(),
  thumbPath: z.string().nullable(),
  durationMs: z.number().nullable(),
  aspect: AspectRatio,
  templateId: z.string().nullable(),
  aiRefined: z.boolean(),
  prompt: z.string().nullable(),
  status: z.string(),
  createdAt: z.number(),
});
export type Render = z.infer<typeof Render>;
