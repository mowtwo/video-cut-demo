# apps/web —— Vite 构建静态资源，用 nginx 托管并反代 /api 到 api 服务
# 构建上下文: 仓库根

FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @vcd/web build

FROM nginx:alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
