import { Router } from "express";

import { requireAuth } from "../middleware/auth";
import { publicAIError } from '../lib/aiErrors';
import { classifyEntry } from "../services/aiClassifier";
import { classifyEntrySchema } from "./schemas";

export const classifierRouter = Router();

classifierRouter.post("/analyze", requireAuth, async (req, res) => {
  const parsed = classifyEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "分类参数不合法" });
    return;
  }

  try {
    const classification = await classifyEntry(parsed.data);
    res.json({ classification });
  } catch (error) {
    const failure = publicAIError(error); res.status(failure.status).json({ message: failure.message });
  }
});
