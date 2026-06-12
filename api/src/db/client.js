import pg from "pg";

const { Pool, types } = pg;

types.setTypeParser(1082, (value) => value);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

