import cors from "cors";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";

import { pool } from "./db/client.js";
import { logger } from "./logger.js";

export function createApp() {
  const app = express();
  const corsOrigins = (process.env.CORS_ORIGINS || "http://localhost:3100")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error("CORS origin not allowed"));
      },
      credentials: true
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger }));

  app.get("/health", (_req, res) => {
    res.json({ data: { status: "ok" } });
  });

  app.get("/ready", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ data: { status: "ready" } });
  });

  app.get("/", (_req, res) => {
    res.json({
      data: {
        service: "commerce-pos-api",
        status: "ok"
      }
    });
  });

  app.use((err, req, res, _next) => {
    req.log.error({ err }, "Unhandled request error");
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
