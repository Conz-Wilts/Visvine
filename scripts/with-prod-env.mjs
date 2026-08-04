#!/usr/bin/env node
/**
 * Runs a command with apps/web/.env's PROD_* values promoted over their base
 * names, so the app talks to Cloud SQL and production Google Cloud resources
 * without anyone hand-editing the env file.
 *
 *   node scripts/with-prod-env.mjs pnpm --filter @visvine/web dev
 *
 * Promotions:  PROD_DATABASE_URL → DATABASE_URL,  PROD_AUTH_SECRET → AUTH_SECRET, …
 * Forced off:  ENABLE_DEV_AUTH, CONNECTORS_ALLOW_PRIVATE_HOSTS
 *              (the /dev/login bypass and the SSRF loopback allowance must
 *               never be live while pointed at production data)
 *
 * An empty PROD_* value is left alone — the dev value stays in force and is
 * reported, so a half-pulled env is obvious rather than silent.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = resolve(ROOT, "apps/web/.env");

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("with-prod-env: no command given");
  process.exit(1);
}

let raw;
try {
  raw = readFileSync(ENV_PATH, "utf8");
} catch {
  console.error(`with-prod-env: ${ENV_PATH} not found — copy .env.example first.`);
  process.exit(1);
}

/** Minimal dotenv parse: KEY=value, ignoring comments and blank lines. */
const parsed = {};
for (const line of raw.split("\n")) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m) continue;
  parsed[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, "$1");
}

const env = { ...process.env, ...parsed };

const missing = [];
for (const [key, value] of Object.entries(parsed)) {
  if (!key.startsWith("PROD_")) continue;
  const base = key.slice("PROD_".length);
  if (value) env[base] = value;
  else missing.push(key);
}

env.ENABLE_DEV_AUTH = "false";
env.CONNECTORS_ALLOW_PRIVATE_HOSTS = "false";

if (!parsed.PROD_DATABASE_URL) {
  console.error(
    "with-prod-env: PROD_DATABASE_URL is empty — refusing to start, since the\n" +
      "               local Docker DATABASE_URL would be used instead.\n" +
      "               Run `pnpm env:pull:prod` first."
  );
  process.exit(1);
}

console.log("with-prod-env: pointing at Cloud SQL, dev auth disabled.");
if (missing.length) {
  console.log(
    `with-prod-env: still empty, keeping dev values → ${missing.join(", ")}`
  );
}

const child = spawn(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
