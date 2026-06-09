import type { Capabilities } from "@vcd/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, subscribeProgress, type ProjectBundle } from "./api.js";
import { Clips } from "./steps/Clips.js";
import { Generate } from "./steps/Generate.js";
import { Result } from "./steps/Result.js";
import { Template } from "./steps/Template.js";
import { Upload } from "./steps/Upload.js";

const STEPS = ["上传", "素材", "模板", "生成", "结果"];

export function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ProjectBundle | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [templates, setTemplates] = useState<{ id: string; name: string; description: string }[]>([]);
  const [step, setStep] = useState(0);
  const [gen, setGen] = useState({ active: false, progress: 0, message: "" });
  const unsubRef = useRef<(() => void) | null>(null);

  // 初始化：能力、模板、工程
  useEffect(() => {
    api.capabilities().then(setCaps).catch(() => {});
    api.templates().then(setTemplates).catch(() => {});
    (async () => {
      let id = localStorage.getItem("vcd-project");
      if (id) {
        try {
          await api.getProject(id);
        } catch {
          id = null;
        }
      }
      if (!id) {
        const p = await api.createProject("我的混剪", "original");
        id = p.id;
        localStorage.setItem("vcd-project", id);
      }
      setProjectId(id);
    })();
  }, []);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      setBundle(await api.getProject(projectId));
    } catch { /* ignore */ }
  }, [projectId]);

  useEffect(() => {
    if (projectId) void refresh();
  }, [projectId, refresh]);

  async function newProject() {
    unsubRef.current?.();
    const p = await api.createProject("我的混剪", "original");
    localStorage.setItem("vcd-project", p.id);
    setProjectId(p.id);
    setBundle(null);
    setStep(0);
  }

  async function generate(opts: Record<string, unknown>, regenerate = false) {
    if (!projectId) return;
    if (opts.title) await api.patchProject(projectId, { title: opts.title });
    setStep(3);
    setGen({ active: true, progress: 0, message: "排队中…" });

    unsubRef.current?.();
    unsubRef.current = subscribeProgress(projectId, (e) =>
      setGen((g) => ({ ...g, progress: e.progress, message: e.message ?? g.message })),
    );

    try {
      const { renderId } = regenerate
        ? await api.regenerate(projectId, opts)
        : await api.render(projectId, opts);
      await waitForRender(renderId);
    } catch (e) {
      setGen((g) => ({ ...g, message: `失败：${String(e)}` }));
      return;
    }
    unsubRef.current?.();
    unsubRef.current = null;
    await refresh();
    setGen({ active: false, progress: 1, message: "" });
    setStep(4);
  }

  async function waitForRender(renderId: string) {
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const b = await api.getProject(projectId!);
      setBundle(b);
      const r = b.renders.find((x) => x.id === renderId);
      if (r?.status === "done") return;
      if (b.project.status === "failed") throw new Error("渲染失败");
    }
    throw new Error("超时");
  }

  if (!projectId || !bundle) {
    return <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-400">加载中…</div>;
  }

  const sourcesReady = bundle.sources.length > 0 && bundle.sources.every((s) => s.durationMs > 0);
  const canGo = (target: number) => {
    if (target === 0) return true;
    if (target === 1) return sourcesReady;
    if (target === 2) return bundle.clips.length > 0;
    if (target === 4) return bundle.renders.length > 0;
    return false;
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">video-cut-demo</h1>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-neutral-500">硬件加速: {caps?.hwaccel ?? "…"}</span>
            <button onClick={newProject} className="rounded-md border border-neutral-700 px-3 py-1 text-neutral-300 hover:bg-neutral-800">
              新建工程
            </button>
          </div>
        </header>

        {/* stepper */}
        <nav className="mt-6 flex gap-1 border-b border-neutral-800">
          {STEPS.map((s, i) => (
            <button
              key={s}
              disabled={!canGo(i) && i !== step}
              onClick={() => canGo(i) && setStep(i)}
              className={`px-4 py-2 text-sm transition ${
                i === step
                  ? "border-b-2 border-emerald-400 text-neutral-50"
                  : canGo(i)
                    ? "text-neutral-400 hover:text-neutral-200"
                    : "text-neutral-700"
              }`}
            >
              {i + 1}. {s}
            </button>
          ))}
        </nav>

        <main className="mt-8">
          {step === 0 && (
            <>
              <Upload projectId={projectId} bundle={bundle} refresh={refresh} />
              {sourcesReady && (
                <NextButton onClick={() => setStep(1)}>下一步：自动分割素材</NextButton>
              )}
            </>
          )}
          {step === 1 && (
            <>
              <Clips projectId={projectId} bundle={bundle} refresh={refresh} />
              {bundle.clips.length > 0 && <NextButton onClick={() => setStep(2)}>下一步：选模板</NextButton>}
            </>
          )}
          {step === 2 && (
            <Template
              projectId={projectId}
              bundle={bundle}
              templates={templates}
              caps={caps}
              onGenerate={(opts) => generate(opts)}
              refresh={refresh}
            />
          )}
          {step === 3 && <Generate progress={gen.progress} message={gen.message} />}
          {step === 4 && (
            <Result
              bundle={bundle}
              templates={templates}
              caps={caps}
              onRegenerate={(opts) => generate(opts, true)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function NextButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <div className="mt-8 flex justify-end">
      <button onClick={onClick} className="rounded-md bg-emerald-500 px-5 py-2 font-medium text-neutral-950 hover:bg-emerald-400">
        {children}
      </button>
    </div>
  );
}
