import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./db/projects.js";
import { ensureTemplateSchema } from "./db/templates.js";
import { createProjectsRouter, createUtilityRouter } from "./routes/projects.js";
import { createTemplatesRouter } from "./routes/templates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const database = getDb();
  ensureTemplateSchema(database);
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "mapping-assurance-api" });
  });

  app.use("/api/projects", createProjectsRouter());
  app.use("/api/templates", createTemplatesRouter(database));
  app.use("/api", createUtilityRouter());

  // Serve built web client in production if present
  const webDist = path.resolve(__dirname, "../../web/dist");
  app.use(express.static(webDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(webDist, "index.html"), (err) => {
      if (err) next();
    });
  });

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error(err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Internal server error",
      });
    },
  );

  return app;
}

const PORT = Number(process.env.PORT ?? 3001);

if (process.env.NODE_ENV !== "test") {
  const app = createApp();
  const host = process.env.HOST ?? "127.0.0.1";
  app.listen(PORT, host, () => {
    console.log(`Mapping Assurance API listening on http://${host}:${PORT}`);
  });
}
