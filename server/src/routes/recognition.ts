import { Router } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db, createId } from '../lib/db';
import { publicRecognitionJob, recoverRecognitionJobs, type RecognitionJob as Job } from '../lib/recognitionJobs';
import { requireAuth } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { allowWindow, consumeAIQuota } from '../middleware/limits';
import { withAIBudget } from '../lib/aiBudget';
import { publicAIError } from '../lib/aiErrors';
import { classifyEntry } from '../services/aiClassifier';
import { analyzeFoodImage, analyzeFoodText } from '../services/aiNutrition';
import { analyzeExerciseImage, analyzeExerciseText } from '../services/aiExercise';
import { createFoodRecord, mapLogRow } from './logs';
import { createExerciseRecord, mapExerciseRow } from './exercises';
import { onRecognitionChange, recognitionChanged } from '../lib/recognitionEvents';

const contextSchema = z.object({
  loggedAt: z.iso.datetime(), mealType: z.enum(['BREAKFAST','LUNCH','DINNER','SNACK']),
  visibility: z.enum(['PRIVATE','FRIENDS','PUBLIC']).default('PRIVATE'),
  autoSave: z.boolean().default(true),
  imageThumbnail: z.string().max(500000).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=\r\n]+$/).optional(),
});
const schema = z.object({ requestId: z.string().min(8).max(100), operation: z.enum(['entry','food-text','food-image','exercise-text','exercise-image','classify']), input: z.object({
  mode: z.enum(['AUTO','FOOD','EXERCISE']).default('AUTO'), description: z.string().trim().max(1000).optional(),
  imageBase64: z.string().max(8 * 1024 * 1024).regex(/^[A-Za-z0-9+/=\r\n]+$/).optional(), mimeType: z.enum(['image/jpeg','image/png','image/webp']).default('image/jpeg'),
}).refine(value => Boolean(value.description || value.imageBase64), '请输入文字或图片'), context: contextSchema.optional() });
let running = 0;
const maximumRunning = 4;
const active = new Set<string>();
function owned(id: string, userId: string) {
  const job = db.prepare('SELECT * FROM recognition_jobs WHERE id=? AND user_id=?').get(id, userId) as Job | undefined;
  if (!job) throw new HttpError(404, '识别任务不存在或已过期');
  return job;
}
function saveJobRecord(job: Job, body: Record<string, unknown>) {
  if (job.review_state === 'dismissed') throw new HttpError(409,'该任务已被放弃');
  if (job.status !== 'completed' || !job.result) throw new HttpError(409,'识别尚未完成');
  const result = JSON.parse(job.result), context = job.context ? JSON.parse(job.context) : {};
  if (!['pending','saved'].includes(job.review_state ?? '') || !['FOOD','EXERCISE'].includes(result.kind)) throw new HttpError(409,'任务不支持直接保存');
  const clientRequestId = 'recognition-' + job.id;
  if (job.review_state === 'saved') {
    const table = result.kind === 'FOOD' ? 'food_logs' : 'exercise_logs';
    if (!db.prepare(`SELECT id FROM ${table} WHERE user_id=? AND client_request_id=?`).get(job.user_id,clientRequestId)) throw new HttpError(409,'此任务已保存过，原记录已删除');
  }
  const input = job.input ? JSON.parse(job.input) : {};
  const payload = {...body,clientRequestId,source:'AI',
    aiProvider:result.analysis?.ai?.provider,aiModel:result.analysis?.ai?.model,aiRoute:result.analysis?.ai?.route,
    imageUri:input.imageBase64 ? `data:${input.mimeType};base64,${input.imageBase64}` : undefined,imageThumbnail:context.imageThumbnail};
  db.exec('SAVEPOINT save_recognition');
  try {
    const saved = result.kind === 'FOOD' ? createFoodRecord(job.user_id,payload,true) : createExerciseRecord(job.user_id,payload);
    delete context.imageThumbnail;
    db.prepare("UPDATE recognition_jobs SET review_state='saved',phase='已保存',error=NULL,input=NULL,context=? WHERE id=?").run(JSON.stringify(context),job.id);
    db.exec('RELEASE save_recognition');
    recognitionChanged(job.user_id);
    return saved;
  } catch (error) { db.exec('ROLLBACK TO save_recognition; RELEASE save_recognition'); throw error; }
}
function saveOriginalResult(job: Job) {
  const result = job.result ? JSON.parse(job.result) : {}, context = job.context ? JSON.parse(job.context) : {};
  const analysis = result.analysis;
  if (!analysis || !context.loggedAt) throw new HttpError(409,'没有可保存的识别结果');
  const warning = result.fallback === 'TEXT_ONLY' ? '图片未成功解析，已按文字估算'
    : !Number.isFinite(analysis.confidence) || analysis.confidence < 0.7 ? 'AI 估算，结果可能不准确' : '';
  const note = [context.description || (result.kind === 'FOOD' ? analysis.items?.map((item: {name:string})=>item.name).join('、') : analysis.notes),warning].filter(Boolean).join('；');
  const common = {loggedAt:context.loggedAt,visibility:context.visibility,note:note.slice(0,260)+(warning && note.length>260 ? `；${warning}` : '')};
  return saveJobRecord(job,result.kind === 'FOOD'
    ? {...common,...analysis.totals,nutrients:analysis.totals,items:analysis.items,mealType:context.mealType}
    : {...common,exerciseType:analysis.exerciseType,durationMin:analysis.durationMin,intensity:analysis.intensity,met:analysis.met,calories:analysis.calories});
}
function tryAutomaticSave(job: Job) {
  if (job.status !== 'completed' || job.review_state !== 'pending' || !job.context || JSON.parse(job.context).autoSave !== true) return;
  try { saveOriginalResult(job); }
  catch {
    // Keep the successful analysis and image so saving can be retried without another model call.
    db.prepare("UPDATE recognition_jobs SET phase='保存未完成',error='识别已完成，暂未保存，可直接重试保存或编辑结果' WHERE id=?").run(job.id);
  }
}
export function recoverAutomaticSaves() {
  const jobs = db.prepare("SELECT * FROM recognition_jobs WHERE status='completed' AND review_state='pending'").all() as Job[];
  for (const job of jobs) tryAutomaticSave(job);
}
async function step<T>(job: Job, label: string, column: 'classification_ms' | 'recognition_ms' | 'fallback_ms', run: () => Promise<T>) {
  db.prepare('UPDATE recognition_jobs SET phase=? WHERE id=?').run(label, job.id);
  recognitionChanged(job.user_id);
  const start = Date.now();
  try { return await run(); }
  finally { db.prepare(`UPDATE recognition_jobs SET ${column}=${column}+? WHERE id=?`).run(Date.now() - start, job.id); }
}
async function processJob(job: Job) {
  running++; active.add(job.user_id);
  db.prepare("UPDATE recognition_jobs SET status='running',started_at=?,finished_at=NULL,attempts=attempts+1,classification_ms=0,recognition_ms=0,fallback_ms=0,error=NULL WHERE id=?").run(Date.now(),job.id);
  try {
    const result = await withAIBudget(async () => {
      const input = JSON.parse(job.input!);
      const weight = (db.prepare('SELECT weight_kg FROM weight_logs WHERE user_id=? ORDER BY logged_at DESC LIMIT 1').get(job.user_id) as any)?.weight_kg
        ?? (db.prepare('SELECT weight_kg FROM users WHERE id=?').get(job.user_id) as any)?.weight_kg ?? 65;
      let kind = input.mode;
      if (job.operation === 'classify') return { classification: await step(job, '判断记录类型', 'classification_ms', () => classifyEntry(input)) };
      if (job.operation === 'entry' && kind === 'AUTO') {
        kind = (await step(job, '判断记录类型', 'classification_ms', () => classifyEntry(input))).kind;
        if (kind === 'UNKNOWN') throw new Error('无法判断记录类型，请选择明确的饮食或运动描述');
      }
      if (job.operation.startsWith('exercise') || (job.operation === 'entry' && kind === 'EXERCISE')) {
        const analysis = await step(job, '识别运动', 'recognition_ms', () => input.imageBase64 ? analyzeExerciseImage(input.imageBase64,input.mimeType,input.description,weight) : analyzeExerciseText(input.description,weight));
        return { kind: 'EXERCISE', analysis };
      }
      if (input.imageBase64) {
        try { return { kind: 'FOOD', analysis: await step(job,'识别饮食','recognition_ms',() => analyzeFoodImage(input.imageBase64,input.mimeType,input.description)) }; }
        catch (error) {
          if (!input.description || publicAIError(error).status === 504) throw error;
          return { kind: 'FOOD', analysis: await step(job,'仅按文字估算','fallback_ms',() => analyzeFoodText(input.description)), fallback: 'TEXT_ONLY' };
        }
      }
      return { kind: 'FOOD', analysis: await step(job,'识别饮食','recognition_ms',() => analyzeFoodText(input.description)) };
    });
    db.prepare("UPDATE recognition_jobs SET status='completed',phase='待校对',result=?,finished_at=?,input=CASE WHEN review_state='pending' THEN input ELSE NULL END WHERE id=?").run(JSON.stringify(result),Date.now(),job.id);
    tryAutomaticSave(owned(job.id,job.user_id));
  } catch (error) {
    const failure = error instanceof Error && error.message.startsWith('无法判断记录类型') ? { status: 422, message: error.message } : publicAIError(error);
    db.prepare("UPDATE recognition_jobs SET status='failed',phase='识别失败',finished_at=?,input=CASE WHEN review_state='pending' THEN input ELSE NULL END,error=?,result=? WHERE id=?").run(Date.now(),failure.message,JSON.stringify({status:failure.status}),job.id);
  } finally { recognitionChanged(job.user_id); running--; active.delete(job.user_id); pump(); }
}
function pump() {
  while (running < maximumRunning) {
    const jobs = db.prepare("SELECT * FROM recognition_jobs WHERE status='queued' ORDER BY created_at").all() as Job[];
    const job = jobs.find(row => !active.has(row.user_id));
    if (!job) break;
    void processJob(job);
  }
}
recoverRecognitionJobs();
recoverAutomaticSaves();
setImmediate(pump);

export const recognitionRouter = Router();
recognitionRouter.use(requireAuth);
recognitionRouter.use((_req,res,next) => { res.setHeader('Cache-Control','no-store'); next(); });
recognitionRouter.post('/jobs', (req,res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({message:parsed.error.issues[0]?.message}); return; }
  const data = parsed.data;
  if ((data.operation.endsWith('-text') && !data.input.description) || (data.operation.endsWith('-image') && !data.input.imageBase64) || (data.context && data.operation !== 'entry')) {
    throw new HttpError(400,'识别内容与类型不匹配');
  }
  const fingerprint = createHash('sha256').update(JSON.stringify([data.operation,data.input])).digest('hex');
  const context = data.context ? { ...data.context, description:data.input.description ?? '', hasImage:Boolean(data.input.imageBase64) } : null;
  const existing = db.prepare('SELECT * FROM recognition_jobs WHERE user_id=? AND request_id=?').get(req.user!.id,data.requestId) as Job | undefined;
  if (existing) {
    if (existing.review_state === 'dismissed') { res.json(publicRecognitionJob(existing)); return; }
    const storedContext = existing.context ? JSON.parse(existing.context) : null;
    if (existing.fingerprint !== fingerprint || (context && storedContext && ['loggedAt','mealType','visibility'].some(key => (storedContext as any)[key] !== (context as any)[key]))) throw new HttpError(409,'同一识别请求不能更换内容');
    // Adopt an interrupted pre-1.5 client ticket without invoking the model again.
    if (context && existing.review_state === null) {
      db.prepare("UPDATE recognition_jobs SET context=?,review_state='pending',input=? WHERE id=?").run(JSON.stringify(context),JSON.stringify(data.input),existing.id);
      tryAutomaticSave(owned(existing.id,req.user!.id));
    }
    res.json(publicRecognitionJob(owned(existing.id,req.user!.id))); return;
  }
  db.prepare("DELETE FROM recognition_jobs WHERE review_state IS NULL AND status IN ('completed','failed') AND created_at < ?").run(Date.now()-86400000);
  const busy = (db.prepare("SELECT count(*) AS n FROM recognition_jobs WHERE user_id=? AND status IN ('queued','running')").get(req.user!.id) as any).n;
  const unresolved = (db.prepare("SELECT count(*) AS n FROM recognition_jobs WHERE user_id=? AND review_state='pending'").get(req.user!.id) as any).n;
  const queued = (db.prepare("SELECT count(*) AS n FROM recognition_jobs WHERE status IN ('queued','running')").get() as any).n;
  if (busy >= (context ? 5 : 1) || unresolved >= 50 || queued >= 16) { res.setHeader('Retry-After','15'); throw new HttpError(429,'任务较多，请稍后重试或先处理未保存记录'); }
  if (!consumeAIQuota(req.user!.id)) { res.setHeader('Retry-After','60'); throw new HttpError(429,'已达到识别调用额度，请稍后重试'); }
  const id = createId();
  db.prepare("INSERT INTO recognition_jobs (id,user_id,request_id,fingerprint,operation,input,status,phase,created_at,context,review_state) VALUES (?,?,?,?,?,?,'queued','等待识别',?,?,?)")
    .run(id,req.user!.id,data.requestId,fingerprint,data.operation,JSON.stringify(data.input),Date.now(),context ? JSON.stringify(context) : null,context ? 'pending' : null);
  res.status(202).json(publicRecognitionJob(owned(id,req.user!.id))); setImmediate(pump);
});
function jobSnapshot(userId: string, includeSaved: boolean) {
  const jobs = db.prepare("SELECT * FROM recognition_jobs WHERE user_id=? AND review_state='pending' ORDER BY created_at DESC LIMIT 50").all(userId) as Job[];
  if (includeSaved) jobs.push(...db.prepare("SELECT * FROM recognition_jobs WHERE user_id=? AND review_state='saved' ORDER BY finished_at DESC LIMIT 20").all(userId) as Job[]);
  const items = jobs.map(publicRecognitionJob);
  const version = createHash('sha256').update(JSON.stringify(items.map(({timings,...item})=>({...item,timings:{uploadMs:timings.uploadMs,classificationMs:timings.classificationMs,recognitionMs:timings.recognitionMs,fallbackMs:timings.fallbackMs}})))).digest('hex');
  return {jobs:items,version};
}
recognitionRouter.get('/jobs', (req,res) => {
  res.json(jobSnapshot(req.user!.id,req.query.includeSaved === '1'));
});
recognitionRouter.get('/changes', (req,res) => {
  if (!allowWindow('recognition-watch:'+req.user!.id,120,60000)) throw new HttpError(429,'刷新过于频繁');
  const snapshot = () => jobSnapshot(req.user!.id,true).version;
  const current = snapshot();
  if (typeof req.query.version !== 'string' || req.query.version !== current) { res.json({version:current,changed:true}); return; }
  // One bounded long-poll wakes immediately on this account's job transitions.
  let stopped = false;
  const finish = (send: boolean) => {
    if (stopped) return;
    stopped=true;clearTimeout(timer);unsubscribe();res.off('close',closed);
    if (send) { const version=snapshot();res.json({version,changed:version!==current}); }
  };
  const closed=()=>finish(false);
  const unsubscribe=onRecognitionChange(req.user!.id,()=>finish(true));
  const timer=setTimeout(()=>finish(true),20000);
  res.on('close',closed);
  if (snapshot()!==current) finish(true);
});
recognitionRouter.get('/jobs/:id/record', (req,res) => {
  const job=owned(String(req.params.id),req.user!.id);
  const record=publicRecognitionJob(job).record;
  if (!record || record.deleted) throw new HttpError(404,'原记录已不存在');
  const table=record.kind==='FOOD'?'food_logs':'exercise_logs';
  const row=db.prepare(`SELECT * FROM ${table} WHERE id=? AND user_id=?`).get(record.id!,req.user!.id) as any;
  res.json(record.kind==='FOOD'?{kind:'FOOD',log:mapLogRow(row,true)}:{kind:'EXERCISE',exercise:mapExerciseRow(row)});
});
recognitionRouter.post('/jobs/:id/undo', (req,res) => {
  const job=owned(String(req.params.id),req.user!.id);
  const record=publicRecognitionJob(job).record;
  if (!record) throw new HttpError(409,'任务尚未保存');
  if (record.deleted) {res.json({ok:true});return;}
  if (!req.body?.updatedAt || req.body.updatedAt!==record.updatedAt) throw new HttpError(409,'记录已被修改，请从记录中检查后删除');
  const table=record.kind==='FOOD'?'food_logs':'exercise_logs';
  db.prepare(`DELETE FROM ${table} WHERE id=? AND user_id=?`).run(record.id!,req.user!.id);
  recognitionChanged(req.user!.id);
  res.json({ok:true});
});
recognitionRouter.get('/jobs/:id', (req,res) => { res.json(publicRecognitionJob(owned(String(req.params.id),req.user!.id))); });
recognitionRouter.delete('/uploads/:requestId', (req,res) => {
  if (!allowWindow('cancel-recognition:'+req.user!.id,30,60000)) throw new HttpError(429,'操作过于频繁，请稍后重试');
  const parsed = z.string().min(8).max(100).safeParse(req.params.requestId);
  if (!parsed.success) throw new HttpError(400,'上传标识不合法');
  const job = db.prepare('SELECT * FROM recognition_jobs WHERE request_id=? AND user_id=?').get(parsed.data,req.user!.id) as Job | undefined;
  if (job?.status === 'running' || job?.review_state === 'saved') throw new HttpError(409,'该内容已在后台处理，请刷新任务列表');
  if (job) db.prepare("UPDATE recognition_jobs SET review_state='dismissed',status='cancelled',phase='已取消上传',input=NULL,result=NULL,context=NULL,finished_at=? WHERE id=?").run(Date.now(),job.id);
  else db.prepare("INSERT INTO recognition_jobs (id,user_id,request_id,fingerprint,operation,status,phase,created_at,review_state) VALUES (?,?,?,'cancelled','entry','cancelled','已取消上传',?,'dismissed')").run(createId(),req.user!.id,parsed.data,Date.now());
  res.json({ok:true});
});
recognitionRouter.patch('/jobs/:id/timing', (req,res) => {
  const job = owned(String(req.params.id),req.user!.id);
  const parsed = z.object({uploadMs:z.number().int().min(0).max(300000)}).safeParse(req.body);
  if (!parsed.success) throw new HttpError(400,'上传耗时不合法');
  db.prepare('UPDATE recognition_jobs SET upload_ms=COALESCE(upload_ms,?) WHERE id=?').run(parsed.data.uploadMs,job.id);
  res.json({ok:true});
});
recognitionRouter.get('/jobs/:id/image', (req,res) => {
  const job = owned(String(req.params.id),req.user!.id);
  if (!job.input || job.review_state !== 'pending') throw new HttpError(404,'任务图片已清理');
  const input = JSON.parse(job.input);
  const thumbnail = job.context ? JSON.parse(job.context).imageThumbnail : undefined;
  const match = req.query.size === 'thumb' && thumbnail?.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s);
  if (!input.imageBase64) throw new HttpError(404,'此任务没有图片');
  res.type(match ? match[1] : input.mimeType).send(Buffer.from(match ? match[2] : input.imageBase64,'base64'));
});
recognitionRouter.post('/jobs/:id/retry', (req,res) => {
  const job = owned(String(req.params.id),req.user!.id);
  const retry = z.object({expectedAttempt:z.number().int().min(0)}).safeParse(req.body);
  if (!retry.success) throw new HttpError(400,'请刷新任务后重试');
  if (retry.data.expectedAttempt !== job.attempts) { res.json(publicRecognitionJob(job)); return; }
  if (job.review_state !== 'pending') throw new HttpError(409,'任务已处理');
  if (job.status !== 'failed') { res.json(publicRecognitionJob(job)); return; }
  if (!job.input) throw new HttpError(409,'原始内容已清理，请重新上传');
  const queued = (db.prepare("SELECT count(*) AS n FROM recognition_jobs WHERE status IN ('queued','running')").get() as any).n;
  const mine = (db.prepare("SELECT count(*) AS n FROM recognition_jobs WHERE user_id=? AND status IN ('queued','running')").get(req.user!.id) as any).n;
  if (queued >= 16 || mine >= 5 || !consumeAIQuota(req.user!.id)) throw new HttpError(429,'任务较多或已达到调用额度，请稍后重试');
  db.prepare("UPDATE recognition_jobs SET status='queued',phase='等待重试',created_at=?,started_at=NULL,finished_at=NULL,classification_ms=0,recognition_ms=0,fallback_ms=0,error=NULL,result=NULL WHERE id=?").run(Date.now(),job.id);
  res.status(202).json(publicRecognitionJob(owned(job.id,req.user!.id))); setImmediate(pump);
});
recognitionRouter.delete('/jobs/:id', (req,res) => {
  const job = owned(String(req.params.id),req.user!.id);
  if (job.review_state === 'saved') throw new HttpError(409,'任务已经保存，请在记录中编辑或删除');
  if (job.status === 'running') throw new HttpError(409,'正在识别，请完成后再处理');
  db.prepare("UPDATE recognition_jobs SET review_state='dismissed',status='cancelled',phase='已放弃',input=NULL,result=NULL,context=NULL,finished_at=? WHERE id=?").run(Date.now(),job.id);
  res.json({ok:true});
});
recognitionRouter.post('/jobs/:id/confirm', (req,res) => {
  const job = owned(String(req.params.id),req.user!.id);
  if (job.review_state === 'dismissed') throw new HttpError(409,'该任务已被放弃');
  if (job.status !== 'completed' || !job.result) throw new HttpError(409,'识别尚未完成');
  const result = JSON.parse(job.result);
  if (!['pending','saved'].includes(job.review_state ?? '') || !['FOOD','EXERCISE'].includes(result.kind)) throw new HttpError(409,'任务不支持直接保存');
  if ((result.fallback === 'TEXT_ONLY' || !Number.isFinite(result.analysis?.confidence) || result.analysis.confidence < 0.7) && req.body?.acknowledged !== true) throw new HttpError(400,'请先核对不确定的识别结果');
  const saved = saveJobRecord(job,req.body);
  res.status(saved.deduplicated ? 200 : 201).json(saved);
});
recognitionRouter.post('/jobs/:id/save-result', (req,res) => {
  const saved = saveOriginalResult(owned(String(req.params.id),req.user!.id));
  res.status(saved.deduplicated ? 200 : 201).json(saved);
});
