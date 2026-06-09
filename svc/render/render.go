package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func renderHandler(c *gin.Context) {
	var req RenderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.Spec.Segments) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "spec.segments is empty"})
		return
	}

	// 并发闸：重型 ffmpeg 限流
	heavySem <- struct{}{}
	defer func() { <-heavySem }()

	if err := os.MkdirAll(filepath.Dir(req.Out), 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	args, totalMs, cleanup, err := buildRenderArgs(&req.Spec, req.Out)
	if cleanup != nil {
		defer cleanup()
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "build filtergraph: " + err.Error()})
		return
	}

	// 进度回调（节流：每变化 ~2% 推一次）
	lastSent := -1.0
	onProgress := func(p float64) {
		if p-lastSent >= 0.02 {
			lastSent = p
			postProgress(req.CallbackURL, req.JobID, p, "rendering")
		}
	}

	if err := runFFmpegProgress(args, totalMs, onProgress); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 实测输出时长
	var durMs int64 = totalMs
	if pr, err := probe(req.Out); err == nil && pr.DurationMs > 0 {
		durMs = pr.DurationMs
	}
	postProgress(req.CallbackURL, req.JobID, 1.0, "done")
	c.JSON(http.StatusOK, RenderResult{OutPath: req.Out, DurationMs: durMs})
}

// burnSubHandler 把 ASS 字幕烧录到已有 mp4（单输入，便宜的二次编码）。
func burnSubHandler(c *gin.Context) {
	var req struct {
		Input string `json:"input" binding:"required"`
		Ass   string `json:"ass" binding:"required"`
		Out   string `json:"out" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !hasAss {
		// 无 libass：无法烧录，告知调用方降级（保留无字幕版本）
		c.JSON(http.StatusNotImplemented, gin.H{"error": "ffmpeg 不含 ass 滤镜(缺 libass)，跳过字幕"})
		return
	}
	heavySem <- struct{}{}
	defer func() { <-heavySem }()

	if err := os.MkdirAll(filepath.Dir(req.Out), 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	esc := strings.ReplaceAll(req.Ass, `\`, `\\`)
	esc = strings.ReplaceAll(esc, ":", `\:`)
	args := []string{"-y", "-i", req.Input, "-vf", "ass='" + esc + "'"}
	args = append(args, encoderArgs(Output{})...)
	args = append(args, "-c:a", "copy", req.Out)
	logFFmpegCmd(args)
	if _, err := runOut(ffmpegBin, args...); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"outPath": req.Out})
}

// buildRenderArgs 把 RenderSpec 编译成完整 ffmpeg 参数。
// 返回 args、预估总时长(ms)、清理函数(删临时 textfile)、错误。
func buildRenderArgs(spec *RenderSpec, out string) ([]string, int64, func(), error) {
	w, h := spec.Canvas.W, spec.Canvas.H
	fps := spec.Canvas.Fps
	if fps <= 0 {
		fps = 30
	}
	n := len(spec.Segments)

	var inputs []string // -ss/-t/-i 三元组
	var fc []string     // filter_complex 片段
	var tmpFiles []string

	// ---- 每段视频归一化 -> [v{i}] ----
	for i, seg := range spec.Segments {
		ssSec := float64(seg.SrcInMs) / 1000.0
		tSec := float64(seg.SrcDurMs) / 1000.0
		inputs = append(inputs,
			"-ss", fmt.Sprintf("%.3f", ssSec),
			"-t", fmt.Sprintf("%.3f", tSec),
			"-i", seg.Src,
		)
		fc = append(fc, segVideoFilter(i, seg, w, h, fps))
	}

	// 预估时长 & 是否走 xfade
	// 混入原声时强制硬切(concat)，避免 xfade 让视频变短而原声音轨错位。
	useXfade := spec.Bgm != nil && allHaveTransition(spec.Segments) && !spec.Bgm.MixOriginal
	totalMs := estimateTotalMs(spec.Segments, useXfade)

	// ---- 视频拼接 ----
	var vlabel string
	if useXfade {
		fc = append(fc, xfadeChain(spec.Segments)...)
		vlabel = fmt.Sprintf("[xf%d]", n-1)
	} else {
		var b strings.Builder
		for i := 0; i < n; i++ {
			b.WriteString(fmt.Sprintf("[v%d]", i))
		}
		b.WriteString(fmt.Sprintf("concat=n=%d:v=1:a=0[vcat]", n))
		fc = append(fc, b.String())
		vlabel = "[vcat]"
	}

	// ---- 文字图层（drawtext 大字标题 / ass 字幕）----
	vlabel, textFC, textTmp, err := applyTextLayers(spec.TextLayers, vlabel)
	if err != nil {
		return nil, 0, nil, err
	}
	fc = append(fc, textFC...)
	tmpFiles = append(tmpFiles, textTmp...)

	// ---- 音频 ----
	// 三种情况：无 bgm=原声；有 bgm 且 mixOriginal=配乐+原声混合；有 bgm 不混=仅配乐。
	mixOriginal := spec.Bgm != nil && spec.Bgm.MixOriginal
	needOriginal := spec.Bgm == nil || mixOriginal
	var amap string

	if needOriginal {
		// 每段原声 -> [a{i}] -> concat -> [aorig]（缺音轨的段用 anullsrc 补静音）
		for i, seg := range spec.Segments {
			dur := float64(seg.SrcDurMs) / 1000.0 / nonZero(seg.Speed)
			pr, _ := probeCached(seg.Src)
			if pr != nil && pr.HasAudio {
				fc = append(fc, fmt.Sprintf("[%d:a]asetpts=PTS-STARTPTS,atempo=%.3f,aresample=44100[a%d]", i, nonZero(seg.Speed), i))
			} else {
				fc = append(fc, fmt.Sprintf("anullsrc=r=44100:cl=stereo,atrim=0:%.3f,asetpts=PTS-STARTPTS[a%d]", dur, i))
			}
		}
		var b strings.Builder
		for i := 0; i < n; i++ {
			b.WriteString(fmt.Sprintf("[a%d]", i))
		}
		b.WriteString(fmt.Sprintf("concat=n=%d:v=0:a=1[aorig]", n))
		fc = append(fc, b.String())
	}

	if spec.Bgm != nil {
		idx := len(spec.Segments) // bgm 输入索引
		inputs = append(inputs,
			"-t", fmt.Sprintf("%.3f", float64(totalMs)/1000.0),
			"-i", spec.Bgm.Src,
		)
		fc = append(fc, fmt.Sprintf("[%d:a]volume=%.1fdB,aresample=44100[abgm]", idx, spec.Bgm.GainDb))
		if mixOriginal {
			fc = append(fc, fmt.Sprintf("[aorig]volume=%.1fdB[aorigv]", spec.Bgm.OriginalGainDb))
			// normalize=0 保留各自设定音量；longest 覆盖整段
			fc = append(fc, "[abgm][aorigv]amix=inputs=2:duration=longest:normalize=0[aout]")
			amap = "[aout]"
		} else {
			amap = "[abgm]"
		}
	} else {
		amap = "[aorig]"
	}

	// ---- 组装 args ----
	args := []string{"-y"}
	args = append(args, inputs...)
	args = append(args, "-filter_complex", strings.Join(fc, ";"))
	args = append(args, "-map", vlabel, "-map", amap)
	args = append(args, encoderArgs(spec.Output)...)
	args = append(args,
		"-c:a", "aac", "-b:a", "192k",
		"-r", fmt.Sprintf("%.3f", fps),
		"-movflags", "+faststart",
		"-progress", "pipe:1", "-nostats",
		out,
	)

	cleanup := func() {
		for _, f := range tmpFiles {
			os.Remove(f)
		}
	}
	return args, totalMs, cleanup, nil
}

// 每段视频：重置时间戳+变速 -> fps -> 画幅适配 -> [v{i}]
func segVideoFilter(i int, seg Segment, w, h int, fps float64) string {
	sp := nonZero(seg.Speed)
	base := fmt.Sprintf("[%d:v]setpts=(PTS-STARTPTS)/%.4f,fps=%.3f,format=yuv420p", i, sp, fps)

	switch seg.Fit {
	case "pad":
		return fmt.Sprintf("%s,scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[v%d]",
			base, w, h, w, h, i)
	case "blur_pad":
		return fmt.Sprintf("%s,split=2[fg%d][bg%d];"+
			"[bg%d]scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,gblur=sigma=20[bgb%d];"+
			"[fg%d]scale=%d:%d:force_original_aspect_ratio=decrease[fgs%d];"+
			"[bgb%d][fgs%d]overlay=(W-w)/2:(H-h)/2,setsar=1[v%d]",
			base, i, i,
			i, w, h, w, h, i,
			i, w, h, i,
			i, i, i)
	default: // crop（填满裁切）
		return fmt.Sprintf("%s,scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,setsar=1[v%d]",
			base, w, h, w, h, i)
	}
}

// xfade 链：offset 累计计算
func xfadeChain(segs []Segment) []string {
	var out []string
	accLen := float64(segs[0].SrcDurMs) / 1000.0 / nonZero(segs[0].Speed)
	prev := "[v0]"
	for k := 1; k < len(segs); k++ {
		t := float64(segs[k-1].TransitionOut.DurMs) / 1000.0
		typ := segs[k-1].TransitionOut.Type
		if typ == "" || typ == "none" {
			typ = "fade"
		}
		offset := accLen - t
		if offset < 0 {
			offset = 0
		}
		label := fmt.Sprintf("[xf%d]", k)
		out = append(out, fmt.Sprintf("%s[v%d]xfade=transition=%s:duration=%.3f:offset=%.3f%s",
			prev, k, typ, t, offset, label))
		dk := float64(segs[k].SrcDurMs) / 1000.0 / nonZero(segs[k].Speed)
		accLen = accLen + dk - t
		prev = label
	}
	return out
}

// drawtext 标题 + ass 字幕
func applyTextLayers(layers []TextLayer, vin string) (string, []string, []string, error) {
	cur := vin
	var fc []string
	var tmp []string
	idx := 0
	for _, l := range layers {
		switch l.Kind {
		case "title":
			if l.Style == nil || !hasDrawtext {
				continue // 无 drawtext(缺 libfreetype) 时优雅跳过大字标题
			}
			// 文案写入临时文件，避开 drawtext 转义地狱
			tf, err := os.CreateTemp("", "vcd-title-*.txt")
			if err != nil {
				return cur, fc, tmp, err
			}
			tf.WriteString(l.Content)
			tf.Close()
			tmp = append(tmp, tf.Name())

			font := resolveFont(l.Style.Font)
			size := l.Style.Size
			if size <= 0 {
				size = 96
			}
			color := l.Style.Color
			if color == "" {
				color = "white"
			}
			if strings.HasPrefix(color, "#") {
				color = "0x" + color[1:] // ffmpeg drawtext 用 0xRRGGBB
			}
			s := float64(l.StartMs) / 1000.0
			e := float64(l.EndMs) / 1000.0
			alpha := fmt.Sprintf("if(lt(t,%.2f),0,if(lt(t,%.2f),(t-%.2f)/0.3,if(lt(t,%.2f),1,max(0,(%.2f-t)/0.3))))",
				s, s+0.3, s, e-0.3, e)
			next := fmt.Sprintf("[txt%d]", idx)
			dt := fmt.Sprintf("%sdrawtext=textfile='%s':x=%s:y=%s:fontsize=%d:fontcolor=%s:box=1:boxcolor=black@0.45:boxborderw=12:alpha='%s':enable='between(t,%.2f,%.2f)'",
				cur, tf.Name(), l.Style.X, l.Style.Y, size, color, alpha, s, e)
			if font != "" {
				dt += ":fontfile='" + font + "'"
			}
			fc = append(fc, dt+next)
			cur = next
			idx++
		case "caption":
			if l.AssPath == "" || !hasAss {
				continue // 无 ass(缺 libass) 时跳过字幕
			}
			next := fmt.Sprintf("[txt%d]", idx)
			esc := strings.ReplaceAll(l.AssPath, `\`, `\\`)
			esc = strings.ReplaceAll(esc, ":", `\:`)
			fc = append(fc, fmt.Sprintf("%sass='%s'%s", cur, esc, next))
			cur = next
			idx++
		}
	}
	return cur, fc, tmp, nil
}

func encoderArgs(o Output) []string {
	hw := getenv("RENDER_HWACCEL", "none")
	crf := o.Crf
	if crf <= 0 {
		crf = 20
	}
	preset := o.Preset
	if preset == "" {
		preset = "veryfast"
	}
	if hw == "videotoolbox" {
		// 硬件编码不吃 crf，用码率近似
		return []string{"-c:v", "h264_videotoolbox", "-b:v", "6M", "-pix_fmt", "yuv420p"}
	}
	return []string{"-c:v", "libx264", "-preset", preset, "-crf", fmt.Sprintf("%d", crf), "-pix_fmt", "yuv420p"}
}

func allHaveTransition(segs []Segment) bool {
	if len(segs) < 2 {
		return false
	}
	for i := 0; i < len(segs)-1; i++ {
		if segs[i].TransitionOut == nil || segs[i].TransitionOut.Type == "" || segs[i].TransitionOut.Type == "none" {
			return false
		}
	}
	return true
}

func estimateTotalMs(segs []Segment, useXfade bool) int64 {
	var total float64
	for _, s := range segs {
		total += float64(s.SrcDurMs) / nonZero(s.Speed)
	}
	if useXfade {
		for i := 0; i < len(segs)-1; i++ {
			if segs[i].TransitionOut != nil {
				total -= float64(segs[i].TransitionOut.DurMs)
			}
		}
	}
	if total < 0 {
		total = 0
	}
	return int64(total)
}

func nonZero(f float64) float64 {
	if f <= 0 {
		return 1
	}
	return f
}

// postProgress 把进度回传给 api 的 /internal/progress
func postProgress(callbackURL, jobID string, p float64, msg string) {
	if callbackURL == "" {
		return
	}
	body, _ := json.Marshal(gin.H{"jobId": jobID, "progress": p, "message": msg})
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Post(callbackURL, "application/json", bytes.NewReader(body))
	if err == nil {
		resp.Body.Close()
	}
}
