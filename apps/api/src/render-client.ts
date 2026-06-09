import type { RenderSpec } from "@vcd/shared";
import { config } from "./config.js";

async function post<T>(path: string, body: unknown, timeoutMs = 0): Promise<T> {
  const ctrl = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
  const res = await fetch(`${config.renderUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: ctrl,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`render ${path} ${res.status}: ${txt}`);
  }
  return (await res.json()) as T;
}

export interface ProbeResult {
  durationMs: number; width: number; height: number; fps: number; codec: string; hasAudio: boolean;
}

export const renderClient = {
  health: () => fetch(`${config.renderUrl}/health`).then((r) => r.json()),

  probe: (path: string) => post<ProbeResult>("/probe", { path }, 30_000),

  thumbnail: (path: string, atMs: number, out: string, width = 320) =>
    post<{ path: string }>("/thumbnail", { path, atMs, width, out }, 30_000),

  scene: (path: string, threshold = 0.4) =>
    post<{ cutsMs: number[] }>("/scene", { path, threshold }, 120_000),

  beat: (path: string) =>
    post<{ beatsMs: number[]; degraded: boolean }>("/beat", { path }, 60_000),

  render: (jobId: string, out: string, callbackUrl: string, spec: RenderSpec) =>
    post<{ outPath: string; durationMs: number }>(
      "/render",
      { jobId, out, callbackUrl, spec },
      30 * 60_000,
    ),

  burnSub: (input: string, ass: string, out: string) =>
    post<{ outPath: string }>("/burnsub", { input, ass, out }, 30 * 60_000),
};
