import { Cross2Icon, SpeakerLoudIcon } from "@radix-ui/react-icons";
import type { Capabilities } from "@vcd/shared";
import { useRef, useState } from "react";
import { api, asset, type ProjectBundle } from "../api.js";

const ASPECTS = [
  { id: "9:16", label: "9:16 竖屏" },
  { id: "3:4", label: "3:4 竖屏" },
  { id: "original", label: "原始比例" },
];

export function Template({
  projectId,
  bundle,
  templates,
  caps,
  onGenerate,
  refresh,
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
  const [noMusic, setNoMusic] = useState(false);
  const [uploadingBgm, setUploadingBgm] = useState(false);
  const bgmInput = useRef<HTMLInputElement>(null);

  const bgmUrl = bundle.project.bgmUrl;

  async function uploadBgm(f: File | undefined) {
    if (!f) return;
    setUploadingBgm(true);
    try {
      await api.uploadBgm(projectId, f);
      setNoMusic(false);
      refresh();
    } finally {
      setUploadingBgm(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="text-xs text-neutral-400">视频标题（用于大字标题）</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-400"
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm text-neutral-400">选择混剪模板</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => setTemplateId(t.id)}
              className={`rounded-lg border p-3 text-left transition ${
                templateId === t.id ? "border-emerald-400 bg-emerald-400/10" : "border-neutral-700 hover:border-neutral-500"
              }`}
            >
              <div className="font-medium text-neutral-100">{t.name}</div>
              <div className="mt-1 text-xs text-neutral-400">{t.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 配乐 */}
      <div>
        <h3 className="mb-2 text-sm text-neutral-400">配乐</h3>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-800 p-3">
          <input ref={bgmInput} type="file" accept="audio/*" className="hidden" onChange={(e) => uploadBgm(e.target.files?.[0])} />
          <button
            onClick={() => bgmInput.current?.click()}
            className="flex items-center gap-1.5 rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
          >
            <SpeakerLoudIcon /> {uploadingBgm ? "上传中…" : "上传音乐"}
          </button>
          {bgmUrl ? (
            <div className="flex items-center gap-2 text-xs text-neutral-300">
              <audio src={asset(bgmUrl)} controls className="h-8" />
              <button
                onClick={async () => { await api.clearBgm(projectId); refresh(); }}
                className="flex items-center gap-1 rounded border border-neutral-700 px-2 py-1 text-neutral-400 hover:bg-neutral-800"
              >
                <Cross2Icon /> 移除
              </button>
            </div>
          ) : (
            <span className="text-xs text-neutral-500">未设置配乐时使用视频原声</span>
          )}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-neutral-300">
            <input type="checkbox" checked={noMusic} onChange={(e) => setNoMusic(e.target.checked)} />
            不加配乐（用原声）
          </label>
        </div>
        <p className="mt-1 text-[11px] text-neutral-500">
          有配乐时按节拍卡点、镜头间加转场；无配乐则保留原声、硬切拼接。
        </p>
      </div>

      <div>
        <h3 className="mb-2 text-sm text-neutral-400">输出画幅</h3>
        <div className="flex gap-2">
          {ASPECTS.map((a) => (
            <button
              key={a.id}
              onClick={() => setAspect(a.id)}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                aspect === a.id ? "border-emerald-400 bg-emerald-400/10 text-neutral-100" : "border-neutral-700 text-neutral-400"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

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
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="可选：描述你想要的风格，如「更燃、突出开头」"
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-400"
          />
        )}
      </div>

      <button
        onClick={() => onGenerate({ templateId, aspect, title, withSubtitle, useAi, noMusic, prompt: prompt || null })}
        className="w-full rounded-md bg-emerald-500 py-2.5 font-medium text-neutral-950 hover:bg-emerald-400"
      >
        生成视频
      </button>
    </div>
  );
}
