export function msToClock(ms: number): string {
  if (!ms || ms < 0) ms = 0;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function msToSecLabel(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
