import pg from "pg";

const { Pool, types } = pg;

types.setTypeParser(1082, (value) => value);

function getPoolConfig() {
  const url = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== "production") {
    return { connectionString: url };
  }
  // DO managed Postgres uses a self-signed cert chain. Strip sslmode from the
  // URL so pg-connection-string doesn't set rejectUnauthorized: true, then
  // supply our own ssl config that accepts it.
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("sslmode");
    return { connectionString: parsed.toString(), ssl: { rejectUnauthorized: false } };
  } catch {
    return { connectionString: url, ssl: { rejectUnauthorized: false } };
  }
}

export const pool = new Pool(getPoolConfig());

