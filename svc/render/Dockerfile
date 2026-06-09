# svc/render —— Go ffmpeg 微服务
# 运行时镜像内含全功能 ffmpeg(libass/libfreetype/fontconfig)、aubio、Noto CJK 字体，
# 所以大字标题/字幕/卡点在容器里都可用(无需像 macOS 那样单独装 ffmpeg-full)。
# 构建上下文: svc/render

FROM golang:1.26-bookworm AS build
# 容器构建拿不到宿主代理，用国内镜像保证拉得到模块
ENV GOPROXY=https://goproxy.cn,direct
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /render .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg aubio-tools fonts-noto-cjk ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /render /usr/local/bin/render

ENV RENDER_HOST=0.0.0.0 \
    RENDER_PORT=8790 \
    RENDER_HWACCEL=none \
    FFMPEG_BIN=ffmpeg \
    FFPROBE_BIN=ffprobe
EXPOSE 8790
CMD ["render"]
