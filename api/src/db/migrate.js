import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pool } from "./client.js";
import { logger } from "../logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, "migrations");

export async function runMigrations() {
  // Debug: log current user and schema privileges
  const dbInfo = await pool.query(`
    SELECT current_user,
           has_schema_privilege(current_user, 'public', 'CREATE') AS can_create,
           has_schema_privilege(current_user, 'public', 'USAGE')  AS can_use
  `);
  logger.info({ dbInfo: dbInfo.rows[0] }, "DB connection info");

  // PG 15+ revoked CREATE on public schema from PUBLIC role by default.
  await pool.query(`GRANT ALL ON SCHEMA public TO CURRENT_USER`);

  await pool.query(
    "SELECT pg_advisory_lock(hashtext('commerce_pos_schema_migrations'))"
  );

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const applied = await pool.query(
        "SELECT 1 FROM schema_migrations WHERE filename = $1",
        [file]
      );

      if (applied.rowCount > 0) {
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");

      await pool.query("BEGIN");
      try {
        await pool.query(sql);
        await pool.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1)",
          [file]
        );
        await pool.query("COMMIT");
        logger.info({ migration: file }, "Applied migration");
      } catch (err) {
        await pool.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    await pool.query(
      "SELECT pg_advisory_unlock(hashtext('commerce_pos_schema_migrations'))"
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(async () => {
      await pool.end();
    })
    .catch(async (err) => {
      logger.error({ err }, "Migration failed");
      await pool.end();
      process.exit(1);
    });
}
