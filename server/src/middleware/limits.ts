import { RequestHandler } from 'express';
import { db } from '../lib/db';
import { withAIBudget, recognitionTimeoutMs } from '../lib/aiBudget';

const windows = new Map<string, { count: number; end: number }>();
export function allowWindow(key: string, maximum: number, windowMs: number) {
  const now = Date.now();
  for (const [key, value] of windows) if (value.end <= now) windows.delete(key);
  const entry = windows.get(key);
  if (entry) { if (entry.count >= maximum) return false; entry.count++; return true; }
  if (windows.size >= 10000) return false;
  windows.set(key, { count: 1, end: now + windowMs });
  return true;
}
export const authLimit: RequestHandler = (req, res, next) => {
  if (req.method !== 'POST' || !['/login', '/register', '/forgot-password/request', '/forgot-password/confirm'].includes(req.path)) return next();
  if (!allowWindow(`auth:${req.path}:${req.ip}`, req.path === '/register' ? 10 : 30, 15 * 60000)) {
    res.setHeader('Retry-After', '900'); res.status(429).json({ message: '操作过于频繁，请稍后再试' }); return;
  }
  next();
};
db.exec('CREATE TABLE IF NOT EXISTS ai_daily_usage (user_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(user_id,day));');
export function consumeAIQuota(userId: string) {
  if (!allowWindow(`ai:${userId}`, 12, 60000)) return false;
  const day = new Date().toISOString().slice(0, 10);
  const maximum = Math.max(1, Number(process.env.AI_DAILY_LIMIT) || 200);
  db.prepare("DELETE FROM ai_daily_usage WHERE day < date('now', '-7 days')").run();
  const row = db.prepare('INSERT INTO ai_daily_usage VALUES (?,?,1) ON CONFLICT(user_id,day) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count').get(userId, day, maximum);
  return Boolean(row);
}
let active = 0;
const users = new Set<string>();
export const aiGuard: RequestHandler = (req, res, next) => {
  const id = req.user!.id;
  if (users.has(id) || active >= 8 || !consumeAIQuota(id)) {
    res.setHeader('Retry-After', '60'); res.status(429).json({ message: '已有识别正在处理，或已达到调用额度，请稍后再试' }); return;
  }
  active++; users.add(id);
  let released = false;
  const release = () => { if (!released) { released = true; active--; users.delete(id); clearTimeout(timer); } };
  const timer = setTimeout(release, recognitionTimeoutMs + 1000);
  timer.unref();
  res.once('finish', release);
  // The budget is shared by every upstream attempt in this request.
  void withAIBudget(async () => { next(); });
};
