import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "./config.js";

export const asrAvailable = () => config.asrUrl.length > 0;

interface AsrSegment {
  start: number; // 秒
  end: number;
  text: string;
}

/**
 * 调 whisper-asr-webservice 转写音/视频文件，返回分段。
 * 失败/未配置则抛错，调用方负责降级跳过。
 */
export async function transcribe(absInputPath: string): Promise<AsrSegment[]> {
  if (!asrAvailable()) throw new Error("ASR not configured");
  const { readFile } = await import("node:fs/promises");
  const buf = await readFile(absInputPath);
  const form = new FormData();
  form.append("audio_file", new Blob([buf]), "input.mp4");

  const url = `${config.asrUrl.replace(/\/$/, "")}/asr?encode=true&task=transcribe&output=json`;
  const res = await fetch(url, { method: "POST", body: form, signal: AbortSignal.timeout(10 * 60_000) });
  if (!res.ok) throw new Error(`asr ${res.status}: ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as any;
  const segs: AsrSegment[] = (data.segments ?? []).map((s: any) => ({
    start: s.start, end: s.end, text: String(s.text ?? "").trim(),
  }));
  return segs.filter((s) => s.text);
}

/** 分段 -> ASS 文件（带基础样式，CJK 友好）。返回写入的绝对路径。 */
export async function writeAss(absOutPath: string, segs: AsrSegment[], playResX = 1080, playResY = 1920): Promise<string> {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV
Style: Default,Noto Sans CJK SC,${Math.round(playResX * 0.05)},&H00FFFFFF,&H00000000,&H64000000,1,1,3,1,2,60,60,${Math.round(playResY * 0.08)}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const body = segs
    .map((s) => `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Default,,0,0,0,,${s.text.replace(/\n/g, " ")}`)
    .join("\n");
  await mkdir(dirname(absOutPath), { recursive: true });
  await writeFile(absOutPath, header + body + "\n", "utf8");
  return absOutPath;
}

function assTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec - Math.floor(sec)) * 100);
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}
const pad = (n: number) => String(n).padStart(2, "0");
