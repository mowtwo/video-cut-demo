import { claimNextJob, emitEvent, finishJob, recoverStaleJobs, updateProject } from "./db.js";
import { handlers } from "./handlers.js";

const WORKER_ID = `w-${process.pid}`;
// 允许并发处理若干作业，避免一个长渲染把 probe/segment/字幕 等全堵住。
// 真正的 ffmpeg 重活在 svc/render 侧用进程池限流，这里放开调度即可。
const MAX_CONCURRENT = 3;
let active = 0;

export function startWorker() {
  recoverStaleJobs(); // 崩溃恢复：把租约过期的 running 退回 queued
  setInterval(tick, 300);
  console.log("[worker] started", WORKER_ID, "concurrency", MAX_CONCURRENT);
}

function tick() {
  while (active < MAX_CONCURRENT) {
    const job = claimNextJob(WORKER_ID);
    if (!job) return;
    active++;
    void run(job);
  }
}

async function run(job: NonNullable<ReturnType<typeof claimNextJob>>) {
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
    if (job.type === "render" || job.type === "segment") {
      updateProject(job.projectId, { status: "failed" });
    }
  } finally {
    active--;
  }
}
