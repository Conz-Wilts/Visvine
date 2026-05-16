#!/usr/bin/env node
/**
 * Refuses to run when the active DATABASE_URL is not unambiguously local.
 * Used by destructive scripts: seed, db:fresh, db:reset.
 *
 * Local = NODE_ENV !== "production" AND the resolved connection host is
 * 127.0.0.1 / localhost / a docker-compose service name. Anything else
 * (Cloud SQL Auth Proxy is also 127.0.0.1, so we additionally refuse if
 * CLOUD_SQL_CONNECTION_NAME is set in the same env).
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Lazy .env load so this works from `node scripts/guard-local-db.mjs` too.
loadDotenv(join(__dirname, "..", "apps", "web", ".env"));

const url =
  process.env.DIRECT_DATABASE_URL ||
  process.env.DATABASE_URL ||
  (process.env.DB_HOST
    ? `postgresql://x:x@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME ?? ""}`
    : null);

if (!url) {
  fail("No DATABASE_URL resolved. Refusing to run a destructive command without an explicit local target.");
}

if (process.env.NODE_ENV === "production") {
  fail(`NODE_ENV=production. Refusing destructive command.`);
}

if (process.env.CLOUD_SQL_CONNECTION_NAME) {
  fail(
    `CLOUD_SQL_CONNECTION_NAME is set (${process.env.CLOUD_SQL_CONNECTION_NAME}). ` +
      `That env looks like it's pointed at prod via the Cloud SQL Auth Proxy. ` +
      `Switch to your dev .env before running destructive commands.`,
  );
}

let host;
try {
  host = new URL(url).hostname;
} catch {
  fail(`Could not parse DATABASE_URL host. Refusing.`);
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "postgres", "visvine-postgres"]);
if (!LOCAL_HOSTS.has(host)) {
  fail(`DATABASE_URL host is "${host}" — not in the local allowlist. Refusing.`);
}

console.log(`guard-local-db: ok (host=${host}, NODE_ENV=${process.env.NODE_ENV ?? "<unset>"})`);

function fail(msg) {
  console.error(`\n  REFUSED: ${msg}\n`);
  console.error(`  If you really mean to do this, unset NODE_ENV/CLOUD_SQL_CONNECTION_NAME`);
  console.error(`  and point DATABASE_URL at a local host.\n`);
  process.exit(1);
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
