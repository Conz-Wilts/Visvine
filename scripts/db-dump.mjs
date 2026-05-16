#!/usr/bin/env node
/**
 * Dumps the local Docker Postgres to a versioned .dump file under
 * tmp/fixtures/. Refuses to run if .env points at anything non-local.
 *
 * Filename: seed-mig<MIGTS>-<WALLCLOCK>.dump
 *   MIGTS    = first 8 chars of the newest folder in apps/web/prisma/migrations/
 *   WALLCLOCK = UTC YYYYMMDD-HHmm
 *
 * Prints the absolute output path on stdout's last line so wrappers like
 * db-publish.mjs can parse it.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
loadDotenv(join(REPO_ROOT, "apps", "web", ".env"));

const guard = spawnSync("node", [join(__dirname, "guard-local-db.mjs")], { stdio: "inherit" });
if (guard.status !== 0) process.exit(guard.status ?? 1);

const insp = spawnSync(
  "docker",
  ["inspect", "--format={{.State.Running}}", "visvine-postgres"],
  { encoding: "utf8" },
);
if (insp.status !== 0 || insp.stdout.trim() !== "true") {
  console.error("db-dump: visvine-postgres container is not running. Run `pnpm db:up` first.");
  process.exit(1);
}

const migDir = join(REPO_ROOT, "apps", "web", "prisma", "migrations");
let migTs = "00000000";
if (existsSync(migDir)) {
  const entries = readdirSync(migDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{8,}/.test(e.name))
    .map((e) => e.name)
    .sort();
  if (entries.length) migTs = entries[entries.length - 1].slice(0, 8);
}

const wall = utcTimestamp();
const filename = `seed-mig${migTs}-${wall}.dump`;

const outDir = join(REPO_ROOT, "tmp", "fixtures");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, filename);

console.error(`db-dump: dumping to ${outPath}`);

const fd = openSync(outPath, "w");
const dump = spawnSync(
  "docker",
  [
    "exec", "-i", "visvine-postgres",
    "pg_dump", "-U", "postgres", "-d", "visvine",
    "--format=custom", "--no-owner", "--no-privileges",
  ],
  { stdio: ["ignore", fd, "inherit"] },
);
closeSync(fd);

if (dump.status !== 0) {
  console.error(`db-dump: pg_dump failed (exit ${dump.status})`);
  process.exit(dump.status ?? 1);
}

const sizeMb = (statSync(outPath).size / 1024 / 1024).toFixed(2);
console.error(`db-dump: ok — ${sizeMb} MB`);
process.stdout.write(outPath + "\n");

function utcTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
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
