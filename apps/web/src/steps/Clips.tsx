import { DragHandleDots2Icon, PlayIcon, ReloadIcon } from "@radix-ui/react-icons";
import { useEffect, useRef, useState } from "react";
import { api, asset, type ClipDTO, type ProjectBundle } from "../api.js";
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
  const dragIdx = useRef<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  useEffect(() => setClips(bundle.clips), [bundle.clips]);

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

  function persistOrder(next: ClipDTO[]) {
    setClips(next);
    void api.reorderClips(projectId, next.map((c) => c.id));
  }

  function onDrop(target: number) {
    const from = dragIdx.current;
    dragIdx.current = null;
    setOverIdx(null);
    if (from == null || from === target) return;
    const next = [...clips];
    const [moved] = next.splice(from, 1);
    next.splice(target, 0, moved);
    persistOrder(next);
  }

  function toggle(c: ClipDTO) {
    const next = clips.map((x) => (x.id === c.id ? { ...x, included: !x.included } : x));
    setClips(next);
    void api.setClipIncluded(projectId, c.id, !c.included);
  }

  const srcOf = (c: ClipDTO) => bundle.sources.find((s) => s.id === c.sourceId);
  const included = clips.filter((c) => c.included);
  const totalDur = included.reduce((a, c) => a + c.durationMs, 0) || 1;

  if (segmenting && clips.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-neutral-400">
        <ReloadIcon className="h-7 w-7 animate-spin text-emerald-400" />
        <p className="mt-4">{msg}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm text-neutral-400">
          自动分割出 {clips.length} 个片段 · 已选 {included.length} 个 · 拖拽卡片可排序
        </h3>
        <button
          onClick={runSegment}
          className="flex items-center gap-1.5 rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
        >
          <ReloadIcon /> 重新分割
        </button>
      </div>

      {/* 时间轴：按顺序、按时长比例展示已选片段 */}
      {included.length > 0 && (
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-neutral-500">
            <span>时间轴（预计成片顺序）</span>
            <span>总时长 ~{msToClock(totalDur)}</span>
          </div>
          <div className="flex h-12 gap-0.5 overflow-hidden rounded-md border border-neutral-800">
            {included.map((c) => (
              <button
                key={c.id}
                onClick={() => setPreview(c)}
                title={`${msToClock(c.startMs)}–${msToClock(c.endMs)}`}
                style={{ width: `${(c.durationMs / totalDur) * 100}%` }}
                className="relative min-w-[8px] shrink-0 bg-cover bg-center transition hover:brightness-125"
              >
                {c.thumbUrl && (
                  <img src={asset(c.thumbUrl)} className="h-full w-full object-cover opacity-80" />
                )}
                <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-[9px] text-white">
                  {msToSecLabel(c.durationMs)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 片段网格（可拖拽排序） */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {clips.map((c, idx) => (
          <div
            key={c.id}
            draggable
            onDragStart={() => (dragIdx.current = idx)}
            onDragOver={(e) => {
              e.preventDefault();
              setOverIdx(idx);
            }}
            onDrop={() => onDrop(idx)}
            className={`overflow-hidden rounded-lg border bg-neutral-900/50 transition ${
              overIdx === idx ? "border-emerald-400" : c.included ? "border-neutral-700" : "border-neutral-800 opacity-50"
            }`}
          >
            <div className="relative cursor-grab active:cursor-grabbing">
              {c.thumbUrl ? (
                <img src={asset(c.thumbUrl)} className="h-28 w-full bg-black object-cover" />
              ) : (
                <div className="h-28 w-full bg-neutral-800" />
              )}
              <span className="absolute left-1 top-1 flex items-center gap-0.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                <DragHandleDots2Icon className="h-3 w-3" /> #{idx + 1}
              </span>
              {c.score != null && (
                <span className="absolute right-1 top-1 rounded bg-emerald-500/80 px-1.5 py-0.5 text-[10px] text-white">
                  {Math.round(c.score * 100)}
                </span>
              )}
            </div>
            <div className="space-y-1 p-2 text-[11px] text-neutral-400">
              <div>时长 {msToSecLabel(c.durationMs)} · {msToClock(c.startMs)}–{msToClock(c.endMs)}</div>
              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={() => setPreview(c)}
                  className="flex items-center gap-1 rounded bg-neutral-800 px-2 py-0.5 hover:bg-neutral-700"
                >
                  <PlayIcon /> 预览
                </button>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={() => setPreview(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg">
            <video
              src={asset(srcOf(preview)?.url)}
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
