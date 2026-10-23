import { Router } from "express";
import { db } from "../lib/db";
import { requireAuth } from "../middleware/auth";
import { inlineImage } from '../lib/logImages';

export const dataRouter = Router();
dataRouter.use(requireAuth);
dataRouter.get("/export", (req, res) => {
  const id = req.user!.id;
  res.setHeader("Cache-Control", "no-store");
  res.json({ version: 1, exportedAt: new Date().toISOString(),
    profile: db.prepare("SELECT email, display_name, age, sex, height_cm, weight_kg, activity_level, goal, target_weight_kg, target_calories, target_protein_gram, target_carbs_gram, target_fat_gram FROM users WHERE id = ?").get(id),
    foodLogs: db.prepare("SELECT * FROM food_logs WHERE user_id = ? ORDER BY logged_at").all(id).map(row=>({...row,image_uri:inlineImage(row.image_uri as string|null)})),
    exerciseLogs: db.prepare("SELECT * FROM exercise_logs WHERE user_id = ? ORDER BY logged_at").all(id),
    weightLogs: db.prepare("SELECT * FROM weight_logs WHERE user_id = ? ORDER BY logged_at").all(id),
  });
});
