#!/usr/bin/env node
/**
 * Fills the production values in apps/web/.env from GCP Secret Manager.
 *
 *   pnpm env:pull:prod
 *   pnpm env:pull:prod --dry-run     print what would change, write nothing
 *
 * Requires `gcloud auth login` with access to the project's secrets. Values are
 * written in place — existing lines are replaced, comments and ordering are
 * preserved, and nothing is ever printed to stdout in full.
 *
 * Secrets never leave this machine: .env is gitignored and re-chmod'd to 0600.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = resolve(ROOT, "apps/web/.env");
const DRY_RUN = process.argv.includes("--dry-run");

const PROJECT = "visvine-platform";

/**
 * envKey → { secret, optional?, transform? }
 *
 * `optional` secrets that don't exist yet are reported and skipped rather than
 * failing the run.
 */
const MAPPING = {
  GOOGLE_CLIENT_ID: { secret: "GOOGLE_CLIENT_ID" },
  GOOGLE_CLIENT_SECRET: { secret: "GOOGLE_CLIENT_SECRET" },
  GCS_MEDIA_BUCKET: { secret: "GCS_MEDIA_BUCKET" },
  GCS_RESOURCES_BUCKET: { secret: "GCS_RESOURCES_BUCKET" },
  PROD_AUTH_SECRET: { secret: "AUTH_SECRET" },
  PROD_SUPER_ADMIN_EMAILS: { secret: "SUPER_ADMIN_EMAILS" },
  PROD_DATABASE_URL: { secret: "DATABASE_URL", transform: viaProxy },
  // Not provisioned yet — see the note in .env. Once it exists in Secret
  // Manager (and on the Cloud Run service) this starts resolving.
  PROD_SECRETS_KEY: { secret: "SECRETS_KEY", optional: true },
};

/**
 * Rewrite a Cloud SQL connection string to go through the local Auth Proxy.
 *
 * The deployed value may use either the Cloud Run unix socket form
 * (`?host=/cloudsql/project:region:instance`) or a direct host. Both are
 * normalised to 127.0.0.1:$PROXY_PORT, keeping only user/password/database.
 */
function viaProxy(raw, { proxyPort }) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      "DATABASE_URL secret is not a parseable URL — cannot rewrite for the proxy"
    );
  }
  const db = url.pathname.replace(/^\//, "") || "visvine";
  const auth = url.password
    ? `${url.username}:${url.password}@`
    : url.username
      ? `${url.username}@`
      : "";
  return `postgresql://${auth}127.0.0.1:${proxyPort}/${db}`;
}

function readSecret(name) {
  return execFileSync(
    "gcloud",
    [
      "secrets",
      "versions",
      "access",
      "latest",
      `--secret=${name}`,
      `--project=${PROJECT}`,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // gcloud is a .cmd shim on Windows, which Node refuses to spawn
      // without a shell.
      shell: process.platform === "win32",
    }
  ).replace(/\r?\n$/, "");
}

/** Replace `KEY=…` in place, whether the existing line is set, empty, or commented. */
function upsert(lines, key, value) {
  const setRe = new RegExp(`^\\s*#?\\s*${key}\\s*=`);
  const idx = lines.findIndex((l) => setRe.test(l));
  const line = `${key}=${value}`;
  if (idx === -1) {
    lines.push(line);
    return "appended";
  }
  const changed = lines[idx] !== line;
  lines[idx] = line;
  return changed ? "updated" : "unchanged";
}

function main() {
  let original;
  try {
    original = readFileSync(ENV_PATH, "utf8");
  } catch {
    console.error(
      `env-pull-prod: ${ENV_PATH} not found — copy apps/web/.env.example first.`
    );
    process.exit(1);
  }

  const lines = original.split("\n");
  const proxyPort =
    /^\s*PROXY_PORT\s*=\s*(\d+)/m.exec(original)?.[1] ?? "5433";

  const skipped = [];
  for (const [envKey, spec] of Object.entries(MAPPING)) {
    let raw;
    try {
      raw = readSecret(spec.secret);
    } catch (err) {
      if (spec.optional) {
        skipped.push(spec.secret);
        continue;
      }
      console.error(
        `env-pull-prod: could not read secret ${spec.secret} — ${String(
          err.stderr || err.message
        ).trim()}`
      );
      process.exit(1);
    }
    const value = spec.transform ? spec.transform(raw, { proxyPort }) : raw;
    const action = upsert(lines, envKey, value);
    console.log(`  ${envKey.padEnd(24)} ${action} (${value.length} chars)`);
  }

  for (const name of skipped) {
    console.log(`  ${name.padEnd(24)} SKIPPED — no such secret in ${PROJECT}`);
  }

  const next = lines.join("\n");
  if (DRY_RUN) {
    console.log("\nenv-pull-prod: --dry-run, nothing written.");
    return;
  }
  if (next === original) {
    console.log("\nenv-pull-prod: already up to date.");
    return;
  }
  writeFileSync(ENV_PATH, next, "utf8");
  chmodSync(ENV_PATH, 0o600);
  console.log(`\nenv-pull-prod: wrote ${ENV_PATH} (mode 600).`);
  console.log("Run `pnpm dev:cloud` to start against Cloud SQL.");
}

main();
