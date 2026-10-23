import { db } from './db';
import { HttpError } from '../middleware/error';
db.exec('CREATE TABLE IF NOT EXISTS food_images (log_id TEXT PRIMARY KEY REFERENCES food_logs(id) ON DELETE CASCADE, mime TEXT NOT NULL, data BLOB NOT NULL, thumbnail BLOB);');

function decode(uri: string) {
  const match = uri.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
  return match ? {mime:match[1]!,data:Buffer.from(match[2]!,'base64')} : null;
}
export function storeImage(id: string, uri: string | null, thumbnail?: string) {
  if (!uri?.startsWith('data:image/')) return;
  const image = decode(uri);
  if (!image) return;
  const small = thumbnail ? decode(thumbnail) : null;
  db.exec('SAVEPOINT store_image');
  try {
    db.prepare('INSERT INTO food_images VALUES (?,?,?,?) ON CONFLICT(log_id) DO UPDATE SET mime=excluded.mime,data=excluded.data,thumbnail=excluded.thumbnail').run(id,image.mime,image.data,small?.mime === image.mime ? small.data : null);
    db.prepare('UPDATE food_logs SET image_uri=? WHERE id=?').run(`/api/logs/${id}/image`,id);
    db.exec('RELEASE store_image');
  } catch (error) { db.exec('ROLLBACK TO store_image; RELEASE store_image'); throw error; }
}
export function inlineImage(uri: string | null): string | null {
  const match = uri?.match(/^\/api\/logs\/([a-zA-Z0-9-]+)\/image(?:\?size=thumb)?$/);
  if (!match) return uri;
  const row = db.prepare('SELECT mime,data FROM food_images WHERE log_id=?').get(match[1]!) as {mime:string;data:Uint8Array}|undefined;
  return row ? `data:${row.mime};base64,${Buffer.from(row.data).toString('base64')}` : null;
}

export function compactImage(id: string, uri: string | null, compact: boolean) {
  if (!compact) return inlineImage(uri);
  // Older inline photos are migrated lazily; no destructive bulk rewrite at startup.
  if (uri?.startsWith('data:image/')) { storeImage(id,uri); return `/api/logs/${id}/image?size=thumb`; }
  return uri?.startsWith('/api/logs/') ? uri + '?size=thumb' : uri;
}
export function resolveImage(userId: string, uri?: string): string | null {
  if (!uri) return null;
  const match = uri.match(/^\/api\/logs\/([a-zA-Z0-9-]+)\/image(?:\?size=thumb)?$/);
  if (!match) return uri;
  const row = db.prepare('SELECT image_uri FROM food_logs WHERE id=? AND user_id=?').get(match[1]!,userId) as {image_uri:string|null}|undefined;
  if (!row) throw new HttpError(400,'原图片已不存在，请重新选择图片');
  return inlineImage(row.image_uri);
}
