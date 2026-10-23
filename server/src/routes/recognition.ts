import { Router } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db, createId } from '../lib/db';
import { requireAuth } from '../middleware/auth';
import { consumeAIQuota } from '../middleware/limits';
import { withAIBudget } from '../lib/aiBudget';
import { publicAIError } from '../lib/aiErrors';
import { classifyEntry } from '../services/aiClassifier';
import { analyzeFoodImage, analyzeFoodText } from '../services/aiNutrition';
import { analyzeExerciseImage, analyzeExerciseText } from '../services/aiExercise';

db.exec(`CREATE TABLE IF NOT EXISTS recognition_jobs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, operation TEXT NOT NULL, input TEXT,
  status TEXT NOT NULL, phase TEXT NOT NULL, result TEXT, error TEXT, created_at INTEGER NOT NULL,
  UNIQUE(user_id,request_id));
  CREATE INDEX IF NOT EXISTS recognition_owner ON recognition_jobs(user_id,created_at);
  UPDATE recognition_jobs SET status='failed',input=NULL,error='服务重启，本次识别未完成，请重新识别' WHERE status IN ('queued','running');`);
type Job = { id: string; user_id: string; request_id: string; fingerprint: string; operation: string; input: string | null; status: string; phase: string; result: string | null; error: string | null; created_at: number };
const schema = z.object({ requestId: z.string().min(8).max(100), operation: z.enum(['entry','food-text','food-image','exercise-text','exercise-image','classify']), input: z.object({
  mode: z.enum(['AUTO','FOOD','EXERCISE']).default('AUTO'), description: z.string().trim().max(1000).optional(),
  imageBase64: z.string().max(8 * 1024 * 1024).optional(), mimeType: z.enum(['image/jpeg','image/png','image/webp']).default('image/jpeg'),
}).refine(value => Boolean(value.description || value.imageBase64), '请输入文字或图片') });
let running = 0;
const maximumRunning = 4;
function phase(id: string, value: string) { db.prepare('UPDATE recognition_jobs SET phase=? WHERE id=?').run(value, id); }
async function processJob(job: Job) {
  running++;
  db.prepare("UPDATE recognition_jobs SET status='running' WHERE id=?").run(job.id);
  try {
    const result = await withAIBudget(async () => {
      const input = JSON.parse(job.input!);
      const weight = (db.prepare('SELECT weight_kg FROM weight_logs WHERE user_id=? ORDER BY logged_at DESC LIMIT 1').get(job.user_id) as any)?.weight_kg
        ?? (db.prepare('SELECT weight_kg FROM users WHERE id=?').get(job.user_id) as any)?.weight_kg ?? 65;
      let kind = input.mode;
      if (job.operation === 'classify') return { classification: await classifyEntry(input) };
      if (job.operation === 'entry' && kind === 'AUTO') {
        phase(job.id, '判断记录类型'); kind = (await classifyEntry(input)).kind;
        if (kind === 'UNKNOWN') throw new Error('无法判断记录类型，请明确选择饮食或运动');
      }
      if (job.operation.startsWith('exercise') || (job.operation === 'entry' && kind === 'EXERCISE')) {
        phase(job.id, '识别运动');
        const analysis = input.imageBase64 ? await analyzeExerciseImage(input.imageBase64, input.mimeType, input.description, weight) : await analyzeExerciseText(input.description, weight);
        return { kind: 'EXERCISE', analysis };
      }
      phase(job.id, '识别饮食');
      if (input.imageBase64) {
        try { return { kind: 'FOOD', analysis: await analyzeFoodImage(input.imageBase64, input.mimeType, input.description) }; }
        catch (error) {
          if (!input.description || publicAIError(error).status === 504) throw error;
          phase(job.id, '仅按文字估算');
          return { kind: 'FOOD', analysis: await analyzeFoodText(input.description), fallback: 'TEXT_ONLY' };
        }
      }
      return { kind: 'FOOD', analysis: await analyzeFoodText(input.description) };
    });
    db.prepare("UPDATE recognition_jobs SET status='completed',phase='识别完成',result=?,input=NULL WHERE id=?").run(JSON.stringify(result), job.id);
  } catch (error) {
    const failure = error instanceof Error && error.message.startsWith('无法判断记录类型') ? { status: 422, message: '无法判断记录类型，请明确选择饮食或运动' } : publicAIError(error);
    db.prepare("UPDATE recognition_jobs SET status='failed',input=NULL,error=?,result=? WHERE id=?").run(failure.message, JSON.stringify({ status: failure.status }), job.id);
  } finally { running--; pump(); }
}
function pump() {
  while (running < maximumRunning) {
    const job = db.prepare("SELECT * FROM recognition_jobs WHERE status='queued' ORDER BY created_at LIMIT 1").get() as Job | undefined;
    if (!job) break;
    void processJob(job);
  }
}
function publicJob(job: Job) { return { id: job.id, status: job.status, phase: job.phase, result: job.result ? JSON.parse(job.result) : undefined, message: job.error }; }
export const recognitionRouter = Router();
recognitionRouter.use(requireAuth);
recognitionRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
recognitionRouter.post('/jobs', (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: parsed.error.issues[0]?.message }); return; }
  const data = parsed.data;
  if (data.operation.endsWith('-text') && !data.input.description || data.operation.endsWith('-image') && !data.input.imageBase64) {
    res.status(400).json({ message: '识别内容与类型不匹配' }); return;
  }
  const fingerprint = createHash('sha256').update(JSON.stringify([data.operation,data.input])).digest('hex');
  const existing = db.prepare('SELECT * FROM recognition_jobs WHERE user_id=? AND request_id=?').get(req.user!.id, data.requestId) as Job | undefined;
  if (existing) {
    if (existing.fingerprint !== fingerprint) { res.status(409).json({ message: '同一识别请求不能更换内容' }); return; }
    res.json(publicJob(existing)); return;
  }
  db.prepare("DELETE FROM recognition_jobs WHERE status IN ('completed','failed') AND created_at < ?").run(Date.now() - 86400000);
  const busy = db.prepare("SELECT 1 FROM recognition_jobs WHERE user_id=? AND status IN ('queued','running')").get(req.user!.id);
  const queue = (db.prepare("SELECT count(*) AS n FROM recognition_jobs WHERE status IN ('queued','running')").get() as any).n;
  if (busy || queue >= 16 || !consumeAIQuota(req.user!.id)) { res.setHeader('Retry-After','60'); res.status(429).json({ message: '已有识别任务，或已达到调用额度，请稍后重试' }); return; }
  const id = createId();
  db.prepare("INSERT INTO recognition_jobs VALUES (?,?,?,?,?,?,'queued','等待识别',NULL,NULL,?)").run(id,req.user!.id,data.requestId,fingerprint,data.operation,JSON.stringify(data.input),Date.now());
  res.status(202).json({ id, status: 'queued', phase: '等待识别' });
  setImmediate(pump);
});
recognitionRouter.get('/jobs/:id', (req,res) => {
  const job = db.prepare('SELECT * FROM recognition_jobs WHERE id=? AND user_id=?').get(String(req.params.id),req.user!.id) as Job | undefined;
  if (!job) { res.status(404).json({ message: '识别任务不存在或已过期，请重新识别' }); return; }
  res.json(publicJob(job));
});
