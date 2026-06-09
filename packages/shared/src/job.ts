import { z } from "zod";
import { Id, JobStatus, JobType } from "./common.js";

export const Job = z.object({
  id: Id,
  type: JobType,
  projectId: Id,
  payload: z.unknown(),
  status: JobStatus,
  priority: z.number().int().default(0),
  progress: z.number().min(0).max(1).default(0),
  workerId: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
});
export type Job = z.infer<typeof Job>;

/** SSE 推给前端的进度事件 */
export const JobEvent = z.object({
  jobId: Id,
  projectId: Id,
  type: JobType,
  status: JobStatus,
  progress: z.number().min(0).max(1),
  message: z.string().optional(),
  ts: z.number(),
});
export type JobEvent = z.infer<typeof JobEvent>;

/** 能力探测：前端据此决定是否显示 AI / 字幕 按钮 */
export const Capabilities = z.object({
  ai: z.boolean(),
  asr: z.boolean(),
  hwaccel: z.string(),
});
export type Capabilities = z.infer<typeof Capabilities>;
