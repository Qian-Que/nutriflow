import { Router } from "express";
import multer from "multer";

import { requireAuth } from "../middleware/auth";
import { publicAIError } from '../lib/aiErrors';
import { analyzeFoodImage, analyzeFoodText } from "../services/aiNutrition";

export const nutritionRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});


nutritionRouter.post("/analyze-image", requireAuth, upload.single("image"), async (req, res) => {
  let imageBase64: string | undefined;
  let mimeType = "image/jpeg";
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";

  if (req.file) {
    imageBase64 = req.file.buffer.toString("base64");
    mimeType = req.file.mimetype || mimeType;
  } else if (typeof req.body?.imageBase64 === "string") {
    imageBase64 = req.body.imageBase64;
    mimeType = typeof req.body?.mimeType === "string" ? req.body.mimeType : mimeType;
  }

  if (!imageBase64) {
    res.status(400).json({ message: "请提供图片文件或 imageBase64" });
    return;
  }

  if (description.length > 1000) {
    res.status(400).json({ message: "补充描述过长，请控制在 1000 字以内" });
    return;
  }

  try {
    const analysis = await analyzeFoodImage(imageBase64, mimeType, description || undefined);
    res.json({ analysis });
  } catch (error) {
    console.error('analyze-image failed:', publicAIError(error).message);
    if (description) {
      try {
        const fallbackAnalysis = await analyzeFoodText(description);
        res.json({
          analysis: fallbackAnalysis,
          fallback: "TEXT_ONLY",
          message: "图片识别失败，已按文字描述估算",
        });
        return;
      } catch (fallbackError) {
        console.error('analyze-image text fallback failed:', publicAIError(fallbackError).message);
      }
    }
    const failure = publicAIError(error); res.status(failure.status).json({ message: failure.message });
  }
});

nutritionRouter.post("/analyze-text", requireAuth, async (req, res) => {
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";

  if (!description) {
    res.status(400).json({ message: "请提供文字描述" });
    return;
  }

  if (description.length > 1000) {
    res.status(400).json({ message: "文字描述过长，请控制在 1000 字以内" });
    return;
  }

  try {
    const analysis = await analyzeFoodText(description);
    res.json({ analysis });
  } catch (error) {
    const failure = publicAIError(error); res.status(failure.status).json({ message: failure.message });
  }
});

