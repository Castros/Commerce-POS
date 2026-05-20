import cors from "cors";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";

import { pool } from "./db/client.js";
import { logger } from "./logger.js";
import { requestIdMiddleware } from "./shared/http/requestId.js";
import { apiRouter } from "./routes.js";

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

        const err = new Error("CORS origin not allowed");
        err.statusCode = 403;
        callback(err);
      },
      credentials: true
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(requestIdMiddleware);
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

  app.use("/v1", apiRouter);

  app.use((err, req, res, _next) => {
    const status = err.statusCode || (err.name === "ZodError" ? 400 : 500);
    if (status >= 500 && req.log) {
      req.log.error({ err }, "Unhandled request error");
    } else if (status >= 500) {
      logger.error({ err }, "Unhandled request error");
    }

    res.status(status).json({
      error: status >= 500 ? "Internal server error" : err.message
    });
  });

  return app;
}
