# apps/api —— Node + Hono 编排服务
# 构建上下文: 仓库根(需要 pnpm workspace 的 packages/*)
# 运行用 Node 24(内置 node:sqlite) + tsx 直跑 TS。

FROM node:24-slim
RUN corepack enable
WORKDIR /app

# 先拷 manifest 利用缓存
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/api ./apps/api
# workspace 里还声明了 web / svc/render，补上它们的 package.json 以满足 frozen 安装
COPY apps/web/package.json ./apps/web/package.json
COPY svc/render/package.json ./svc/render/package.json

RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production \
    API_PORT=8787 \
    DATA_DIR=/data \
    RENDER_HWACCEL=none
EXPOSE 8787
WORKDIR /app/apps/api
CMD ["node_modules/.bin/tsx", "src/index.ts"]
