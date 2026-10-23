import { GeminiResponseError } from '../services/geminiResponse';

export function publicAIError(error: unknown): { status: number; message: string } {
  if (error instanceof GeminiResponseError) return { status: 502, message: error.message };
  const text = error instanceof Error ? error.message : '';
  if (/不是运动记录|运动信息不足|非运动记录/.test(text)) return { status: 422, message: '图片不是运动记录或运动信息不足' };
  if (/timeout|timed out|超时|aborted/i.test(text)) return { status: 504, message: '识别达到本次时间上限，请稍后重试或选择更快的模型' };
  if (/401|403|invalid_api_key/i.test(text)) return { status: 502, message: 'AI 服务鉴权失败，请联系管理员检查线路权限' };
  if (/429/.test(text)) return { status: 429, message: 'AI 服务繁忙或额度不足，请稍后重试' };
  return { status: 502, message: 'AI 识别未完成，请稍后重试或联系管理员检查线路' };
}
