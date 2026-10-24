import { Router } from "express";
import { HttpError } from '../middleware/error';

import { createId, db, nowIso } from "../lib/db";
import { requireAuth } from "../middleware/auth";
import { createLogSchema } from "./schemas";
import { compactImage, resolveImage, storeImage } from '../lib/logImages';

export const logsRouter = Router();

type LogRow = {
  id: string;
  user_id: string;
  client_request_id: string | null;
  logged_at: string;
  meal_type: string;
  note: string | null;
  image_uri: string | null;
  source: string;
  visibility: string;
  calories: number;
  protein_gram: number;
  carbs_gram: number;
  fat_gram: number;
  fiber_gram: number | null;
  sugar_gram: number | null;
  sodium_mg: number | null;
  nutrients_json: string | null;
  items_json: string | null;
  ai_provider: string | null;
  ai_model: string | null;
  ai_route: string | null;
  created_at: string;
  updated_at: string;
};

function buildDayRange(dateString: string) {
  const start = new Date(`${dateString}T00:00:00+08:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function buildMonthRange(monthString: string) {
  const [yearRaw, monthRaw] = monthString.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const start = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00+08:00`);
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const end = new Date(`${endYear}-${String(endMonth).padStart(2, "0")}-01T00:00:00+08:00`);
  return { start: start.toISOString(), end: end.toISOString() };
}

function mapLogRow(row: LogRow, compact = false) {
  const parseMaybeJson = (value: string | null) => {
    if (!value) {
      return null;
    }
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  return {
    id: row.id,
    userId: row.user_id,
    clientRequestId: row.client_request_id,
    loggedAt: row.logged_at,
    mealType: row.meal_type,
    note: row.note,
    imageUri: compactImage(row.id,row.image_uri,compact),
    source: row.source,
    visibility: row.visibility,
    calories: row.calories,
    proteinGram: row.protein_gram,
    carbsGram: row.carbs_gram,
    fatGram: row.fat_gram,
    fiberGram: row.fiber_gram,
    sugarGram: row.sugar_gram,
    sodiumMg: row.sodium_mg,
    nutrients: parseMaybeJson(row.nutrients_json),
    items: parseMaybeJson(row.items_json),
    aiProvider: row.ai_provider,
    aiModel: row.ai_model,
    aiRoute: row.ai_route,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

logsRouter.get("/", requireAuth, async (req, res) => {
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)))) { res.status(400).json({message:'日期格式不正确'}); return; }
  const compact = req.query.compact === '1';
  const limit = Math.max(1,Math.min(200,Number(req.query.limit) || (date ? 200 : 50)));
  const offset = Math.max(0,Math.floor(Number(req.query.offset) || 0));
  if (!Number.isSafeInteger(offset) || offset > 100000) { res.status(400).json({message:'分页位置不合法'}); return; }

  const baseQuery =
    "SELECT * FROM food_logs WHERE user_id = ?" +
    (date ? " AND logged_at >= ? AND logged_at < ?" : "") +
    " ORDER BY logged_at DESC LIMIT ? OFFSET ?";

  const rows = date
    ? (db.prepare(baseQuery).all(req.user!.id, buildDayRange(date).start, buildDayRange(date).end, Math.floor(limit)+1,offset) as LogRow[])
    : (db.prepare(baseQuery).all(req.user!.id, Math.floor(limit)+1,offset) as LogRow[]);

  const hasMore = rows.length > limit;
  const logs = rows.slice(0,limit).map((row) => mapLogRow(row,compact));

  const summary = logs.reduce(
    (acc, item) => {
      acc.calories += Number(item.calories);
      acc.proteinGram += Number(item.proteinGram);
      acc.carbsGram += Number(item.carbsGram);
      acc.fatGram += Number(item.fatGram);
      acc.fiberGram += Number(item.fiberGram ?? 0);
      return acc;
    },
    { calories: 0, proteinGram: 0, carbsGram: 0, fatGram: 0, fiberGram: 0 },
  );

  res.json({ logs, summary, hasMore, nextOffset: hasMore ? offset + logs.length : null });
});

logsRouter.get('/:id/image', requireAuth, (req,res) => {
  const row = db.prepare('SELECT user_id,visibility,image_uri FROM food_logs WHERE id=?').get(String(req.params.id)) as {user_id:string;visibility:string;image_uri:string|null}|undefined;
  const friend = row && db.prepare('SELECT 1 FROM friendships WHERE (user_a_id=? AND user_b_id=?) OR (user_a_id=? AND user_b_id=?)').get(req.user!.id,row.user_id,row.user_id,req.user!.id);
  if (!row || !(row.user_id === req.user!.id || row.visibility === 'PUBLIC' || row.visibility === 'FRIENDS' && friend)) { res.status(404).json({message:'图片不存在'}); return; }
  storeImage(String(req.params.id),row.image_uri);
  const stored = db.prepare('SELECT mime,data,thumbnail FROM food_images WHERE log_id=?').get(String(req.params.id)) as {mime:string;data:Uint8Array;thumbnail:Uint8Array|null}|undefined;
  if (stored) { res.setHeader('Cache-Control','private, no-store'); res.type(stored.mime).send(Buffer.from(req.query.size === 'thumb' && stored.thumbnail ? stored.thumbnail : stored.data)); return; }
  const match = row.image_uri?.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) { res.status(404).json({message:'图片不存在'}); return; }
  res.setHeader('Cache-Control','private, no-store'); res.type(match[1]!).send(Buffer.from(match[2]!,'base64'));
});

logsRouter.get("/calendar", requireAuth, async (req, res) => {
  const month = typeof req.query.month === "string" ? req.query.month : "";

  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ message: "month 参数格式错误，应为 YYYY-MM" });
    return;
  }

  const { start, end } = buildMonthRange(month);

  const rows = db
    .prepare(
      `SELECT
        date(logged_at, '+8 hours') AS date,
        COUNT(*) AS count,
        SUM(calories) AS calories,
        SUM(protein_gram) AS protein_gram,
        SUM(carbs_gram) AS carbs_gram,
        SUM(fat_gram) AS fat_gram
      FROM food_logs
      WHERE user_id = ? AND logged_at >= ? AND logged_at < ?
      GROUP BY date(logged_at, '+8 hours')
      ORDER BY date ASC`,
    )
    .all(req.user!.id, start, end) as Array<{
    date: string;
    count: number;
    calories: number | null;
    protein_gram: number | null;
    carbs_gram: number | null;
    fat_gram: number | null;
  }>;

  const days = rows.map((row) => ({
    date: row.date,
    count: Number(row.count ?? 0),
    calories: Number(row.calories ?? 0),
    proteinGram: Number(row.protein_gram ?? 0),
    carbsGram: Number(row.carbs_gram ?? 0),
    fatGram: Number(row.fat_gram ?? 0),
  }));

  res.json({ month, days });
});

export function createFoodRecord(userId: string, payload: unknown, compact = false) {
  const parsed = createLogSchema.safeParse(payload);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? "饮食记录参数不合法");
  }

  const data = parsed.data;
  if (data.clientRequestId) {
    const existing = db
      .prepare("SELECT * FROM food_logs WHERE user_id = ? AND client_request_id = ?")
      .get(userId, data.clientRequestId) as LogRow | undefined;
    if (existing) {
      return { log: mapLogRow(existing, compact), deduplicated: true };
    }
  }
  const id = createId();
  const now = nowIso();
  const loggedAt = data.loggedAt ? new Date(data.loggedAt).toISOString() : now;

  db.prepare(
    `INSERT INTO food_logs (
      id, user_id, client_request_id, logged_at, meal_type, note, image_uri, source, visibility,
      calories, protein_gram, carbs_gram, fat_gram, fiber_gram, sugar_gram, sodium_mg,
      nutrients_json, items_json, ai_provider, ai_model, ai_route, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    data.clientRequestId ?? null,
    loggedAt,
    data.mealType,
    data.note ?? null,
    resolveImage(userId,data.imageUri),
    data.source,
    data.visibility,
    data.calories,
    data.proteinGram,
    data.carbsGram,
    data.fatGram,
    data.fiberGram ?? null,
    data.sugarGram ?? null,
    data.sodiumMg ?? null,
    data.nutrients ? JSON.stringify(data.nutrients) : null,
    data.items ? JSON.stringify(data.items) : null,
    data.aiProvider ?? null,
    data.aiModel ?? null,
    data.aiRoute ?? null,
    now,
    now,
  );

  storeImage(id,resolveImage(userId,data.imageUri),data.imageThumbnail);
  const row = db.prepare("SELECT * FROM food_logs WHERE id = ?").get(id) as LogRow;

  return { log: mapLogRow(row, compact), deduplicated: false };
}

logsRouter.post("/", requireAuth, (req, res) => {
  const result = createFoodRecord(req.user!.id, req.body);
  res.status(result.deduplicated ? 200 : 201).json(result);
});

logsRouter.put("/:id", requireAuth, async (req, res) => {
  const logId = String(req.params.id);
  const parsed = createLogSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "饮食记录参数不合法" });
    return;
  }

  const existing = db
    .prepare("SELECT id, logged_at, image_uri, ai_provider, ai_model, ai_route FROM food_logs WHERE id = ? AND user_id = ?")
    .get(logId, req.user!.id) as
    | { id: string; logged_at: string; image_uri: string | null; ai_provider: string | null; ai_model: string | null; ai_route: string | null }
    | undefined;

  if (!existing) {
    res.status(404).json({ message: "饮食记录不存在" });
    return;
  }

  const data = parsed.data;
  const now = nowIso();
  const loggedAt = data.loggedAt ? new Date(data.loggedAt).toISOString() : existing.logged_at;

  db.prepare(
    `UPDATE food_logs
     SET logged_at = ?, meal_type = ?, note = ?, image_uri = ?, source = ?, visibility = ?,
         calories = ?, protein_gram = ?, carbs_gram = ?, fat_gram = ?, fiber_gram = ?, sugar_gram = ?, sodium_mg = ?,
         nutrients_json = ?, items_json = ?, ai_provider = ?, ai_model = ?, ai_route = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).run(
    loggedAt,
    data.mealType,
    data.note ?? null,
    data.imageUri === undefined ? existing.image_uri : resolveImage(req.user!.id,data.imageUri),
    data.source,
    data.visibility,
    data.calories,
    data.proteinGram,
    data.carbsGram,
    data.fatGram,
    data.fiberGram ?? null,
    data.sugarGram ?? null,
    data.sodiumMg ?? null,
    data.nutrients ? JSON.stringify(data.nutrients) : null,
    data.items ? JSON.stringify(data.items) : null,
    data.aiProvider ?? existing.ai_provider ?? null,
    data.aiModel ?? existing.ai_model ?? null,
    data.aiRoute ?? existing.ai_route ?? null,
    now,
    logId,
    req.user!.id,
  );

  storeImage(logId, data.imageUri ? resolveImage(req.user!.id,data.imageUri) : existing.image_uri, data.imageThumbnail);
  const row = db
    .prepare("SELECT * FROM food_logs WHERE id = ? AND user_id = ?")
    .get(logId, req.user!.id) as LogRow;

  res.json({ log: mapLogRow(row) });
});

logsRouter.delete("/:id", requireAuth, async (req, res) => {
  const logId = String(req.params.id);
  const existing = db
    .prepare("SELECT id FROM food_logs WHERE id = ? AND user_id = ?")
    .get(logId, req.user!.id) as { id: string } | undefined;

  if (!existing) {
    res.status(404).json({ message: "饮食记录不存在" });
    return;
  }

  db.prepare("DELETE FROM food_logs WHERE id = ? AND user_id = ?").run(logId, req.user!.id);

  res.json({ success: true });
});
