export function Generate({ progress, message }: { progress: number; message: string }) {
  const pct = Math.round(progress * 100);
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-neutral-700 border-t-emerald-400" />
      <p className="mt-5 text-neutral-200">{message || "正在生成视频…"}</p>
      <div className="mt-4 h-2 w-72 overflow-hidden rounded-full bg-neutral-800">
        <div className="h-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-neutral-500">{pct}%</p>
    </div>
  );
}
