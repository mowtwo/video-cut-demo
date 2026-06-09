import { useRef, useState } from "react";
import { api, type ProjectBundle } from "../api.js";
import { msToClock } from "../lib/format.js";

export function Upload({
  projectId,
  bundle,
  refresh,
}: {
  projectId: string;
  bundle: ProjectBundle;
  refresh: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        await api.uploadSource(projectId, f);
      }
      // 轮询直到探测完成（duration>0）
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 700));
        const b = await api.getProject(projectId);
        refresh();
        if (b.sources.every((s) => s.durationMs > 0)) break;
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 transition ${
          drag ? "border-emerald-400 bg-emerald-400/5" : "border-neutral-700 hover:border-neutral-500"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="text-4xl">⬆️</div>
        <p className="mt-3 text-neutral-200">{uploading ? "上传并处理中…" : "点击或拖拽视频到此处上传"}</p>
        <p className="mt-1 text-xs text-neutral-500">支持多个视频 · 任意 ffmpeg 可读格式</p>
      </div>

      {bundle.sources.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-neutral-400">已上传 {bundle.sources.length} 个原视频</h3>
          {bundle.sources.map((s) => (
            <div key={s.id} className="flex gap-4 rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
              {s.url ? (
                <video src={s.url} controls className="h-40 w-72 rounded bg-black object-contain" />
              ) : (
                <div className="flex h-40 w-72 items-center justify-center rounded bg-neutral-800 text-neutral-500">
                  处理中…
                </div>
              )}
              <div className="flex-1 text-sm">
                <div className="font-medium text-neutral-100">{s.filename}</div>
                <dl className="mt-2 grid grid-cols-2 gap-1 text-neutral-400">
                  <div>时长：{s.durationMs ? msToClock(s.durationMs) : "—"}</div>
                  <div>分辨率：{s.width ? `${s.width}×${s.height}` : "—"}</div>
                  <div>帧率：{s.fps ? `${s.fps.toFixed(1)}fps` : "—"}</div>
                  <div>音轨：{s.durationMs ? (s.hasAudio ? "有" : "无") : "—"}</div>
                </dl>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
