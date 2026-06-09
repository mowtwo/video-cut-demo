// svc/render —— ffmpeg 执行微服务 (Gin)。
// M0: 健康检查 + /probe(真实 ffprobe) + /jobs/:id 占位。
// 后续(M2/M3): /thumbnail /clip /scene /beat /render，进程池 + -progress 进度。
package main

import (
	"log"
	"net/http"
	"os"
	"os/exec"
	"time"

	"github.com/gin-gonic/gin"
)

func main() {
	port := getenv("RENDER_PORT", "8790")

	r := gin.Default()

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"ok":      true,
			"service": "render",
			"ffmpeg":  hasBin("ffmpeg"),
			"ffprobe": hasBin("ffprobe"),
			"aubio":   hasBin("aubiotrack"),
			"ts":      time.Now().UnixMilli(),
		})
	})

	// POST /probe {"path": "..."} -> ffprobe json
	r.POST("/probe", probeHandler)

	// 占位：作业状态查询（M3 接入进程池后返回真实进度）
	r.GET("/jobs/:id", func(c *gin.Context) {
		c.JSON(http.StatusNotImplemented, gin.H{
			"error": "not implemented yet",
			"id":    c.Param("id"),
		})
	})

	log.Printf("[render] listening on http://127.0.0.1:%s", port)
	if err := r.Run("127.0.0.1:" + port); err != nil {
		log.Fatal(err)
	}
}

type probeReq struct {
	Path string `json:"path" binding:"required"`
}

func probeHandler(c *gin.Context) {
	var req probeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if _, err := os.Stat(req.Path); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file not found: " + req.Path})
		return
	}

	out, err := exec.Command(
		"ffprobe", "-v", "quiet",
		"-print_format", "json",
		"-show_format", "-show_streams",
		req.Path,
	).Output()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ffprobe failed: " + err.Error()})
		return
	}

	c.Data(http.StatusOK, "application/json", out)
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func hasBin(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}
