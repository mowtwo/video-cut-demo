import { claimNextJob, emitEvent, finishJob, recoverStaleJobs, updateProject } from "./db.js";
import { handlers } from "./handlers.js";

const WORKER_ID = `w-${process.pid}`;
let running = false;

/** 单 worker 顺序处理作业（本地单用户足够）。轮询 + 认领。 */
export function startWorker() {
  recoverStaleJobs(); // 崩溃恢复：把卡住的 running 退回 queued
  setInterval(tick, 300);
  console.log("[worker] started", WORKER_ID);
}

async function tick() {
  if (running) return;
  const job = claimNextJob(WORKER_ID);
  if (!job) return;
  running = true;
  console.log(`[worker] run ${job.type} (${job.id}) project=${job.projectId}`);
  try {
    const h = handlers[job.type];
    if (!h) throw new Error(`no handler for job type: ${job.type}`);
    await h(job);
    finishJob(job.id, "done");
    emitEvent(job.id, job.projectId, 1, `${job.type} 完成`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[worker] job ${job.id} (${job.type}) failed:`, msg);
    finishJob(job.id, "failed", msg);
    emitEvent(job.id, job.projectId, 0, `失败: ${msg}`);
    // 关键作业失败时把工程标记 failed，便于前端提示
    if (job.type === "render" || job.type === "segment") {
      updateProject(job.projectId, { status: "failed" });
    }
  } finally {
    running = false;
  }
}
