package main

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// ---- /thumbnail ----

type thumbReq struct {
	Path  string `json:"path" binding:"required"`
	AtMs  int64  `json:"atMs"`
	Width int    `json:"width"`
	Out   string `json:"out" binding:"required"`
}

func thumbnailHandler(c *gin.Context) {
	var req thumbReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Width <= 0 {
		req.Width = 320
	}
	if err := os.MkdirAll(filepath.Dir(req.Out), 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	ss := fmt.Sprintf("%.3f", float64(req.AtMs)/1000.0)
	args := []string{
		"-y", "-ss", ss, "-i", req.Path,
		"-frames:v", "1",
		"-vf", fmt.Sprintf("scale=%d:-2", req.Width),
		req.Out,
	}
	logFFmpegCmd(args)
	if _, err := runOut(ffmpegBin, args...); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"path": req.Out})
}

// ---- /scene （场景切点检测）----

type sceneReq struct {
	Path      string  `json:"path" binding:"required"`
	Threshold float64 `json:"threshold"`
}

// 用 ffmpeg select scene 评分输出 showinfo 的 pts_time。
func sceneHandler(c *gin.Context) {
	var req sceneReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Threshold <= 0 {
		req.Threshold = 0.4
	}

	// 注意：select scene 的输出在 stderr(showinfo)。用 metadata print 到 stdout 更稳。
	args := []string{
		"-i", req.Path,
		"-vf", fmt.Sprintf("select='gt(scene,%.3f)',metadata=print:file=-", req.Threshold),
		"-an", "-f", "null", "-",
	}
	logFFmpegCmd(args)
	out, err := runCombined(ffmpegBin, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	cuts := parsePtsTimes(string(out))
	c.JSON(http.StatusOK, gin.H{"cutsMs": cuts})
}

// metadata=print 输出形如：frame:N pts:... pts_time:12.345
func parsePtsTimes(s string) []int64 {
	cuts := []int64{} // 永不返回 nil（避免 JSON null）
	for _, line := range strings.Split(s, "\n") {
		idx := strings.Index(line, "pts_time:")
		if idx < 0 {
			continue
		}
		val := strings.TrimSpace(line[idx+len("pts_time:"):])
		if f, err := strconv.ParseFloat(strings.Fields(val)[0], 64); err == nil {
			cuts = append(cuts, int64(f*1000))
		}
	}
	sort.Slice(cuts, func(i, j int) bool { return cuts[i] < cuts[j] })
	return cuts
}

// ---- /extract-audio （转 16k 单声道 wav，供 ASR 稳定识别）----

func extractAudioHandler(c *gin.Context) {
	var req struct {
		Input string `json:"input" binding:"required"`
		Out   string `json:"out" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := os.MkdirAll(filepath.Dir(req.Out), 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	args := []string{"-y", "-i", req.Input, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", req.Out}
	logFFmpegCmd(args)
	if _, err := runOut(ffmpegBin, args...); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"out": req.Out})
}

// ---- /beat （卡点节拍，aubio；缺失则降级空数组）----

func beatHandler(c *gin.Context) {
	var req pathReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !hasBin("aubiotrack") {
		// 优雅降级：无 aubio 时返回空，上层退到固定节奏
		c.JSON(http.StatusOK, gin.H{"beatsMs": []int64{}, "degraded": true})
		return
	}
	out, err := runOut("aubiotrack", req.Path)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"beatsMs": []int64{}, "degraded": true})
		return
	}
	var beats []int64
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if f, err := strconv.ParseFloat(line, 64); err == nil {
			beats = append(beats, int64(f*1000))
		}
	}
	c.JSON(http.StatusOK, gin.H{"beatsMs": beats, "degraded": false})
}
