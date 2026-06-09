package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"syscall"
	"time"
)

// 默认超时：轻量命令 10 分钟，渲染 30 分钟。
const (
	cmdTimeout    = 10 * time.Minute
	renderTimeout = 30 * time.Minute
)

// newCmd 创建带超时、独立进程组的命令；取消时杀掉整个进程组(ffmpeg 会拉子进程)。
func newCmd(ctx context.Context, name string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process != nil {
			return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) // 负 pid = 整个进程组
		}
		return nil
	}
	cmd.WaitDelay = 5 * time.Second // 取消后仍不退则强杀
	return cmd
}

// runOut 运行命令并返回 stdout；出错时把 stderr 一并带回，便于调试。
func runOut(name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()
	cmd := newCmd(ctx, name, args...)
	var errBuf strings.Builder
	cmd.Stderr = &errBuf
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("%s failed: %v: %s", name, err, errBuf.String())
	}
	return out, nil
}

// runCombined 运行命令并返回 stdout+stderr 合并输出（某些 ffmpeg 信息打到 stderr）。
func runCombined(name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()
	cmd := newCmd(ctx, name, args...)
	return cmd.CombinedOutput()
}

// runFFmpegProgress 运行 ffmpeg，解析 -progress pipe:1 的 out_time_us，
// 按 totalMs 计算 0..1 进度并回调 onProgress。所有命令完整打日志便于人肉复现。
func runFFmpegProgress(args []string, totalMs int64, onProgress func(p float64)) error {
	logFFmpegCmd(args)
	ctx, cancel := context.WithTimeout(context.Background(), renderTimeout)
	defer cancel()
	cmd := newCmd(ctx, ffmpegBin, args...)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	var errBuf strings.Builder
	cmd.Stderr = &errBuf

	if err := cmd.Start(); err != nil {
		return err
	}

	go parseProgress(stdout, totalMs, onProgress)

	if err := cmd.Wait(); err != nil {
		tail := errBuf.String()
		if len(tail) > 2000 {
			tail = tail[len(tail)-2000:]
		}
		return fmt.Errorf("ffmpeg failed: %v\n%s", err, tail)
	}
	return nil
}

func parseProgress(r io.Reader, totalMs int64, onProgress func(p float64)) {
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "out_time_us=") {
			var us int64
			fmt.Sscanf(line, "out_time_us=%d", &us)
			if totalMs > 0 {
				p := float64(us) / 1000.0 / float64(totalMs)
				if p > 0.99 {
					p = 0.99
				}
				if p >= 0 {
					onProgress(p)
				}
			}
		}
	}
}

func logFFmpegCmd(args []string) {
	// 完整命令行落日志，可直接复制到终端复跑
	quoted := make([]string, len(args))
	for i, a := range args {
		if strings.ContainsAny(a, " '\"") {
			quoted[i] = "'" + strings.ReplaceAll(a, "'", "'\\''") + "'"
		} else {
			quoted[i] = a
		}
	}
	fmt.Printf("[render] ffmpeg %s\n", strings.Join(quoted, " "))
}
