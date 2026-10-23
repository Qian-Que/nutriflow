import { readCache, writeCache } from './offlineStore';

type Transport = <T>(path: string, init?: RequestInit, token?: string, options?: { timeoutMs?: number }) => Promise<T>;
type Job = { id: string; status: string; phase: string; message?: string; result?: any };
type Ticket = { requestId: string; operation: string; input: unknown; jobId?: string };
export class RecognitionPendingError extends Error {}
export class RecognitionFailedError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function runRecognition<T>(transport: Transport, token: string, operation: string, input: unknown, onProgress?: (phase: string) => void): Promise<T> {
  const key = `recognition:${operation}`;
  const previous = await readCache<Ticket>(token, key);
  const ticket: Ticket = previous && JSON.stringify(previous.input) === JSON.stringify(input) ? previous : {
    operation, input, requestId: `recognition-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
  // Save before POST so a lost response can be retried with the same idempotency key.
  await writeCache(token, key, ticket);
  const deadline = Date.now() + 190000;
  try {
    let job = ticket.jobId ? await transport<Job>(`/api/recognition/jobs/${ticket.jobId}`, {}, token, {timeoutMs:12000}) :
      await transport<Job>('/api/recognition/jobs', {method:'POST',body:JSON.stringify(ticket)}, token, {timeoutMs:12000});
    ticket.jobId = job.id; await writeCache(token, key, ticket);
    while (true) {
      onProgress?.(job.phase);
      if (job.status === 'completed') return job.result as T;
      if (job.status === 'failed') {
        await writeCache(token, key, null);
        throw new RecognitionFailedError(job.message || '识别失败，请重试', job.result?.status || 502);
      }
      if (Date.now() > deadline) throw new RecognitionPendingError('识别任务已保留，稍后再次发送相同内容可继续获取结果');
      await new Promise(resolve => setTimeout(resolve, 1500));
      job = await transport<Job>(`/api/recognition/jobs/${job.id}`, {}, token, {timeoutMs:12000});
    }
  } catch (error) {
    if (error instanceof RecognitionFailedError || error instanceof RecognitionPendingError) throw error;
    const status = (error as {status?:number})?.status;
    if (status && status >= 400 && status < 500) { await writeCache(token,key,null); throw error; }
    throw new RecognitionPendingError('暂时无法获取识别结果，任务已保留；网络恢复后再次发送相同内容可继续');
  }
}
export function clearRecognition(token: string, operation: string) { return writeCache(token, `recognition:${operation}`, null); }
