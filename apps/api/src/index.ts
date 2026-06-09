import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { openDb } from "@vcd/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { mkdirSync } from "node:fs";
import { relative } from "node:path";
import { config, dbPath, paths } from "./config.js";
import { registerRoutes } from "./routes.js";
import { startWorker } from "./worker.js";

// 打开 DB（建表 + 迁移 + WAL）
openDb(dbPath());
// 确保运行时目录存在
for (const d of [paths.media(), paths.thumbs(), paths.out(), paths.assets()]) {
  mkdirSync(d, { recursive: true });
}

const app = new Hono();
app.use("*", logger());
app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true, service: "api", ts: Date.now() }));

// 静态服务运行时文件：/files/<relPath> -> data/<relPath>
app.use(
  "/files/*",
  serveStatic({
    root: relative(process.cwd(), config.dataDir) || ".",
    rewriteRequestPath: (p) => p.replace(/^\/files/, ""),
  }),
);

registerRoutes(app);

startWorker();

serve({ fetch: app.fetch, port: config.apiPort }, (info) => {
  console.log(`[api] listening on http://127.0.0.1:${info.port}`);
  console.log(`[api] data dir: ${config.dataDir}`);
});
