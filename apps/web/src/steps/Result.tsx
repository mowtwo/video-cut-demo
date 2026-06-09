import { CheckIcon, DownloadIcon, MagicWandIcon, ReloadIcon } from "@radix-ui/react-icons";
import type { Capabilities } from "@vcd/shared";
import { useEffect, useState } from "react";
import { asset, type ProjectBundle, type RenderDTO } from "../api.js";
import { msToClock } from "../lib/format.js";

const ASPECTS = ["9:16", "3:4", "original"];

export function Result({
  bundle,
  templates,
  caps,
  onRegenerate,
}: {
  bundle: ProjectBundle;
  templates: { id: string; name: string; description: string }[];
  caps: Capabilities | null;
  onRegenerate: (opts: Record<string, unknown>) => void;
}) {
  const done = bundle.renders.filter((r) => r.status === "done");
  const [selId, setSelId] = useState<string | null>(null);
  const render: RenderDTO | undefined = done.find((r) => r.id === selId) ?? done[0] ?? bundle.renders[0];

  // 重新生成的可调参数（默认沿用当前结果）
  const [templateId, setTemplateId] = useState<string>(render?.templateId ?? "highlight");
  const [aspect, setAspect] = useState<string>(render?.aspect ?? "original");
  const [withSubtitle, setWithSubtitle] = useState(false);
  const [useAi, setUseAi] = useState(false);
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    if (render) {
      setTemplateId(render.templateId ?? "highlight");
      setAspect(render.aspect ?? "original");
    }
  }, [render?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!render) return <div className="py-20 text-center text-neutral-400">暂无结果</div>;
  const tplName = templates.find((t) => t.id === render.templateId)?.name ?? render.templateId;

  // 上次生成的完整配置(音频/标题等)，重新生成时一并带上，只覆盖面板里改的项
  const saved = bundle.project.settings ?? {};
  const regen = (extra: Record<string, unknown>) =>
    onRegenerate({ ...saved, templateId, aspect, withSubtitle, ...extra });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-neutral-50">{bundle.project.title}</h2>
        <div className="mt-1 flex flex-wrap gap-2 text-xs">
          <Tag>模板：{tplName}</Tag>
          <Tag>画幅：{render.aspect}</Tag>
          <Tag>时长：{render.durationMs ? msToClock(render.durationMs) : "—"}</Tag>
          {render.aiRefined && <Tag>AI 优化</Tag>}
        </div>
      </div>

      {render.url ? (
        <video key={render.id} src={asset(render.url)} controls className="max-h-[55vh] w-full rounded-lg bg-black" />
      ) : (
        <div className="rounded-lg bg-neutral-800 py-20 text-center text-neutral-500">视频生成中…</div>
      )}

      {render.downloadUrl && (
        <a
          href={asset(render.downloadUrl)}
          className="inline-flex items-center gap-2 rounded-md bg-emerald-500 px-5 py-2 font-medium text-neutral-950 hover:bg-emerald-400"
        >
          <DownloadIcon /> 下载 MP4
        </a>
      )}

      {/* 历史结果：可点击切换 */}
      {done.length > 1 && (
        <div>
          <h3 className="mb-2 text-xs text-neutral-500">历史结果（点击切换预览）</h3>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {done.map((r) => {
              const active = r.id === render.id;
              return (
                <button
                  key={r.id}
                  onClick={() => setSelId(r.id)}
                  className={`relative shrink-0 overflow-hidden rounded border-2 ${active ? "border-emerald-400" : "border-transparent"}`}
                >
                  {r.thumbUrl ? (
                    <img src={asset(r.thumbUrl)} className="h-20 w-32 bg-black object-cover" />
                  ) : (
                    <div className="h-20 w-32 bg-neutral-800" />
                  )}
                  <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-center text-[10px] text-white">
                    {templates.find((t) => t.id === r.templateId)?.name ?? r.templateId} · {r.aspect}
                  </span>
                  {active && <CheckIcon className="absolute right-1 top-1 h-4 w-4 rounded-full bg-emerald-500 text-neutral-950" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 重新生成面板：可调模板/画幅/选项 */}
      <div className="space-y-3 rounded-lg border border-neutral-800 p-4">
        <h3 className="text-sm font-medium text-neutral-200">重新生成（可调整配置）</h3>
        <p className="text-[11px] text-neutral-500">配乐/混音/标题样式沿用上次设置；要改这些请回「模板」步骤。</p>
        <div>
          <div className="mb-1 text-xs text-neutral-500">模板</div>
          <div className="flex flex-wrap gap-1.5">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => setTemplateId(t.id)}
                className={`rounded-md border px-2.5 py-1 text-xs ${templateId === t.id ? "border-emerald-400 bg-emerald-400/10 text-neutral-100" : "border-neutral-700 text-neutral-400"}`}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs text-neutral-500">画幅</div>
          <div className="flex gap-1.5">
            {ASPECTS.map((a) => (
              <button
                key={a}
                onClick={() => setAspect(a)}
                className={`rounded-md border px-2.5 py-1 text-xs ${aspect === a ? "border-emerald-400 bg-emerald-400/10 text-neutral-100" : "border-neutral-700 text-neutral-400"}`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className={`flex items-center gap-1.5 text-xs ${caps?.asr ? "text-neutral-300" : "text-neutral-600"}`}>
            <input type="checkbox" disabled={!caps?.asr} checked={withSubtitle} onChange={(e) => setWithSubtitle(e.target.checked)} />
            字幕{!caps?.asr && "(未配置)"}
          </label>
          <label className={`flex items-center gap-1.5 text-xs ${caps?.ai ? "text-neutral-300" : "text-neutral-600"}`}>
            <input type="checkbox" disabled={!caps?.ai} checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
            AI 优化{!caps?.ai && "(未配置)"}
          </label>
        </div>
        {useAi && caps?.ai && (
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="可选：描述想要的风格"
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-400"
          />
        )}
        <div className="flex gap-2">
          <button
            onClick={() => regen({ useAi, prompt: prompt || null })}
            className="flex items-center gap-1.5 rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white"
          >
            <ReloadIcon /> 用以上配置重新生成
          </button>
          {useAi && caps?.ai && (
            <button
              onClick={() => regen({ useAi: true, prompt: prompt || null })}
              className="flex items-center gap-1.5 rounded-md border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
            >
              <MagicWandIcon /> AI 重生成
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-neutral-800 px-3 py-1 text-neutral-300">{children}</span>;
}
