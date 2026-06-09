package main

import (
	"os/exec"
	"strings"
)

// 探测当前 ffmpeg 构建是否含某些可选滤镜（drawtext 需 libfreetype，ass 需 libass）。
// 某些精简构建(如部分 brew 包)不含这些，需优雅降级而非报错。
var (
	hasDrawtext bool
	hasAss      bool
)

func detectFilters() {
	out, err := exec.Command(ffmpegBin, "-hide_banner", "-filters").Output()
	if err != nil {
		return
	}
	s := string(out)
	hasDrawtext = strings.Contains(s, " drawtext ")
	hasAss = strings.Contains(s, " ass ") || strings.Contains(s, " subtitles ")
}
