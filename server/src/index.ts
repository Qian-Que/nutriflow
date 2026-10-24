import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import { config } from "./config";
import { recognitionRouter } from './routes/recognition';
import { releasesRouter } from './routes/releases';
import { authLimit, aiGuard } from './middleware/limits';
import { requireAuth } from './middleware/auth';
import { startRetentionJob } from "./lib/retention";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { authRouter } from "./routes/auth";
import { adminRouter } from "./routes/admin";
import { dataRouter } from "./routes/data";
import { classifierRouter } from "./routes/classifier";
import { exercisesRouter } from "./routes/exercises";
import { feedRouter } from "./routes/feed";
import { friendsRouter } from "./routes/friends";
import { groupsRouter } from "./routes/groups";
import { logsRouter } from "./routes/logs";
import { nutritionRouter } from "./routes/nutrition";
import { profileRouter } from "./routes/profile";
import { weightsRouter } from "./routes/weights";

const app = express();
if (process.env.RAILWAY_ENVIRONMENT_ID) app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "nutrition-server", release: "2026-10-24-r21", revision: process.env.RAILWAY_GIT_COMMIT_SHA ?? null });
});

app.use("/api/auth", authLimit, authRouter);
app.use("/api/admin", adminRouter);
app.use('/api/recognition', recognitionRouter);
app.use('/api/releases', releasesRouter);
app.use("/api/data", dataRouter);
app.use("/api/profile", profileRouter);
app.use("/api/classifier", requireAuth, aiGuard, classifierRouter);
app.post(['/api/exercises/analyze', '/api/exercises/analyze-image'], requireAuth, aiGuard);
app.use("/api/nutrition", requireAuth, aiGuard, nutritionRouter);
app.use("/api/logs", logsRouter);
app.use("/api/exercises", exercisesRouter);
app.use("/api/weights", weightsRouter);
app.use("/api/friends", friendsRouter);
app.use("/api/groups", groupsRouter);
app.use("/api/feed", feedRouter);

app.use(notFoundHandler);
app.use(errorHandler);

startRetentionJob();

app.listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port}`);
});

