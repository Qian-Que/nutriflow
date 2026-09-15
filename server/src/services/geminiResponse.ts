export const GEMINI_MAX_OUTPUT_TOKENS = 8192;

const messages = {
  OUTPUT_TRUNCATED: "Gemini 输出达到 token 上限，结果被截断，未作为有效识别结果使用。",
  RESPONSE_BLOCKED: "Gemini 拦截了本次请求或输出，请检查输入内容或服务商限制。",
  PROTOCOL_MISMATCH: "接口返回的不是 Gemini candidates 格式，请确认服务商提供的是 Gemini 原生协议，而不是 OpenAI 兼容协议。",
  EMPTY_RESPONSE: "Gemini 已响应，但没有返回最终答案（可能仅返回思考内容）。",
  INCOMPLETE_RESPONSE: "Gemini 未正常完成输出，未作为有效识别结果使用。",
  RESPONSE_FORMAT: "Gemini 返回了无法解析的 JSON 或不完整的分段响应。",
  UPSTREAM: "Gemini 接口返回了错误对象，请检查服务商状态、模型及权限。",
};

export class GeminiResponseError extends Error {
  constructor(public readonly code: keyof typeof messages, public readonly upstreamStatus?: number) {
    super(messages[code]);
    this.name = "GeminiResponseError";
  }
}

export function parseGeminiResponseBody(body: string): unknown {
  const raw = body.trim();
  if (!raw) throw new GeminiResponseError("EMPTY_RESPONSE");
  try { return JSON.parse(raw); } catch { /* Gateways may return SSE despite a non-streaming request. */ }
  const frames: unknown[] = [];
  for (const event of raw.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).replace(/^ /, "")).join("\n");
    if (!data.trim() || data.trim() === "[DONE]") continue;
    try { frames.push(JSON.parse(data)); }
    catch { throw new GeminiResponseError("RESPONSE_FORMAT"); }
  }
  if (!frames.length) throw new GeminiResponseError("RESPONSE_FORMAT");
  return frames;
}

export function extractGeminiText(payload: any): string {
  const frames = Array.isArray(payload) ? payload : [payload];
  const output: string[] = [];
  for (const frame of frames) {
    if (frame?.error) {
      const status = Number(frame.error.code);
      throw new GeminiResponseError("UPSTREAM", Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined);
    }
    if (frame?.promptFeedback?.blockReason && frame.promptFeedback.blockReason !== "BLOCK_REASON_UNSPECIFIED") {
      throw new GeminiResponseError("RESPONSE_BLOCKED");
    }
    if (!Array.isArray(frame?.candidates)) {
      // A terminal usage-only stream frame contains no answer text.
      if (frame?.usageMetadata && !frame?.choices) continue;
      throw new GeminiResponseError("PROTOCOL_MISMATCH");
    }
    const candidate = frame.candidates.find((item: any) => item?.index === 0) ?? frame.candidates[0];
    if (!candidate) continue;
    const finish = candidate.finishReason;
    if (finish === "MAX_TOKENS") throw new GeminiResponseError("OUTPUT_TRUNCATED");
    if (["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT"].includes(finish)) {
      throw new GeminiResponseError("RESPONSE_BLOCKED");
    }
    if (finish && finish !== "STOP" && finish !== "FINISH_REASON_UNSPECIFIED") {
      throw new GeminiResponseError("INCOMPLETE_RESPONSE");
    }
    if (Array.isArray(candidate.content?.parts)) {
      for (const part of candidate.content.parts) {
        if (part?.thought !== true && typeof part?.text === "string") output.push(part.text);
      }
    }
  }
  // Stream fragments can split JSON strings; inserting newlines corrupts them.
  const text = output.join("").trim();
  if (!text) throw new GeminiResponseError("EMPTY_RESPONSE");
  return text;
}
