import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: {
    service: "commerce-pos-api",
    application: "commerce-pos",
    environment: process.env.NODE_ENV || "development"
  },
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  formatters: {
    level(label) {
      return { level: label };
    }
  },
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers.set-cookie",
    "req.headers.x-service-token",
    "req.headers.x-spelling-app-service-token",
    "req.headers.x-commerce-api-token"
  ]
});
