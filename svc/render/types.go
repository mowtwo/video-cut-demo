package main

// 与 packages/shared 的 Zod 契约对应的 Go 结构体（JSON 用 camelCase）。

type ProbeResult struct {
	DurationMs int64   `json:"durationMs"`
	Width      int     `json:"width"`
	Height     int     `json:"height"`
	Fps        float64 `json:"fps"`
	Codec      string  `json:"codec"`
	HasAudio   bool    `json:"hasAudio"`
}

type Transition struct {
	Type  string `json:"type"`
	DurMs int64  `json:"durMs"`
}

type Canvas struct {
	W   int     `json:"w"`
	H   int     `json:"h"`
	Fps float64 `json:"fps"`
}

type Bgm struct {
	Src            string    `json:"src"`
	GainDb         float64   `json:"gainDb"`
	MixOriginal    bool      `json:"mixOriginal"`
	OriginalGainDb float64   `json:"originalGainDb"`
	Beats          []float64 `json:"beats"`
}

type Transform struct {
	Scale float64 `json:"scale"`
}

type Segment struct {
	ClipID        string      `json:"clipId"`
	Src           string      `json:"src"`
	SrcInMs       int64       `json:"srcInMs"`
	SrcDurMs      int64       `json:"srcDurMs"`
	TargetStartMs int64       `json:"targetStartMs"`
	TargetDurMs   int64       `json:"targetDurMs"`
	Speed         float64     `json:"speed"`
	Fit           string      `json:"fit"`
	Transform     Transform   `json:"transform"`
	TransitionOut *Transition `json:"transitionOut"`
}

type TextStyle struct {
	Font  string `json:"font"`
	Size  int    `json:"size"`
	X     string `json:"x"`
	Y     string `json:"y"`
	Anim  string `json:"anim"`
	Color string `json:"color"`
}

// TextLayer 是 discriminated union（kind: "title" | "caption"）
type TextLayer struct {
	Kind    string     `json:"kind"`
	Content string     `json:"content,omitempty"`
	StartMs int64      `json:"startMs,omitempty"`
	EndMs   int64      `json:"endMs,omitempty"`
	Style   *TextStyle `json:"style,omitempty"`
	AssPath string     `json:"assPath,omitempty"`
}

type Output struct {
	Format string `json:"format"`
	Vcodec string `json:"vcodec"`
	Crf    int    `json:"crf"`
	Preset string `json:"preset"`
}

type RenderSpec struct {
	Canvas     Canvas      `json:"canvas"`
	Bgm        *Bgm        `json:"bgm"`
	Segments   []Segment   `json:"segments"`
	TextLayers []TextLayer `json:"textLayers"`
	Output     Output      `json:"output"`
}

// /render 请求：spec + 进度回调
type RenderReq struct {
	JobID       string     `json:"jobId"`
	Out         string     `json:"out"`         // 输出 mp4 路径
	CallbackURL string     `json:"callbackUrl"` // 进度回调（api 的 /internal/progress）
	Spec        RenderSpec `json:"spec"`
}

type RenderResult struct {
	OutPath    string `json:"outPath"`
	DurationMs int64  `json:"durationMs"`
}
