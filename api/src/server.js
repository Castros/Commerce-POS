import "dotenv/config";

import { createApp } from "./app.js";
import { runMigrations } from "./db/migrate.js";
import { logger } from "./logger.js";

const port = Number(process.env.API_PORT || 4100);

async function main() {
  await runMigrations();

  const app = createApp();
  app.listen(port, () => {
    logger.info({ port }, "Commerce POS API listening");
  });
}

main().catch((err) => {
  logger.error({ err }, "Failed to start Commerce POS API");
  process.exit(1);
});

