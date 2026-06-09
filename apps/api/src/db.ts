import { openDb, type DB } from "@vcd/db";
import type {
  Analysis,
  AnalysisKind,
  AspectRatio,
  Clip,
  JobStatus,
  JobType,
  Project,
  ProjectStatus,
  Render,
  RenderSpec as RenderSpecT,
  Source,
} from "@vcd/shared";
import { randomUUID } from "node:crypto";
import { dbPath } from "./config.js";

let _db: DB | null = null;
export function db(): DB {
  if (!_db) _db = openDb(dbPath());
  return _db;
}
export const newId = () => randomUUID();
const now = () => Date.now();

// ---------- projects ----------
export function createProject(title: string, aspect: AspectRatio): Project {
  const p: Project = {
    id: newId(),
    title,
    templateId: null,
    aspect,
    status: "draft",
    bgmPath: null,
    createdAt: now(),
    updatedAt: now(),
  };
  db()
    .prepare(
      "INSERT INTO projects (id,title,template_id,aspect,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run(p.id, p.title, p.templateId, p.aspect, p.status, p.createdAt, p.updatedAt);
  return p;
}

export function getProject(id: string): Project | null {
  const r = db().prepare("SELECT * FROM projects WHERE id=?").get(id) as any;
  return r ? rowToProject(r) : null;
}

export function updateProject(
  id: string,
  patch: Partial<Pick<Project, "title" | "templateId" | "aspect" | "status">>,
): void {
  const cur = getProject(id);
  if (!cur) return;
  const next = { ...cur, ...patch, updatedAt: now() };
  db()
    .prepare(
      "UPDATE projects SET title=?,template_id=?,aspect=?,status=?,updated_at=? WHERE id=?",
    )
    .run(next.title, next.templateId, next.aspect, next.status, next.updatedAt, id);
}

export function setProjectBgm(id: string, bgmPath: string | null): void {
  db().prepare("UPDATE projects SET bgm_path=?, updated_at=? WHERE id=?").run(bgmPath, now(), id);
}

export function setProjectSettings(id: string, settings: unknown): void {
  db().prepare("UPDATE projects SET settings_json=?, updated_at=? WHERE id=?").run(JSON.stringify(settings), now(), id);
}

export function getProjectSettings(id: string): unknown | null {
  const r = db().prepare("SELECT settings_json FROM projects WHERE id=?").get(id) as any;
  return r?.settings_json ? JSON.parse(r.settings_json) : null;
}

function rowToProject(r: any): Project {
  return {
    id: r.id,
    title: r.title,
    templateId: r.template_id,
    aspect: r.aspect,
    status: r.status as ProjectStatus,
    bgmPath: r.bgm_path ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ---------- sources ----------
export function createSource(s: Omit<Source, "createdAt">): Source {
  const row = { ...s, createdAt: now() };
  db()
    .prepare(
      `INSERT INTO sources (id,project_id,filename,path,duration_ms,width,height,fps,codec,has_audio,thumb_path,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      row.id, row.projectId, row.filename, row.path, row.durationMs, row.width,
      row.height, row.fps, row.codec, row.hasAudio ? 1 : 0, row.thumbPath, row.createdAt,
    );
  return row;
}

export function updateSource(id: string, patch: Partial<Source>): void {
  const cur = getSource(id);
  if (!cur) return;
  const n = { ...cur, ...patch };
  db()
    .prepare(
      `UPDATE sources SET duration_ms=?,width=?,height=?,fps=?,codec=?,has_audio=?,thumb_path=? WHERE id=?`,
    )
    .run(n.durationMs, n.width, n.height, n.fps, n.codec, n.hasAudio ? 1 : 0, n.thumbPath, id);
}

export function getSource(id: string): Source | null {
  const r = db().prepare("SELECT * FROM sources WHERE id=?").get(id) as any;
  return r ? rowToSource(r) : null;
}

export function deleteSource(id: string): void {
  // clips 通过外键 ON DELETE CASCADE 一并删除
  db().prepare("DELETE FROM sources WHERE id=?").run(id);
}

export function listSources(projectId: string): Source[] {
  const rows = db()
    .prepare("SELECT * FROM sources WHERE project_id=? ORDER BY created_at ASC")
    .all(projectId) as any[];
  return rows.map(rowToSource);
}

function rowToSource(r: any): Source {
  return {
    id: r.id, projectId: r.project_id, filename: r.filename, path: r.path,
    durationMs: r.duration_ms, width: r.width, height: r.height, fps: r.fps,
    codec: r.codec, hasAudio: !!r.has_audio, thumbPath: r.thumb_path, createdAt: r.created_at,
  };
}

// ---------- clips ----------
export function createClip(c: Omit<Clip, "createdAt">): Clip {
  const row = { ...c, createdAt: now() };
  db()
    .prepare(
      `INSERT INTO clips (id,project_id,source_id,start_ms,end_ms,duration_ms,thumb_path,score,order_index,included,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      row.id, row.projectId, row.sourceId, row.startMs, row.endMs, row.durationMs,
      row.thumbPath, row.score, row.orderIndex, row.included ? 1 : 0, row.createdAt,
    );
  return row;
}

export function listClips(projectId: string): Clip[] {
  const rows = db()
    .prepare("SELECT * FROM clips WHERE project_id=? ORDER BY order_index ASC, start_ms ASC")
    .all(projectId) as any[];
  return rows.map(rowToClip);
}

export function getClip(id: string): Clip | null {
  const r = db().prepare("SELECT * FROM clips WHERE id=?").get(id) as any;
  return r ? rowToClip(r) : null;
}

export function deleteClips(projectId: string): void {
  db().prepare("DELETE FROM clips WHERE project_id=?").run(projectId);
}

export function setClipOrder(projectId: string, orderedIds: string[]): void {
  const stmt = db().prepare("UPDATE clips SET order_index=? WHERE id=? AND project_id=?");
  orderedIds.forEach((id, i) => stmt.run(i, id, projectId));
}

export function setClipIncluded(id: string, included: boolean): void {
  db().prepare("UPDATE clips SET included=? WHERE id=?").run(included ? 1 : 0, id);
}

function rowToClip(r: any): Clip {
  return {
    id: r.id, projectId: r.project_id, sourceId: r.source_id, startMs: r.start_ms,
    endMs: r.end_ms, durationMs: r.duration_ms, thumbPath: r.thumb_path, score: r.score,
    orderIndex: r.order_index, included: !!r.included, createdAt: r.created_at,
  };
}

// ---------- analyses ----------
export function saveAnalysis(projectId: string, sourceId: string | null, kind: AnalysisKind, data: unknown): void {
  db()
    .prepare("INSERT INTO analyses (id,project_id,source_id,kind,data_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(newId(), projectId, sourceId, kind, JSON.stringify(data), now());
}

export function getAnalysis(projectId: string, kind: AnalysisKind): unknown | null {
  const r = db()
    .prepare("SELECT data_json FROM analyses WHERE project_id=? AND kind=? ORDER BY created_at DESC LIMIT 1")
    .get(projectId, kind) as any;
  return r ? JSON.parse(r.data_json) : null;
}

// ---------- renders ----------
export function createRender(r: Omit<Render, "createdAt"> & { specJson?: string }): Render {
  const row = { ...r, createdAt: now() };
  db()
    .prepare(
      `INSERT INTO renders (id,project_id,spec_json,out_path,thumb_path,duration_ms,aspect,template_id,ai_refined,prompt,status,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      row.id, row.projectId, r.specJson ?? null, row.outPath, row.thumbPath, row.durationMs,
      row.aspect, row.templateId, row.aiRefined ? 1 : 0, row.prompt, row.status, row.createdAt,
    );
  return row;
}

export function updateRender(id: string, patch: Partial<Render>): void {
  const r = db().prepare("SELECT * FROM renders WHERE id=?").get(id) as any;
  if (!r) return;
  const cur = rowToRender(r);
  const n = { ...cur, ...patch };
  db()
    .prepare("UPDATE renders SET out_path=?,thumb_path=?,duration_ms=?,status=? WHERE id=?")
    .run(n.outPath, n.thumbPath, n.durationMs, n.status, id);
}

export function getRenderSpec(id: string): RenderSpecT | null {
  const r = db().prepare("SELECT spec_json FROM renders WHERE id=?").get(id) as any;
  return r?.spec_json ? (JSON.parse(r.spec_json) as RenderSpecT) : null;
}

export function getRender(id: string): Render | null {
  const r = db().prepare("SELECT * FROM renders WHERE id=?").get(id) as any;
  return r ? rowToRender(r) : null;
}

export function listRenders(projectId: string): Render[] {
  const rows = db()
    .prepare("SELECT * FROM renders WHERE project_id=? ORDER BY created_at DESC")
    .all(projectId) as any[];
  return rows.map(rowToRender);
}

function rowToRender(r: any): Render {
  return {
    id: r.id, projectId: r.project_id, outPath: r.out_path, thumbPath: r.thumb_path,
    durationMs: r.duration_ms, aspect: r.aspect, templateId: r.template_id,
    aiRefined: !!r.ai_refined, prompt: r.prompt, status: r.status, createdAt: r.created_at,
  };
}

// ---------- jobs ----------
export interface JobRow {
  id: string; type: JobType; projectId: string; payload: any;
  status: JobStatus; progress: number; error: string | null;
}

export function enqueueJob(type: JobType, projectId: string, payload: unknown, priority = 0): string {
  const id = newId();
  db()
    .prepare(
      "INSERT INTO jobs (id,type,project_id,payload_json,status,priority,progress,created_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(id, type, projectId, JSON.stringify(payload ?? {}), "queued", priority, 0, now());
  return id;
}

export function claimNextJob(workerId: string): JobRow | null {
  const r = db()
    .prepare(
      `UPDATE jobs SET status='running', worker_id=?, started_at=?, lease_until=?
       WHERE id = (SELECT id FROM jobs WHERE status='queued' ORDER BY priority DESC, created_at ASC LIMIT 1)
       RETURNING *`,
    )
    .get(workerId, now(), now() + 5 * 60_000) as any;
  if (!r) return null;
  return { id: r.id, type: r.type, projectId: r.project_id, payload: JSON.parse(r.payload_json || "{}"), status: r.status, progress: r.progress, error: r.error };
}

export function setJobProgress(id: string, progress: number, message?: string): void {
  db().prepare("UPDATE jobs SET progress=? WHERE id=?").run(progress, id);
  const j = db().prepare("SELECT project_id FROM jobs WHERE id=?").get(id) as any;
  if (j) emitEvent(id, j.project_id, progress, message);
}

export function finishJob(id: string, status: "done" | "failed" | "canceled", error?: string): void {
  if (status === "done") {
    db().prepare("UPDATE jobs SET status=?, error=?, finished_at=?, progress=1 WHERE id=?")
      .run(status, error ?? null, now(), id);
  } else {
    db().prepare("UPDATE jobs SET status=?, error=?, finished_at=? WHERE id=?")
      .run(status, error ?? null, now(), id);
  }
}

export function getJob(id: string): JobRow | null {
  const r = db().prepare("SELECT * FROM jobs WHERE id=?").get(id) as any;
  if (!r) return null;
  return { id: r.id, type: r.type, projectId: r.project_id, payload: JSON.parse(r.payload_json || "{}"), status: r.status, progress: r.progress, error: r.error };
}

export function recoverStaleJobs(): void {
  db()
    .prepare("UPDATE jobs SET status='queued', worker_id=NULL WHERE status='running' AND (lease_until IS NULL OR lease_until < ?)")
    .run(now());
}

// ---------- job_events (SSE 总线) ----------
export function emitEvent(jobId: string, projectId: string, progress: number, message?: string): void {
  db()
    .prepare("INSERT INTO job_events (job_id,project_id,progress,message,ts) VALUES (?,?,?,?,?)")
    .run(jobId, projectId, progress, message ?? null, now());
}

export function eventsSince(projectId: string, sinceId: number): any[] {
  return db()
    .prepare("SELECT * FROM job_events WHERE project_id=? AND id>? ORDER BY id ASC LIMIT 100")
    .all(projectId, sinceId) as any[];
}
