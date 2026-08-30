import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

const url =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  (process.env.DB_HOST
    ? `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD ?? "")}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`
    : null);

if (!url) {
  console.error("DATABASE_URL not set; skipping SQL function application.");
  process.exit(0);
}

// Hand-written SQL to apply against the DB AFTER the migrations — paths are
// relative to apps/web. Everything here MUST be idempotent: it re-runs in full
// on every deploy.
//
// The retrieval indexes (HNSW for the two pgvector cosine rankings, GIN for the
// chunk keyword stage) live here because a migration only carries what
// schema.prisma can express, and Prisma cannot express either index type.
// The public-space-name index is partial + expression-based, which Prisma also
// cannot express; it backs the uniqueness rule in lib/spaces/publicName.ts.
//
// The table names here must track the schema. prod-schema-presync renames the
// live objects; these statements create them on a database that never had them.
const files = [
  "prisma/sql/retrieval-indexes.sql",
  "prisma/sql/public-space-name-unique.sql",
];

if (files.length === 0) {
  console.log("apply-sql-functions: nothing to apply.");
  process.exit(0);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const f of files) {
    const path = join(__dirname, "..", f);
    // A missing file is fatal. These indexes are invisible when absent — search
    // degrades to sequential scans and the uniqueness rule stops being enforced,
    // with nothing failing — so a moved or renamed file must stop the deploy.
    if (!existsSync(path)) throw new Error(`apply-sql-functions: missing ${f}`);
    const sql = readFileSync(path, "utf8");
    await client.query(sql);
    console.log(`applied: ${f}`);
  }
} finally {
  await client.end();
}
