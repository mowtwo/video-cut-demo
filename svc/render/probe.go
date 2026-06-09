package main

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

type pathReq struct {
	Path string `json:"path" binding:"required"`
}

// ffprobe 原始 JSON 的最小解析结构
type ffprobeOut struct {
	Streams []struct {
		CodecType    string `json:"codec_type"`
		CodecName    string `json:"codec_name"`
		Width        int    `json:"width"`
		Height       int    `json:"height"`
		RFrameRate   string `json:"r_frame_rate"`
		AvgFrameRate string `json:"avg_frame_rate"`
		Duration     string `json:"duration"`
	} `json:"streams"`
	Format struct {
		Duration string `json:"duration"`
	} `json:"format"`
}

func probeHandler(c *gin.Context) {
	var req pathReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if _, err := os.Stat(req.Path); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file not found: " + req.Path})
		return
	}

	res, err := probe(req.Path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

func probe(path string) (*ProbeResult, error) {
	out, err := runOut("ffprobe", "-v", "quiet",
		"-print_format", "json", "-show_format", "-show_streams", path)
	if err != nil {
		return nil, err
	}
	var raw ffprobeOut
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, err
	}

	res := &ProbeResult{}
	if d, err := strconv.ParseFloat(strings.TrimSpace(raw.Format.Duration), 64); err == nil {
		res.DurationMs = int64(d * 1000)
	}
	for _, s := range raw.Streams {
		switch s.CodecType {
		case "video":
			if res.Width == 0 {
				res.Width = s.Width
				res.Height = s.Height
				res.Codec = s.CodecName
				res.Fps = parseFps(s.AvgFrameRate, s.RFrameRate)
			}
		case "audio":
			res.HasAudio = true
		}
	}
	return res, nil
}

// "30000/1001" -> 29.97
func parseFps(avg, r string) float64 {
	for _, s := range []string{avg, r} {
		parts := strings.SplitN(s, "/", 2)
		if len(parts) == 2 {
			num, e1 := strconv.ParseFloat(parts[0], 64)
			den, e2 := strconv.ParseFloat(parts[1], 64)
			if e1 == nil && e2 == nil && den != 0 && num != 0 {
				return num / den
			}
		}
	}
	return 30
}
