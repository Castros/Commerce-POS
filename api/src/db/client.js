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

// DO managed Postgres: 'db' user has no CREATE on public schema.
// All tables live in the 'app' schema; set search_path on every connection.
if (process.env.NODE_ENV === "production") {
  const schema = process.env.DB_SCHEMA || "app";
  pool.on("connect", (client) => {
    client.query(`SET search_path TO "${schema}", public`);
  });
}

