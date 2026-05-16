#!/usr/bin/env node
/**
 * One-shot DB smoke test. Connects using the same env-var precedence as
 * apps/web/lib/prisma.ts, runs `SELECT 1`, checks pgvector is installed,
 * and prints which host:port:db it hit so you can confirm dev-vs-prod.
 *
 * Exit codes: 0 = healthy, 1 = connection or pgvector failure.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv(join(__dirname, "..", "apps", "web", ".env"));

const url =
  process.env.DIRECT_DATABASE_URL ||
  process.env.DATABASE_URL ||
  (process.env.DB_HOST
    ? `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD ?? "")}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`
    : null);

if (!url) {
  console.error("db-check: no DATABASE_URL resolved");
  process.exit(1);
}

const parsed = new URL(url);
const target = `${parsed.hostname}:${parsed.port || 5432}/${parsed.pathname.replace(/^\//, "") || "<no-db>"}`;
console.log(`db-check: connecting to ${target}`);

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });

try {
  await client.connect();
  const ping = await client.query("SELECT 1 AS ok");
  if (ping.rows[0].ok !== 1) throw new Error("SELECT 1 returned unexpected value");
  console.log("db-check: SELECT 1 ok");

  const vec = await client.query(
    "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'",
  );
  if (vec.rows.length === 0) {
    console.error("db-check: FAIL — pgvector extension not installed. Run: CREATE EXTENSION vector;");
    process.exit(1);
  }
  console.log(`db-check: pgvector ${vec.rows[0].extversion} installed`);

  console.log("db-check: ok");
  process.exit(0);
} catch (err) {
  console.error(`db-check: FAIL — ${err.message}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}

function loadDotenv(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    if (process.env[k] !== undefined) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}
