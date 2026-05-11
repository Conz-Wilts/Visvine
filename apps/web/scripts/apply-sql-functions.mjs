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

// Hand-written SQL to apply against the local DB AFTER `prisma db push`.
// Excludes storage_policies.sql (Supabase RLS, irrelevant locally) and
// complete_schema.sql (Prisma already creates those tables).
const files = ["create_match_nodes_function.sql"];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const f of files) {
    const path = join(__dirname, "..", "migrations", f);
    if (!existsSync(path)) {
      console.warn(`skip (not found): ${f}`);
      continue;
    }
    const sql = readFileSync(path, "utf8");
    await client.query(sql);
    console.log(`applied: ${f}`);
  }
} finally {
  await client.end();
}
