import { AsyncLocalStorage } from "node:async_hooks";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config";
import { db, nowIso } from "./db";

export type AISettings = Pick<typeof config, "aiProvider" | "aiBaseUrl" | "aiApiKey" | "aiModel" | "aiImageDetail" | "aiTimeoutMs" | "aiBackupProvider" | "aiBackupBaseUrl" | "aiBackupApiKey" | "aiBackupModel" | "aiBackupImageDetail" | "aiBackupTimeoutMs">;
const preview = new AsyncLocalStorage<AISettings>();
const encryptionKey = () => createHash("sha256").update(process.env.AI_SETTINGS_SECRET || config.jwtSecret).digest();

db.exec(`CREATE TABLE IF NOT EXISTS ai_settings (id INTEGER PRIMARY KEY CHECK(id = 1), encrypted TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_admins (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY);`);

// Bind the existing owner's account once. Registering this email later grants no privileges.
db.exec("BEGIN");
try {
  if (!db.prepare("SELECT name FROM app_migrations WHERE name = ?").get("admin-bootstrap-v1")) {
    db.prepare("INSERT OR IGNORE INTO app_admins SELECT id FROM users WHERE lower(email) = ?")
      .run((process.env.INITIAL_ADMIN_EMAIL || "18964092532@163.com").trim().toLowerCase());
    db.prepare("INSERT INTO app_migrations VALUES (?)").run("admin-bootstrap-v1");
  }
  db.exec("COMMIT");
} catch (error) { db.exec("ROLLBACK"); throw error; }

export function isAdmin(userId: string) {
  return Boolean(db.prepare("SELECT user_id FROM app_admins WHERE user_id = ?").get(userId));
}

function readSaved(): (AISettings & { updatedAt: string }) | null {
  const row = db.prepare("SELECT encrypted, updated_at FROM ai_settings WHERE id = 1").get() as { encrypted: string; updated_at: string } | undefined;
  if (!row) return null;
  const [iv, tag, data] = row.encrypted.split(".");
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  cipher.setAuthTag(Buffer.from(tag, "base64"));
  return { ...JSON.parse(Buffer.concat([cipher.update(Buffer.from(data, "base64")), cipher.final()]).toString("utf8")), updatedAt: row.updated_at };
}

export function getAIConfig(): AISettings {
  return preview.getStore() ?? readSaved() ?? config;
}

export function publicAISettings() {
  const saved = readSaved();
  const current = saved ?? config;
  return {
    aiProvider: current.aiProvider, aiBaseUrl: current.aiBaseUrl, aiModel: current.aiModel,
    aiImageDetail: current.aiImageDetail, aiTimeoutMs: current.aiTimeoutMs,
    aiBackupProvider: current.aiBackupProvider, aiBackupBaseUrl: current.aiBackupBaseUrl,
    aiBackupModel: current.aiBackupModel, aiBackupImageDetail: current.aiBackupImageDetail,
    aiBackupTimeoutMs: current.aiBackupTimeoutMs,
    hasApiKey: Boolean(current.aiApiKey), hasBackupApiKey: Boolean(current.aiBackupApiKey),
    source: saved ? "database" : "environment", updatedAt: saved?.updatedAt ?? null,
  };
}

export function saveAISettings(settings: AISettings, userId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(settings), "utf8"), cipher.final()]);
  const encrypted = [iv, cipher.getAuthTag(), data].map(part => part.toString("base64")).join(".");
  db.prepare("INSERT INTO ai_settings VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET encrypted=excluded.encrypted, updated_by=excluded.updated_by, updated_at=excluded.updated_at")
    .run(encrypted, userId, nowIso());
}

export function resetAISettings() { db.prepare("DELETE FROM ai_settings WHERE id = 1").run(); }
export function withPreviewSettings<T>(settings: AISettings, run: () => Promise<T>) { return preview.run(settings, run); }
