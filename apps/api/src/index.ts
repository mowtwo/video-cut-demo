import { serve } from "@hono/node-server";
import { openDb } from "@vcd/db";
import type { Capabilities } from "@vcd/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config, dbPath } from "./config.js";

// 启动即打开 DB（建表 + WAL）。后续路由会用到。
const db = openDb(dbPath());

const app = new Hono();
app.use("*", logger());
app.use("*", cors());

app.get("/health", (c) =>
  c.json({ ok: true, service: "api", ts: Date.now() }),
);

// 能力探测：前端据此决定是否显示 AI / 字幕 按钮
app.get("/capabilities", (c) => {
  const caps: Capabilities = {
    ai: config.anthropicApiKey.length > 0,
    asr: config.asrUrl.length > 0,
    hwaccel: config.renderHwaccel,
  };
  return c.json(caps);
});

// TODO(M1+): /projects, /sources, /clips, /render, /events(SSE)

const port = config.apiPort;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[api] listening on http://127.0.0.1:${info.port}`);
  console.log(`[api] db: ${dbPath()}`);
});

// 优雅退出，确保 WAL 落盘
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    db.close();
    process.exit(0);
  });
}
