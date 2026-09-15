import { AISettings, withPreviewSettings } from "../lib/aiSettings";
import { analyzeFoodText } from "./aiNutrition";
import { GeminiResponseError } from "./geminiResponse";

export async function testPrimaryAI(settings: AISettings) {
  const started = Date.now();
  // Use the configured timeout and the real recognition adapter, but never publish the draft or use a backup.
  const result = await withPreviewSettings({ ...settings, aiBackupBaseUrl: "", aiBackupModel: "", aiBackupApiKey: "" }, () => analyzeFoodText("一杯250毫升纯牛奶"));
  return { ok: true, model: result.ai?.model, elapsedMs: Date.now() - started };
}

export function describeAITestFailure(error: unknown, timeoutMs: number) {
  if (error instanceof GeminiResponseError && !error.upstreamStatus) {
    return { code: error.code, upstreamStatus: null, message: `测试失败：${error.message} 当前线上配置未改变。` };
  }
  const raw = error instanceof Error ? error.message : '';
  const statusMatch = raw.match(/(?:调用失败|HTTP|status)[^\d]{0,8}(\d{3})/i);
  const status = error instanceof GeminiResponseError ? error.upstreamStatus : statusMatch ? Number(statusMatch[1]) : undefined;
  let reason: string;
  let code: string;
  if (status === 401 || status === 403) {
    code = 'AUTH'; reason = `上游返回 ${status}：密钥无效、权限不足或服务商拒绝访问，请核对该接口对应的密钥和权限。`;
  } else if (status === 404) {
    code = 'NOT_FOUND'; reason = '上游返回 404：接口路径或模型名称不存在，请核对服务商支持的模型和接口协议。';
  } else if (status === 429) {
    code = 'RATE_LIMIT'; reason = '上游返回 429：请求限流或额度不足，请检查服务商额度或稍后重试。';
  } else if (status) {
    code = 'UPSTREAM'; reason = `上游返回 ${status}：服务商未能处理请求，请检查接口协议和服务状态。`;
  } else if (/超时|AbortError|timed?\s*out|timeout/i.test(raw)) {
    code = 'TIMEOUT'; reason = `单次请求超过设置的 ${Math.round(timeoutMs / 1000)} 秒。可调高超时后重试；这不代表密钥无效。`;
  } else if (/JSON|未返回有效内容|空响应/i.test(raw)) {
    code = 'RESPONSE_FORMAT'; reason = '接口已响应，但未返回可解析的营养识别结果，请检查模型与接口协议是否匹配。';
  } else if (/网络|fetch|ENOTFOUND|ECONN|TLS|certificate/i.test(raw)) {
    code = 'NETWORK'; reason = '应用后端未能连接 AI 服务，请检查服务商域名、证书或网络状态。手机 VPN 不会改变后端到 AI 服务的网络。';
  } else {
    code = 'UNKNOWN'; reason = '未获得有效的识别结果，请检查模型及接口协议，或稍后重试。';
  }
  // Upstream bodies and URLs can contain credentials. Return only fixed diagnostic text.
  return { code, upstreamStatus: status ?? null, message: `测试失败：${reason} 当前线上配置未改变。` };
}
