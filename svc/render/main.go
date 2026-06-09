// svc/render —— ffmpeg 执行微服务 (Gin)。
// 无状态执行单元：probe / thumbnail / scene / beat / render。
// 进程池限制并发；render 用 ffmpeg -progress 解析进度并回调 api。
package main

import (
	"log"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// 重型 ffmpeg 任务的并发闸（避免 CPU 过订阅）。
var heavySem chan struct{}

// ffmpeg / ffprobe 可执行文件路径（可用 FFMPEG_BIN/FFPROBE_BIN 指向全功能构建，
// 如 keg-only 的 ffmpeg-full，而不影响系统默认 ffmpeg）。
var (
	ffmpegBin  = "ffmpeg"
	ffprobeBin = "ffprobe"
)

func main() {
	port := getenv("RENDER_PORT", "8790")
	ffmpegBin = getenv("FFMPEG_BIN", "ffmpeg")
	ffprobeBin = getenv("FFPROBE_BIN", "ffprobe")

	maxConc := envInt("RENDER_MAX_CONCURRENT", 0)
	if maxConc <= 0 {
		maxConc = runtime.NumCPU() / 4
		if maxConc < 1 {
			maxConc = 1
		}
	}
	heavySem = make(chan struct{}, maxConc)
	log.Printf("[render] heavy concurrency = %d", maxConc)

	detectFilters()
	log.Printf("[render] filters: drawtext=%v ass=%v", hasDrawtext, hasAss)

	r := gin.Default()

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"ok":      true,
			"service": "render",
			"ffmpeg":   hasBin(ffmpegBin),
			"ffprobe":  hasBin(ffprobeBin),
			"aubio":    hasBin("aubiotrack"),
			"drawtext": hasDrawtext,
			"ass":      hasAss,
			"hwaccel":  getenv("RENDER_HWACCEL", "none"),
			"ts":      time.Now().UnixMilli(),
		})
	})

	r.POST("/probe", probeHandler)         // {path} -> ProbeResult
	r.POST("/thumbnail", thumbnailHandler) // {path, atMs, width, out} -> {path}
	r.POST("/scene", sceneHandler)         // {path, threshold} -> {cutsMs:[...]}
	r.POST("/beat", beatHandler)           // {path} -> {beatsMs:[...]} (无 aubio 则空)
	r.POST("/render", renderHandler)       // {jobId,out,callbackUrl,spec} -> RenderResult
	r.POST("/burnsub", burnSubHandler)     // {input,ass,out} -> 烧录字幕
	r.POST("/extract-audio", extractAudioHandler) // {input,out} -> 16k 单声道 wav(给 ASR)
	r.POST("/clip", clipHandler)                  // {input,startMs,endMs,out} -> 切出片段(可下载)
	r.POST("/speech-track", speechTrackHandler)   // {spec,out} -> 对齐成片的纯人声 wav(给字幕识别)

	log.Printf("[render] listening on http://127.0.0.1:%s", port)
	if err := r.Run("127.0.0.1:" + port); err != nil {
		log.Fatal(err)
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func hasBin(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}
