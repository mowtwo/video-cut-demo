import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      // 前端 /api/* 代理到 Hono 后端，避免 CORS / 硬编码端口
      "/api": {
        target: `http://127.0.0.1:${process.env.API_PORT ?? 8787}`,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
