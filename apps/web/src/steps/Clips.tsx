import { useEffect, useState } from "react";
import { api, type ClipDTO, type ProjectBundle } from "../api.js";
import { msToClock, msToSecLabel } from "../lib/format.js";

export function Clips({
  projectId,
  bundle,
  refresh,
}: {
  projectId: string;
  bundle: ProjectBundle;
  refresh: () => void;
}) {
  const [segmenting, setSegmenting] = useState(false);
  const [msg, setMsg] = useState("");
  const [clips, setClips] = useState<ClipDTO[]>(bundle.clips);
  const [preview, setPreview] = useState<ClipDTO | null>(null);

  useEffect(() => setClips(bundle.clips), [bundle.clips]);

  // 进入时若还没分割，自动触发
  useEffect(() => {
    if (bundle.clips.length === 0 && !segmenting) void runSegment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSegment() {
    setSegmenting(true);
    setMsg("正在分析视频、自动分割素材…");
    try {
      await api.segment(projectId);
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 800));
        const b = await api.getProject(projectId);
        setClips(b.clips);
        if (b.clips.length > 0 && b.project.status !== "analyzing") {
          refresh();
          break;
        }
        if (b.project.status === "failed") {
          setMsg("分割失败，请检查视频或重试");
          break;
        }
      }
    } finally {
      setSegmenting(false);
    }
  }

  function move(idx: number, dir: -1 | 1) {
    const next = [...clips];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setClips(next);
    void api.reorderClips(projectId, next.map((c) => c.id));
  }

  function toggle(c: ClipDTO) {
    const next = clips.map((x) => (x.id === c.id ? { ...x, included: !x.included } : x));
    setClips(next);
    void api.setClipIncluded(projectId, c.id, !c.included);
  }

  const srcOf = (c: ClipDTO) => bundle.sources.find((s) => s.id === c.sourceId);

  if (segmenting && clips.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-neutral-400">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-600 border-t-emerald-400" />
        <p className="mt-4">{msg}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm text-neutral-400">
          自动分割出 {clips.length} 个素材片段 · 已选 {clips.filter((c) => c.included).length} 个
        </h3>
        <button
          onClick={runSegment}
          className="rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
        >
          重新分割
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {clips.map((c, idx) => (
          <div
            key={c.id}
            className={`overflow-hidden rounded-lg border bg-neutral-900/50 ${
              c.included ? "border-neutral-700" : "border-neutral-800 opacity-50"
            }`}
          >
            <div className="relative">
              {c.thumbUrl ? (
                <img src={c.thumbUrl} className="h-28 w-full bg-black object-cover" />
              ) : (
                <div className="h-28 w-full bg-neutral-800" />
              )}
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                #{idx + 1}
              </span>
              {c.score != null && (
                <span className="absolute right-1 top-1 rounded bg-emerald-500/80 px-1.5 py-0.5 text-[10px] text-white">
                  {Math.round(c.score * 100)}
                </span>
              )}
            </div>
            <div className="space-y-1 p-2 text-[11px] text-neutral-400">
              <div>时长 {msToSecLabel(c.durationMs)}</div>
              <div>
                区间 {msToClock(c.startMs)}–{msToClock(c.endMs)}
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="flex gap-1">
                  <button onClick={() => move(idx, -1)} className="rounded bg-neutral-800 px-1.5 hover:bg-neutral-700">↑</button>
                  <button onClick={() => move(idx, 1)} className="rounded bg-neutral-800 px-1.5 hover:bg-neutral-700">↓</button>
                  <button onClick={() => setPreview(c)} className="rounded bg-neutral-800 px-1.5 hover:bg-neutral-700">▶</button>
                </div>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={c.included} onChange={() => toggle(c)} />
                  选用
                </label>
              </div>
            </div>
          </div>
        ))}
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setPreview(null)}
        >
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg">
            <video
              src={srcOf(preview)?.url ?? undefined}
              controls
              autoPlay
              className="w-full rounded bg-black"
              onLoadedMetadata={(e) => {
                (e.target as HTMLVideoElement).currentTime = preview.startMs / 1000;
              }}
            />
            <p className="mt-2 text-center text-xs text-neutral-400">
              片段区间 {msToClock(preview.startMs)}–{msToClock(preview.endMs)}（相对原视频）
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
