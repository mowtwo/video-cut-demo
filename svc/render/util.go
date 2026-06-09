package main

import (
	"os"
	"sync"
)

// ---- probe 缓存（同一 src 在一次 render 里只探一次）----
var (
	probeMu    sync.Mutex
	probeStore = map[string]*ProbeResult{}
)

func probeCached(path string) (*ProbeResult, error) {
	probeMu.Lock()
	if r, ok := probeStore[path]; ok {
		probeMu.Unlock()
		return r, nil
	}
	probeMu.Unlock()

	r, err := probe(path)
	if err != nil {
		return nil, err
	}
	probeMu.Lock()
	probeStore[path] = r
	probeMu.Unlock()
	return r, nil
}

// ---- 字体解析（drawtext 大字标题需要 CJK 字体）----
// 优先 RENDER_FONT 环境变量；否则探测常见 Mac / Linux CJK 字体；都没有则返回空(让 ffmpeg 自行 fontconfig)。
func resolveFont(_ string) string {
	if f := os.Getenv("RENDER_FONT"); f != "" {
		if _, err := os.Stat(f); err == nil {
			return f
		}
	}
	candidates := []string{
		"/System/Library/Fonts/PingFang.ttc",                     // macOS
		"/System/Library/Fonts/Hiragino Sans GB.ttc",             // macOS
		"/System/Library/Fonts/STHeiti Medium.ttc",               // macOS
		"/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", // Linux Noto
		"/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", // Linux Noto
		"/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",      // Linux Noto
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}
