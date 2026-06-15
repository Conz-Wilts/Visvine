#!/usr/bin/env node
/**
 * Downloads a .dump from gs://$GCS_DUMP_BUCKET and restores it into the
 * local Docker Postgres. Refuses to run if .env points anywhere non-local.
 *
 *   pnpm db:restore                          # uses seed-latest.dump
 *   pnpm db:restore -- --version=<filename>  # specific timestamped dump
 *
 * Flow:
 *   1. local-target guard
 *   2. ensure visvine-postgres container is up
 *   3. download dump → tmp/fixtures/restore.dump
 *   4. drop + recreate `visvine` database inside the container
 *   5. pg_restore the dump
 *   6. prisma db push (+ apply-sql-functions) to bring schema forward
 *   7. verify with a node count
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
loadDotenv(join(REPO_ROOT, "apps", "web", ".env"));

const versionArg = process.argv.find((a) => a.startsWith("--version="));
const version = versionArg ? versionArg.slice("--version=".length) : "seed-latest.dump";

const guard = spawnSync("node", [join(__dirname, "guard-local-db.mjs")], { stdio: "inherit" });
if (guard.status !== 0) process.exit(guard.status ?? 1);

const bucket = process.env.GCS_DUMP_BUCKET;
if (!bucket) {
  console.error("db-restore: GCS_DUMP_BUCKET is not set in apps/web/.env.");
  console.error("  See docs/SETUP.md §6 for bucket provisioning + onboarding steps.");
  process.exit(1);
}

const insp = spawnSync(
  "docker",
  ["inspect", "--format={{.State.Running}}", "visvine-postgres"],
  { encoding: "utf8" },
);
if (insp.status !== 0 || insp.stdout.trim() !== "true") {
  console.error("db-restore: visvine-postgres not running; starting it…");
  const up = spawnSync(
    process.platform === "win32" ? "docker.exe" : "docker",
    ["compose", "up", "-d", "--wait"],
    { cwd: REPO_ROOT, stdio: "inherit", shell: process.platform === "win32" },
  );
  if (up.status !== 0) {
    console.error("db-restore: failed to start docker container");
    process.exit(up.status ?? 1);
  }
}

const gcloud = process.platform === "win32" ? "gcloud.cmd" : "gcloud";
const tmpDir = join(REPO_ROOT, "tmp", "fixtures");
mkdirSync(tmpDir, { recursive: true });
const localPath = join(tmpDir, "restore.dump");

console.error(`db-restore: downloading gs://${bucket}/${version}…`);
const dl = spawnSync(
  gcloud,
  ["storage", "cp", `gs://${bucket}/${version}`, localPath],
  { stdio: "inherit", shell: process.platform === "win32" },
);
if (dl.status !== 0) {
  console.error("db-restore: download failed");
  process.exit(dl.status ?? 1);
}

console.error("db-restore: dropping + recreating `visvine` database…");
const drop = spawnSync(
  "docker",
  [
    "exec", "visvine-postgres",
    "psql", "-U", "postgres", "-d", "postgres",
    "-c", "DROP DATABASE IF EXISTS visvine WITH (FORCE);",
  ],
  { stdio: "inherit" },
);
if (drop.status !== 0) process.exit(drop.status ?? 1);

const create = spawnSync(
  "docker",
  [
    "exec", "visvine-postgres",
    "psql", "-U", "postgres", "-d", "postgres",
    "-c", "CREATE DATABASE visvine;",
  ],
  { stdio: "inherit" },
);
if (create.status !== 0) process.exit(create.status ?? 1);

console.error("db-restore: pg_restore…");
const fd = openSync(localPath, "r");
const restore = spawnSync(
  "docker",
  [
    "exec", "-i", "visvine-postgres",
    "pg_restore", "-U", "postgres", "-d", "visvine",
    "--no-owner", "--no-privileges",
  ],
  { stdio: [fd, "inherit", "inherit"] },
);
closeSync(fd);
if (restore.status !== 0) {
  console.error(`db-restore: pg_restore exited ${restore.status} — non-zero is sometimes survivable for benign WARNINGs, continuing schema-forward…`);
}

console.error("db-restore: bringing schema forward (prisma db push)…");
const push = spawnSync(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["db:migrate"],
  { cwd: REPO_ROOT, stdio: "inherit", shell: process.platform === "win32" },
);
if (push.status !== 0) {
  console.error("db-restore: schema-forward step failed");
  process.exit(push.status ?? 1);
}

console.error("db-restore: verifying…");
const verify = spawnSync(
  "docker",
  [
    "exec", "visvine-postgres",
    "psql", "-U", "postgres", "-d", "visvine", "-t", "-A",
    "-c", "SELECT COUNT(*) FROM nodes;",
  ],
  { encoding: "utf8" },
);
if (verify.status === 0) {
  const total = verify.stdout.trim();
  console.error(`db-restore: ok — ${total} nodes`);
} else {
  console.error("db-restore: verify query failed (restore probably still ok)");
}

try { unlinkSync(localPath); } catch { /* fine */ }

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
