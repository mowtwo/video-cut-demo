import type { Clip, RenderSpec } from "@vcd/shared";
import { config } from "./config.js";

export const aiAvailable = () => config.aiApiKey.length > 0;

/**
 * 用 AI 对 RenderSpec 做 refine / 按 prompt 重排。
 * 可选能力：无 key 或调用失败时抛错，调用方降级（保留原 spec）。
 * 约束模型只返回调整后的 segments（顺序/取舍/时长），其余结构不动，避免破坏渲染契约。
 */
export async function refineSpec(
  spec: RenderSpec,
  clips: Clip[],
  prompt: string | null,
): Promise<RenderSpec> {
  if (!aiAvailable()) throw new Error("AI not configured");

  const sys =
    "你是短视频混剪助手。根据用户意图调整给定的混剪片段顺序与取舍。" +
    "只能从已有 segments 中删除/重排，可微调每段 targetDurMs(400-6000)，" +
    "不要新增不存在的片段，不要改 canvas/output/textLayers。" +
    "只返回 JSON：{\"segments\":[{\"clipId\":\"..\",\"srcInMs\":..,\"srcDurMs\":..,\"targetDurMs\":..}]}";

  const user = JSON.stringify({
    intent: prompt ?? "让成片更有节奏感、更吸引人",
    clips: clips.map((c) => ({ id: c.id, durationMs: c.durationMs, score: c.score })),
    segments: spec.segments.map((s) => ({
      clipId: s.clipId, srcInMs: s.srcInMs, srcDurMs: s.srcDurMs, targetDurMs: s.targetDurMs,
    })),
  });

  // OpenAI 兼容 /chat/completions（GPT / Gemini openai-compat / DeepSeek / Ollama 等通用）
  const res = await fetch(`${config.aiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.aiApiKey}`,
    },
    body: JSON.stringify({
      model: config.aiModel,
      temperature: 0.7,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`ai ${res.status}: ${await res.text().catch(() => "")}`);

  const data = (await res.json()) as any;
  const text: string = data.choices?.[0]?.message?.content ?? "";
  const json = extractJson(text);
  const adjusted: Array<{ clipId: string; srcInMs?: number; srcDurMs?: number; targetDurMs?: number }> =
    json?.segments ?? [];
  if (!adjusted.length) throw new Error("AI 未返回有效 segments");

  // 按 AI 给的顺序重建 segments（只用已存在的 clipId），重算 targetStart
  const byClip = new Map(spec.segments.map((s) => [s.clipId, s]));
  let cursor = 0;
  const segments = adjusted
    .map((a) => byClip.get(a.clipId))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s, _i, _arr) => {
      const a = adjusted.find((x) => x.clipId === s.clipId)!;
      const dur = clampDur(a.targetDurMs ?? s.targetDurMs);
      const seg = { ...s, srcDurMs: a.srcDurMs ?? dur, targetDurMs: dur, targetStartMs: cursor };
      cursor += dur;
      return seg;
    });

  // 重排后重算转场：只有相邻段需要，最后一段必须无转场(否则 xfade 链/同步出错)
  const tpl = spec.segments.find((s) => s.transitionOut)?.transitionOut;
  segments.forEach((s, i) => {
    s.transitionOut = i < segments.length - 1 ? tpl : undefined;
  });

  return { ...spec, segments: segments.length ? segments : spec.segments };
}

function clampDur(d: number): number {
  return Math.max(400, Math.min(6000, Math.round(d || 1500)));
}

function extractJson(text: string): any {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}
