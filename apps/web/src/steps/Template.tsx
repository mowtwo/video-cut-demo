import type { Capabilities } from "@vcd/shared";
import { useState } from "react";

const ASPECTS = [
  { id: "9:16", label: "9:16 竖屏" },
  { id: "3:4", label: "3:4 竖屏" },
  { id: "original", label: "原始比例" },
];

export function Template({
  templates,
  caps,
  defaultTitle,
  onGenerate,
}: {
  templates: { id: string; name: string; description: string }[];
  caps: Capabilities | null;
  defaultTitle: string;
  onGenerate: (opts: Record<string, unknown>) => void;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "highlight");
  const [aspect, setAspect] = useState("original");
  const [title, setTitle] = useState(defaultTitle);
  const [withSubtitle, setWithSubtitle] = useState(false);
  const [useAi, setUseAi] = useState(false);
  const [prompt, setPrompt] = useState("");

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
                templateId === t.id
                  ? "border-emerald-400 bg-emerald-400/10"
                  : "border-neutral-700 hover:border-neutral-500"
              }`}
            >
              <div className="font-medium text-neutral-100">{t.name}</div>
              <div className="mt-1 text-xs text-neutral-400">{t.description}</div>
            </button>
          ))}
        </div>
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
        onClick={() => onGenerate({ templateId, aspect, title, withSubtitle, useAi, prompt: prompt || null })}
        className="w-full rounded-md bg-emerald-500 py-2.5 font-medium text-neutral-950 hover:bg-emerald-400"
      >
        生成视频
      </button>
    </div>
  );
}
