import { z } from "zod";

/** 所有 id 都是字符串 uuid */
export const Id = z.string().min(1);

export const AspectRatio = z.enum(["9:16", "3:4", "original"]);
export type AspectRatio = z.infer<typeof AspectRatio>;

/** 画幅适配方式 */
export const FitMode = z.enum(["crop", "pad", "blur_pad"]);
export type FitMode = z.infer<typeof FitMode>;

export const ProjectStatus = z.enum([
  "draft",
  "analyzing",
  "ready",
  "rendering",
  "done",
  "failed",
]);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const JobType = z.enum([
  "probe",
  "thumb",
  "segment",
  "analyze",
  "beat",
  "render",
  "asr",
]);
export type JobType = z.infer<typeof JobType>;

export const JobStatus = z.enum([
  "queued",
  "running",
  "done",
  "failed",
  "canceled",
]);
export type JobStatus = z.infer<typeof JobStatus>;
