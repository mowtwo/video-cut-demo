import { useState } from "react";
import type { ProjectBundle, RenderDTO } from "../api.js";
import { msToClock } from "../lib/format.js";

export function Result({
  bundle,
  templates,
  caps,
  onRegenerate,
}: {
  bundle: ProjectBundle;
  templates: { id: string; name: string; description: string }[];
  caps: { ai: boolean } | null;
  onRegenerate: (opts: Record<string, unknown>) => void;
}) {
  const render: RenderDTO | undefined = bundle.renders.find((r) => r.status === "done") ?? bundle.renders[0];
  const [prompt, setPrompt] = useState("");

  if (!render) return <div className="py-20 text-center text-neutral-400">暂无结果</div>;
  const tplName = templates.find((t) => t.id === render.templateId)?.name ?? render.templateId;

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
        <video src={render.url} controls className="max-h-[60vh] w-full rounded-lg bg-black" />
      ) : (
        <div className="rounded-lg bg-neutral-800 py-20 text-center text-neutral-500">视频生成中…</div>
      )}

      <div className="flex flex-wrap gap-3">
        {render.downloadUrl && (
          <a
            href={`/api${render.downloadUrl}`}
            className="rounded-md bg-emerald-500 px-5 py-2 font-medium text-neutral-950 hover:bg-emerald-400"
          >
            ⬇ 下载 MP4
          </a>
        )}
        <button
          onClick={() => onRegenerate({})}
          className="rounded-md border border-neutral-700 px-5 py-2 text-neutral-200 hover:bg-neutral-800"
        >
          重新生成
        </button>
      </div>

      {caps?.ai && (
        <div className="rounded-lg border border-neutral-800 p-3">
          <label className="text-xs text-neutral-400">用 AI 按描述重新生成</label>
          <div className="mt-2 flex gap-2">
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="如：节奏更快、突出人物、加点悬念"
              className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-400"
            />
            <button
              onClick={() => onRegenerate({ useAi: true, prompt })}
              className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white"
            >
              AI 重生成
            </button>
          </div>
        </div>
      )}

      {bundle.renders.length > 1 && (
        <div>
          <h3 className="mb-2 text-xs text-neutral-500">历史结果</h3>
          <div className="flex gap-2 overflow-x-auto">
            {bundle.renders.map((r) => (
              <div key={r.id} className="shrink-0">
                {r.thumbUrl ? (
                  <img src={r.thumbUrl} className="h-20 w-32 rounded bg-black object-cover" />
                ) : (
                  <div className="h-20 w-32 rounded bg-neutral-800" />
                )}
                <div className="mt-1 text-center text-[10px] text-neutral-500">{r.status}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-neutral-800 px-3 py-1 text-neutral-300">{children}</span>;
}
