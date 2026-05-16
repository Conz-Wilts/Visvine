/**
 * CLI wrapper around lib/ai/embeddings.ts.
 *
 * Reads apps/web/.env (via dotenv), constructs a PrismaClient with the
 * PrismaPg adapter against the local Docker Postgres, and runs embedNodes
 * for every node with NULL embedding. Pass --force to re-embed everything.
 *
 * Refuses to run against anything non-local (same guard as seed.ts).
 *
 * Maintainer flow:
 *   1. Uncomment OPENAI_API_KEY in apps/web/.env
 *   2. pnpm db:fresh         (reseed without embeddings)
 *   3. pnpm embed:backfill   (this script)
 *   4. pnpm db:publish       (dump + upload — see scripts/db-publish.mjs)
 */

import "dotenv/config";
import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { embedNodes } from "../lib/ai/embeddings";

function assertLocalTarget() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("embed-backfill: refusing to run with NODE_ENV=production");
  }
  if (process.env.CLOUD_SQL_CONNECTION_NAME) {
    throw new Error(
      "embed-backfill: CLOUD_SQL_CONNECTION_NAME is set — env looks pointed at prod via Cloud SQL Auth Proxy",
    );
  }
  const url =
    process.env.DIRECT_DATABASE_URL ||
    process.env.DATABASE_URL ||
    (process.env.DB_HOST ? `postgresql://x:x@${process.env.DB_HOST}/${process.env.DB_NAME ?? ""}` : null);
  if (!url) throw new Error("embed-backfill: no DATABASE_URL resolved");
  const host = new URL(url).hostname;
  const LOCAL = new Set(["127.0.0.1", "localhost", "::1", "postgres", "visvine-postgres"]);
  if (!LOCAL.has(host)) {
    throw new Error(`embed-backfill: refusing — DATABASE_URL host "${host}" is not local`);
  }
}

assertLocalTarget();

if (!process.env.OPENAI_API_KEY) {
  console.error("embed-backfill: OPENAI_API_KEY is not set.");
  console.error("  Set it in apps/web/.env (uncomment the OPENAI_API_KEY line) and re-run.");
  process.exit(1);
}

const connectionString =
  process.env.DIRECT_DATABASE_URL ||
  process.env.DATABASE_URL ||
  (process.env.DB_HOST
    ? `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD ?? "")}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`
    : null);

if (!connectionString) throw new Error("embed-backfill: no DATABASE_URL resolved");

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const force = process.argv.includes("--force");

console.log(
  `embed-backfill: ${force ? "re-embedding ALL nodes (force)" : "embedding nodes with NULL embedding"}`,
);

embedNodes(prisma, openai, {
  force,
  onProgress: (done, total) => {
    process.stdout.write(`\r  ${done}/${total}`);
  },
})
  .then(({ processed, total, errors }) => {
    process.stdout.write("\n");
    if (total === 0) {
      console.log("embed-backfill: all nodes already have embeddings");
    } else {
      console.log(`embed-backfill: embedded ${processed} / ${total} nodes`);
    }
    if (errors.length > 0) {
      console.error(`embed-backfill: ${errors.length} error(s):`);
      for (const err of errors) console.error(`  ${err}`);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error("embed-backfill: failed", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
