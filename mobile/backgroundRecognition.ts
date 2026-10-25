import { readCache, readDraft, updateCache, writeCache, writeDraft } from './offlineStore';

export type RecognitionTransport = <T>(path: string, init?: RequestInit, token?: string, options?: { timeoutMs?: number }) => Promise<T>;
export type JobTimings = { uploadMs: number | null; queueMs: number | null; classificationMs: number; recognitionMs: number; fallbackMs: number; processingMs: number | null };
export type JobContext = { loggedAt: string; mealType: string; visibility: string; description?: string; hasImage?: boolean; imageThumbnail?: string; autoSave?: boolean };
export type BackgroundJob = { id: string; requestId: string; status: string; phase: string; reviewState: string; result?: any; context: JobContext; createdAt: number; timings: JobTimings; message?: string; retryable: boolean; attempts: number };
export type UploadTicket = { requestId: string; operation: 'entry'; input: { mode: string; description?: string; imageBase64?: string; mimeType: string }; context: JobContext };
export const UPLOAD_CACHE = 'recognition-upload-v1';
export const JOBS_CACHE = 'recognition-inbox-v1';
const uploading = new Map<string, Promise<{ job: BackgroundJob; ticket: UploadTicket; clearedDraft: boolean }>>();
export function matchesUploadDraft(draft: {text:string;imageBase64:string|null;mimeType:string} | null, ticket: UploadTicket) {
  return Boolean(draft && draft.text.trim() === (ticket.input.description ?? '') && (draft.imageBase64 ?? '') === (ticket.input.imageBase64 ?? '') && draft.mimeType === ticket.input.mimeType);
}
async function accepted(transport: RecognitionTransport, token: string, ticket: UploadTicket, job: BackgroundJob, uploadMs?: number) {
  if (uploadMs !== undefined) job = { ...job, timings: { ...job.timings, uploadMs } };
  await updateCache<BackgroundJob[]>(token, JOBS_CACHE, current => ['pending','saved'].includes(job.reviewState) ? [job, ...(current ?? []).filter(row => row.id !== job.id)] : (current ?? []).filter(row => row.id !== job.id));
  const latest = await readCache<UploadTicket>(token,UPLOAD_CACHE);
  const draft = await readDraft(token);
  const clearedDraft = latest?.requestId === ticket.requestId && job.reviewState !== 'dismissed' && matchesUploadDraft(draft,ticket);
  if (clearedDraft) await writeDraft(token, { ...draft!, text: '', imageBase64: null, mimeType: 'image/jpeg' });
  await updateCache<UploadTicket>(token, UPLOAD_CACHE, value => value?.requestId === ticket.requestId ? null : value);
  if (uploadMs !== undefined) void transport(`/api/recognition/jobs/${job.id}/timing`, {method:'PATCH',body:JSON.stringify({uploadMs})}, token, {timeoutMs:4000}).catch(() => {});
  return { job, ticket, clearedDraft };
}
export async function prepareUpload(token: string, input: UploadTicket['input'], context: JobContext): Promise<UploadTicket> {
  const previous = await readCache<UploadTicket>(token, UPLOAD_CACHE);
  if (previous) {
    if (JSON.stringify(previous.input) !== JSON.stringify(input)) throw new Error('上一条上传尚未确认，请先在任务列表中重试上传');
    return previous;
  }
  const ticket: UploadTicket = { requestId: `background-${Date.now()}-${Math.random().toString(36).slice(2)}`, operation:'entry', input, context };
  await writeCache(token, UPLOAD_CACHE, ticket);
  return ticket;
}
export function uploadRecognition(transport: RecognitionTransport, token: string, ticket: UploadTicket) {
  const current = uploading.get(token); if (current) return current;
  const operation = (async () => {
    const started = Date.now();
    const job = await transport<BackgroundJob>('/api/recognition/jobs', {method:'POST',body:JSON.stringify(ticket)}, token, {timeoutMs:45000});
    return accepted(transport,token,ticket,job,Date.now()-started);
  })().finally(() => uploading.delete(token));
  uploading.set(token, operation); return operation;
}
export async function recoverUpload(transport: RecognitionTransport, token: string, jobs: BackgroundJob[], allowPost = true) {
  const ticket = await readCache<UploadTicket>(token, UPLOAD_CACHE);
  if (!ticket) return null;
  const found = jobs.find(job => job.requestId === ticket.requestId);
  return found ? accepted(transport,token,ticket,found) : allowPost ? uploadRecognition(transport,token,ticket) : null;
}
export async function mergeJobList(token: string, jobs: BackgroundJob[]) {
  return (await updateCache<BackgroundJob[]>(token,JOBS_CACHE,previous => jobs.map(job => {
    const local = previous?.find(row => row.id === job.id);
    return job.timings.uploadMs === null && local?.timings.uploadMs != null ? { ...job,timings:{...job.timings,uploadMs:local.timings.uploadMs} } : job;
  }))) ?? [];
}
export async function abandonUpload(transport: RecognitionTransport, token: string) {
  const ticket = await readCache<UploadTicket>(token,UPLOAD_CACHE);
  if (!ticket) return;
  await transport(`/api/recognition/uploads/${encodeURIComponent(ticket.requestId)}`,{method:'DELETE'},token,{timeoutMs:10000});
  await updateCache<UploadTicket>(token,UPLOAD_CACHE,value=>value?.requestId===ticket.requestId?null:value);
}
