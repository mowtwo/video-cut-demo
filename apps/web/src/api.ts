import type { Capabilities, Clip, Project, Render, Source } from "@vcd/shared";

const base = "/api";

export type SourceDTO = Source & { url: string | null; thumbUrl: string | null };
export type ClipDTO = Clip & { thumbUrl: string | null };
export type RenderDTO = Render & {
  url: string | null;
  thumbUrl: string | null;
  downloadUrl: string | null;
};

export interface ProjectBundle {
  project: Project & { bgmUrl?: string | null };
  sources: SourceDTO[];
  clips: ClipDTO[];
  renders: RenderDTO[];
}

/** 把后端返回的 /files/... 路径加上 /api 前缀，经 vite 代理打到 API 静态服务。 */
export const asset = (u?: string | null): string | undefined => (u ? `/api${u}` : undefined);

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => "")}`);
  return res.json() as Promise<T>;
}

export const api = {
  capabilities: () => fetch(`${base}/capabilities`).then(j<Capabilities>),
  templates: () => fetch(`${base}/templates`).then(j<{ id: string; name: string; description: string }[]>),

  createProject: (title: string, aspect: string) =>
    fetch(`${base}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, aspect }),
    }).then(j<Project>),

  getProject: (id: string) => fetch(`${base}/projects/${id}`).then(j<ProjectBundle>),

  patchProject: (id: string, patch: Record<string, unknown>) =>
    fetch(`${base}/projects/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).then(j<Project>),

  uploadSource: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`${base}/projects/${id}/sources`, { method: "POST", body: form }).then(
      j<{ source: SourceDTO; jobId: string }>,
    );
  },

  segment: (id: string) =>
    fetch(`${base}/projects/${id}/segment`, { method: "POST" }).then(j<{ jobId: string }>),

  uploadBgm: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`${base}/projects/${id}/bgm`, { method: "POST", body: form }).then(
      j<{ bgmPath: string; bgmUrl: string }>,
    );
  },

  clearBgm: (id: string) =>
    fetch(`${base}/projects/${id}/bgm`, { method: "DELETE" }).then(j),

  reorderClips: (id: string, orderedIds: string[]) =>
    fetch(`${base}/projects/${id}/clips/reorder`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    }).then(j),

  setClipIncluded: (id: string, cid: string, included: boolean) =>
    fetch(`${base}/projects/${id}/clips/${cid}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ included }),
    }).then(j),

  render: (id: string, opts: Record<string, unknown>) =>
    fetch(`${base}/projects/${id}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts),
    }).then(j<{ renderId: string; jobId: string }>),

  regenerate: (id: string, opts: Record<string, unknown>) =>
    fetch(`${base}/projects/${id}/regenerate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts),
    }).then(j<{ renderId: string; jobId: string }>),
};

// SSE 进度订阅
export function subscribeProgress(
  projectId: string,
  onEvent: (e: { progress: number; message?: string }) => void,
): () => void {
  const es = new EventSource(`${base}/projects/${projectId}/events`);
  es.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data));
    } catch { /* ignore */ }
  };
  return () => es.close();
}
