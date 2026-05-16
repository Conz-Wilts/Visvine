#!/usr/bin/env node
/**
 * Runs db-dump.mjs, then uploads the resulting .dump file to the GCS bucket
 * named by $GCS_DUMP_BUCKET. Also copies the upload to seed-latest.dump in
 * the same bucket (the "always-current" pointer that db-restore.mjs reads
 * by default).
 *
 * Uses `gcloud storage cp` (not the SDK) so no extra npm deps. Requires
 * `gcloud auth application-default login` to have been run on this machine.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
loadDotenv(join(REPO_ROOT, "apps", "web", ".env"));

const bucket = process.env.GCS_DUMP_BUCKET;
if (!bucket) {
  console.error("db-publish: GCS_DUMP_BUCKET is not set in apps/web/.env.");
  console.error("  See SETUP.md §7 for bucket provisioning.");
  process.exit(1);
}

const gcloud = process.platform === "win32" ? "gcloud.cmd" : "gcloud";

const authCheck = spawnSync(gcloud, ["auth", "application-default", "print-access-token"], {
  encoding: "utf8",
  shell: process.platform === "win32",
});
if (authCheck.status !== 0) {
  console.error("db-publish: gcloud ADC is not configured.");
  console.error("  Run `gcloud auth application-default login` and try again.");
  process.exit(1);
}

console.error("db-publish: producing fresh dump…");
const dump = spawnSync("node", [join(__dirname, "db-dump.mjs")], { encoding: "utf8" });
process.stderr.write(dump.stderr || "");
if (dump.status !== 0) {
  console.error("db-publish: db-dump failed");
  process.exit(dump.status ?? 1);
}
const lines = dump.stdout.trim().split(/\r?\n/);
const localPath = lines[lines.length - 1];
if (!localPath || !existsSync(localPath)) {
  console.error(`db-publish: could not parse dump path from db-dump output: ${dump.stdout}`);
  process.exit(1);
}

const filename = basename(localPath);
const sizeMb = (statSync(localPath).size / 1024 / 1024).toFixed(2);
console.error(`db-publish: uploading ${sizeMb} MB to gs://${bucket}/${filename}…`);

const upload = spawnSync(
  gcloud,
  ["storage", "cp", localPath, `gs://${bucket}/${filename}`],
  { stdio: "inherit", shell: process.platform === "win32" },
);
if (upload.status !== 0) {
  console.error("db-publish: upload failed");
  process.exit(upload.status ?? 1);
}

console.error(`db-publish: copying to gs://${bucket}/seed-latest.dump…`);
const copy = spawnSync(
  gcloud,
  ["storage", "cp", `gs://${bucket}/${filename}`, `gs://${bucket}/seed-latest.dump`],
  { stdio: "inherit", shell: process.platform === "win32" },
);
if (copy.status !== 0) {
  console.error("db-publish: latest-pointer copy failed");
  process.exit(copy.status ?? 1);
}

console.error("db-publish: ok");
console.error(`  versioned: gs://${bucket}/${filename}`);
console.error(`  latest:    gs://${bucket}/seed-latest.dump`);

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
