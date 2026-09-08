import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import { getAIConfig, isAdmin, publicAISettings, resetAISettings, saveAISettings } from "../lib/aiSettings";
import { describeAITestFailure, testPrimaryAI } from "../services/aiSettingsTest";

const provider = z.enum(["openai", "openai_compat_auto", "openai_compat_responses", "openai_compat_chat", "gemini"]);
const endpoint = z.string().max(500).refine(value => {
  if (!value) return true;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash; } catch { return false; }
}, "接口地址必须是 HTTPS 地址，不能包含密钥、查询参数或账号密码");
const settingsSchema = z.object({
  aiProvider: provider, aiBaseUrl: endpoint.refine(Boolean, "请填写主接口地址"), aiModel: z.string().trim().min(1).max(120),
  aiApiKey: z.string().trim().max(2000).optional(),
  aiImageDetail: z.enum(["auto", "low", "high"]), aiTimeoutMs: z.number().int().min(5000).max(120000),
  aiBackupProvider: provider, aiBackupBaseUrl: endpoint, aiBackupModel: z.string().trim().max(120),
  aiBackupApiKey: z.string().trim().max(2000).optional(), clearBackupKey: z.boolean().optional(),
  aiBackupImageDetail: z.enum(["", "auto", "low", "high"]), aiBackupTimeoutMs: z.number().int().min(0).max(120000),
}).strict();

export const adminRouter = Router();
adminRouter.use(requireAuth);
adminRouter.get("/access", (req, res) => { res.json({ isAdmin: isAdmin(req.user!.id) }); });
adminRouter.use((req, res, next) => {
  if (!isAdmin(req.user!.id)) { res.status(403).json({ message: "仅管理员可修改全局 AI 设置" }); return; }
  res.setHeader("Cache-Control", "no-store");
  next();
});
adminRouter.get("/ai-settings", (_req, res) => { res.json(publicAISettings()); });
adminRouter.delete("/ai-settings", (_req, res) => { resetAISettings(); res.json(publicAISettings()); });
adminRouter.post("/ai-settings/test", async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: parsed.error.issues[0]?.message }); return; }
  const settings = resolveSettings(parsed.data);
  if (!settings.aiApiKey) { res.status(400).json({ message: "请填写主线路 API 密钥" }); return; }
  try {
    res.json(await testPrimaryAI(settings));
  } catch (error) { res.status(502).json(describeAITestFailure(error, settings.aiTimeoutMs)); }
});
adminRouter.put("/ai-settings", (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: parsed.error.issues[0]?.message }); return; }
  const settings = resolveSettings(parsed.data);
  if (!settings.aiApiKey) { res.status(400).json({ message: "请填写主线路 API 密钥" }); return; }
  saveAISettings(settings, req.user!.id);
  res.json(publicAISettings());
});
function resolveSettings(input: z.infer<typeof settingsSchema>) {
  const current = getAIConfig();
  const { clearBackupKey, ...values } = input;
  // Never silently forward an old secret to a newly entered endpoint.
  const resolved = { ...values,
    aiApiKey: input.aiApiKey || (input.aiBaseUrl === current.aiBaseUrl ? current.aiApiKey : ""),
    aiBackupApiKey: clearBackupKey ? "" : input.aiBackupApiKey || (input.aiBackupBaseUrl === current.aiBackupBaseUrl ? current.aiBackupApiKey : ""),
  };
  if (resolved.aiBackupBaseUrl && resolved.aiBackupBaseUrl !== resolved.aiBaseUrl && !resolved.aiBackupApiKey) {
    throw new HttpError(400, "不同的备用接口必须单独填写 API 密钥");
  }
  return resolved;
}
