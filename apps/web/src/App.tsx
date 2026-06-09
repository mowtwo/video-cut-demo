import * as Tabs from "@radix-ui/react-tabs";
import type { Capabilities } from "@vcd/shared";
import { useEffect, useState } from "react";

const STEPS = ["上传", "素材", "模板", "生成", "结果"] as const;

export function App() {
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setApiOk(Boolean(d.ok)))
      .catch(() => setApiOk(false));
    fetch("/api/capabilities")
      .then((r) => r.json())
      .then(setCaps)
      .catch(() => setCaps(null));
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-2xl font-semibold">video-cut-demo</h1>
        <p className="mt-1 text-sm text-neutral-400">
          自动视频混剪 · M0 脚手架 (空壳，向导流程见下方占位)
        </p>

        <div className="mt-6 flex flex-wrap gap-2 text-xs">
          <Badge label="API" ok={apiOk} />
          <Badge label="AI refine" ok={caps?.ai ?? null} />
          <Badge label="字幕(ASR)" ok={caps?.asr ?? null} />
          <span className="rounded-full bg-neutral-800 px-3 py-1 text-neutral-300">
            硬件加速: {caps?.hwaccel ?? "…"}
          </span>
        </div>

        <Tabs.Root defaultValue={STEPS[0]} className="mt-8">
          <Tabs.List className="flex gap-1 border-b border-neutral-800">
            {STEPS.map((s) => (
              <Tabs.Trigger
                key={s}
                value={s}
                className="px-4 py-2 text-sm text-neutral-400 data-[state=active]:border-b-2 data-[state=active]:border-emerald-400 data-[state=active]:text-neutral-50"
              >
                {s}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {STEPS.map((s) => (
            <Tabs.Content key={s} value={s} className="py-8">
              <div className="rounded-lg border border-dashed border-neutral-800 p-10 text-center text-neutral-500">
                「{s}」步骤 — 待 M1+ 实现
              </div>
            </Tabs.Content>
          ))}
        </Tabs.Root>
      </div>
    </div>
  );
}

function Badge({ label, ok }: { label: string; ok: boolean | null }) {
  const color =
    ok === null
      ? "bg-neutral-800 text-neutral-400"
      : ok
        ? "bg-emerald-500/15 text-emerald-400"
        : "bg-neutral-800 text-neutral-500";
  const dot = ok === null ? "…" : ok ? "●" : "○";
  return (
    <span className={`rounded-full px-3 py-1 ${color}`}>
      {dot} {label}
    </span>
  );
}
