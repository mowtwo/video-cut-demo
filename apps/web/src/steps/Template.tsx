import { Cross2Icon, SpeakerLoudIcon } from "@radix-ui/react-icons";
import type { Capabilities } from "@vcd/shared";
import { useRef, useState } from "react";
import { api, asset, type ProjectBundle } from "../api.js";

const ASPECTS = [
  { id: "9:16", label: "9:16 竖屏" },
  { id: "3:4", label: "3:4 竖屏" },
  { id: "original", label: "原始比例" },
];
const TITLE_SIZES = [
  { id: "small", label: "小", pct: 5.5 },
  { id: "medium", label: "中", pct: 7.5 },
  { id: "large", label: "大", pct: 10 },
];
const COLORS = ["white", "#FFD400", "#FF4D4F", "#00E0FF", "black"];

export function Template({
  projectId, bundle, templates, caps, onGenerate, refresh,
}: {
  projectId: string;
  bundle: ProjectBundle;
  templates: { id: string; name: string; description: string }[];
  caps: Capabilities | null;
  onGenerate: (opts: Record<string, unknown>) => void;
  refresh: () => void;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "highlight");
  const [aspect, setAspect] = useState("original");
  const [title, setTitle] = useState(bundle.project.title);
  const [withSubtitle, setWithSubtitle] = useState(false);
  const [useAi, setUseAi] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [uploadingBgm, setUploadingBgm] = useState(false);
  const bgmInput = useRef<HTMLInputElement>(null);

  // 音频
  const [audioMode, setAudioMode] = useState<"mix" | "bgm" | "original">("original");
  const [bgmVolume, setBgmVolume] = useState(100);
  const [originalVolume, setOriginalVolume] = useState(100);

  // 标题样式
  const [titlePos, setTitlePos] = useState<"top" | "center" | "bottom">("top");
  const [titleSize, setTitleSize] = useState("medium");
  const [titleDuration, setTitleDuration] = useState(2.6);
  const [titleColor, setTitleColor] = useState("white");

  const bgmUrl = bundle.project.bgmUrl;

  async function uploadBgm(f: File | undefined) {
    if (!f) return;
    setUploadingBgm(true);
    try {
      await api.uploadBgm(projectId, f);
      setAudioMode("bgm");
      refresh();
    } finally {
      setUploadingBgm(false);
    }
  }

  function generate() {
    onGenerate({
      templateId, aspect, title, withSubtitle, useAi, prompt: prompt || null,
      audioMode: bgmUrl ? audioMode : "original",
      bgmVolume, originalVolume,
      titleStyle: {
        pos: titlePos,
        durationSec: titleDuration,
        sizePct: TITLE_SIZES.find((s) => s.id === titleSize)?.pct ?? 7.5,
        color: titleColor,
      },
    });
  }

  return (
    <div className="space-y-6">
      {/* 模板 */}
      <div>
        <h3 className="mb-2 text-sm text-neutral-400">选择混剪模板</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {templates.map((t) => (
            <button key={t.id} onClick={() => setTemplateId(t.id)}
              className={`rounded-lg border p-3 text-left transition ${templateId === t.id ? "border-emerald-400 bg-emerald-400/10" : "border-neutral-700 hover:border-neutral-500"}`}>
              <div className="font-medium text-neutral-100">{t.name}</div>
              <div className="mt-1 text-xs text-neutral-400">{t.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 画幅 */}
      <div>
        <h3 className="mb-2 text-sm text-neutral-400">输出画幅</h3>
        <div className="flex gap-2">
          {ASPECTS.map((a) => (
            <button key={a.id} onClick={() => setAspect(a.id)}
              className={`rounded-md border px-3 py-1.5 text-sm ${aspect === a.id ? "border-emerald-400 bg-emerald-400/10 text-neutral-100" : "border-neutral-700 text-neutral-400"}`}>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* 大字标题 */}
      <div>
        <h3 className="mb-2 text-sm text-neutral-400">大字标题</h3>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="留空则不显示标题"
          className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-400" />
        {title && (
          <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg border border-neutral-800 p-3 text-xs">
            <Field label="位置">
              <Seg options={[["top", "顶部"], ["center", "居中"], ["bottom", "底部"]]} value={titlePos} onChange={(v) => setTitlePos(v as any)} />
            </Field>
            <Field label="字号">
              <Seg options={TITLE_SIZES.map((s) => [s.id, s.label] as [string, string])} value={titleSize} onChange={setTitleSize} />
            </Field>
            <Field label={`显示时长 ${titleDuration.toFixed(1)}s`}>
              <input type="range" min={1} max={6} step={0.5} value={titleDuration} onChange={(e) => setTitleDuration(+e.target.value)} className="w-full" />
            </Field>
            <Field label="颜色">
              <div className="flex gap-1.5">
                {COLORS.map((c) => (
                  <button key={c} onClick={() => setTitleColor(c)}
                    style={{ background: c }}
                    className={`h-6 w-6 rounded-full border-2 ${titleColor === c ? "border-emerald-400" : "border-neutral-600"}`} />
                ))}
              </div>
            </Field>
          </div>
        )}
      </div>

      {/* 配乐 + 混音 */}
      <div>
        <h3 className="mb-2 text-sm text-neutral-400">配乐与混音</h3>
        <div className="space-y-3 rounded-lg border border-neutral-800 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <input ref={bgmInput} type="file" accept="audio/*" className="hidden" onChange={(e) => uploadBgm(e.target.files?.[0])} />
            <button onClick={() => bgmInput.current?.click()}
              className="flex items-center gap-1.5 rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800">
              <SpeakerLoudIcon /> {uploadingBgm ? "上传中…" : bgmUrl ? "更换音乐" : "上传音乐"}
            </button>
            {bgmUrl && (
              <>
                <audio src={asset(bgmUrl)} controls className="h-8" />
                <button onClick={async () => { await api.clearBgm(projectId); setAudioMode("original"); refresh(); }}
                  className="flex items-center gap-1 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800">
                  <Cross2Icon /> 移除
                </button>
              </>
            )}
          </div>

          <Field label="混音模式">
            <Seg
              options={[["mix", "配乐+原声"], ["bgm", "仅配乐"], ["original", "仅原声"]]}
              value={bgmUrl ? audioMode : "original"}
              onChange={(v) => setAudioMode(v as any)}
              disabledIds={bgmUrl ? [] : ["mix", "bgm"]}
            />
          </Field>
          {!bgmUrl && <p className="text-[11px] text-neutral-500">未上传音乐时只能用原声；上传后可混合。</p>}

          {bgmUrl && audioMode !== "original" && (
            <Field label={`配乐音量 ${bgmVolume}%`}>
              <input type="range" min={0} max={150} value={bgmVolume} onChange={(e) => setBgmVolume(+e.target.value)} className="w-full" />
            </Field>
          )}
          {bgmUrl && audioMode === "mix" && (
            <Field label={`原声音量 ${originalVolume}%`}>
              <input type="range" min={0} max={150} value={originalVolume} onChange={(e) => setOriginalVolume(+e.target.value)} className="w-full" />
            </Field>
          )}
        </div>
      </div>

      {/* 字幕 / AI */}
      <div className="space-y-2">
        <label className={`flex items-center gap-2 text-sm ${caps?.asr ? "text-neutral-200" : "text-neutral-600"}`}>
          <input type="checkbox" disabled={!caps?.asr} checked={withSubtitle} onChange={(e) => setWithSubtitle(e.target.checked)} />
          自动添加字幕{!caps?.asr && "（未配置 ASR 服务，不可用）"}
        </label>
        <label className={`flex items-center gap-2 text-sm ${caps?.ai ? "text-neutral-200" : "text-neutral-600"}`}>
          <input type="checkbox" disabled={!caps?.ai} checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
          AI 智能优化{!caps?.ai && "（未配置 AI，不可用）"}
        </label>
        {useAi && caps?.ai && (
          <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="可选：描述你想要的风格"
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-400" />
        )}
      </div>

      <button onClick={generate} className="w-full rounded-md bg-emerald-500 py-2.5 font-medium text-neutral-950 hover:bg-emerald-400">
        生成视频
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] text-neutral-500">{label}</div>
      {children}
    </div>
  );
}

function Seg({
  options, value, onChange, disabledIds = [],
}: {
  options: [string, string][];
  value: string;
  onChange: (v: string) => void;
  disabledIds?: string[];
}) {
  return (
    <div className="flex gap-1">
      {options.map(([id, label]) => {
        const disabled = disabledIds.includes(id);
        return (
          <button key={id} disabled={disabled} onClick={() => onChange(id)}
            className={`rounded-md border px-2.5 py-1 text-xs ${value === id ? "border-emerald-400 bg-emerald-400/10 text-neutral-100" : disabled ? "border-neutral-800 text-neutral-700" : "border-neutral-700 text-neutral-400"}`}>
            {label}
          </button>
        );
      })}
    </div>
  );
}
