import { resolve } from "node:path";

/** 从环境变量读取配置，集中一处。详见根目录 .env.example */
export const config = {
  dataDir: resolve(process.env.DATA_DIR ?? "./data"),
  apiPort: Number(process.env.API_PORT ?? 8787),

  renderUrl: process.env.RENDER_URL ?? "http://127.0.0.1:8790",
  renderHwaccel: process.env.RENDER_HWACCEL ?? "none",

  asrUrl: process.env.ASR_URL ?? "",
  asrModel: process.env.ASR_MODEL ?? "large-v3",

  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  aiModel: process.env.AI_MODEL ?? "claude-sonnet-4-6",
};

export function dbPath() {
  return resolve(config.dataDir, "app.db");
}

import { join } from "node:path";
export const paths = {
  media: () => join(config.dataDir, "media"),
  thumbs: () => join(config.dataDir, "thumbs"),
  out: () => join(config.dataDir, "out"),
  assets: () => join(config.dataDir, "assets"), // bgm / 字体等
};

export const callbackUrl = () =>
  `http://127.0.0.1:${config.apiPort}/internal/progress`;

// DB 里统一存「相对 dataDir 的路径」(如 "media/x.mp4")。
// 落盘/调 render 用绝对路径；返回前端用 /files/ URL。
export const absPath = (rel: string) => join(config.dataDir, rel);
export const fileUrl = (rel: string | null) => (rel ? `/files/${rel}` : null);
