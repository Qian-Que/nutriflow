import { db } from './db';

db.exec(`CREATE TABLE IF NOT EXISTS recognition_jobs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, operation TEXT NOT NULL, input TEXT,
  status TEXT NOT NULL, phase TEXT NOT NULL, result TEXT, error TEXT, created_at INTEGER NOT NULL,
  UNIQUE(user_id,request_id));
  CREATE INDEX IF NOT EXISTS recognition_owner ON recognition_jobs(user_id,created_at);`);
const columns = new Set((db.prepare('PRAGMA table_info(recognition_jobs)').all() as {name:string}[]).map(row => row.name));
const additions = { context: 'TEXT', review_state: 'TEXT', started_at: 'INTEGER', finished_at: 'INTEGER', upload_ms: 'INTEGER', classification_ms: 'INTEGER NOT NULL DEFAULT 0', recognition_ms: 'INTEGER NOT NULL DEFAULT 0', fallback_ms: 'INTEGER NOT NULL DEFAULT 0', attempts: 'INTEGER NOT NULL DEFAULT 0' };
if (Object.keys(additions).some(name => !columns.has(name))) {
  const file = (db.prepare('PRAGMA database_list').all() as {name:string;file:string}[]).find(row => row.name === 'main')?.file;
  // VACUUM INTO creates a consistent SQLite snapshot, including committed WAL contents.
  if (file) db.prepare('VACUUM INTO ?').run(`${file}.pre-background-v15-${Date.now()}.bak`);
}
for (const [name, type] of Object.entries(additions)) {
  if (!columns.has(name)) db.exec(`ALTER TABLE recognition_jobs ADD COLUMN ${name} ${type}`);
}
export type RecognitionJob = {
  id: string; user_id: string; request_id: string; fingerprint: string; operation: string; input: string | null;
  status: string; phase: string; result: string | null; error: string | null; created_at: number;
  context: string | null; review_state: string | null; started_at: number | null; finished_at: number | null;
  upload_ms: number | null; classification_ms: number; recognition_ms: number; fallback_ms: number; attempts: number;
};
export function recoverRecognitionJobs() {
  // At most one automatic replay after a process restart. Record IDs remain stable across attempts.
  db.prepare("UPDATE recognition_jobs SET status='queued',phase='服务重启，重新排队',created_at=?,started_at=NULL WHERE status='running' AND review_state='pending' AND input IS NOT NULL AND attempts < 2").run(Date.now());
  db.prepare("UPDATE recognition_jobs SET status='failed',finished_at=?,error='服务重启，识别中断，请重试',phase='识别中断' WHERE status='running'").run(Date.now());
  db.prepare("UPDATE recognition_jobs SET status='failed',input=NULL,error='服务重启，本次识别未完成，请重新识别' WHERE status='queued' AND context IS NULL").run();
  db.prepare("UPDATE recognition_jobs SET input=NULL WHERE status='failed' AND review_state IS NULL").run();
}
export function publicRecognitionJob(job: RecognitionJob) {
  const context = job.context ? JSON.parse(job.context) : undefined;
  if (context) delete context.imageThumbnail;
  const end = job.finished_at ?? Date.now();
  return {
    id: job.id, requestId: job.request_id, status: job.status, phase: job.phase, reviewState: job.review_state,
    result: job.result ? JSON.parse(job.result) : undefined, message: job.error, context, createdAt: job.created_at,
    attempts: job.attempts, retryable: job.status === 'failed' && Boolean(job.input),
    timings: { uploadMs: job.upload_ms, queueMs: job.started_at || job.status === 'queued' ? Math.max(0, (job.started_at ?? end) - job.created_at) : null,
      classificationMs: job.classification_ms, recognitionMs: job.recognition_ms, fallbackMs: job.fallback_ms,
      processingMs: job.started_at ? Math.max(0, end - job.started_at) : null },
  };
}
