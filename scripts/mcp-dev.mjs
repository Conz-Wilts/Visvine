#!/usr/bin/env node
/**
 * `pnpm mcp:dev` — the dev server, framed as "the MCP servers are up".
 *
 * Identical to `pnpm dev` (Postgres is already up by the time this runs, via
 * the script chain) plus a banner naming the two endpoints and who they answer
 * as. Locally there is no token and no OAuth: a request with no Authorization
 * header is the seeded dev user (apps/web/lib/mcp/devIdentity.ts), which only
 * holds while ENABLE_DEV_AUTH is true — so the banner reports the user it will
 * act as, and says plainly when the flag is off or the database is unseeded,
 * rather than implying a setup that works.
 *
 * Prints, then runs `next dev` as a child so Ctrl-C behaves as it always did.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Same minimal .env reader the other root scripts use — apps/web/.env is where
// ENABLE_DEV_AUTH and the database URL live, and Next loads it for itself.
function loadDotenv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}
loadDotenv(join(ROOT, "apps", "web", ".env"));

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/** The users /dev/login will list — the picker's contents, checked up front. */
async function seededDevUsers() {
  // Same precedence as apps/web/lib/prisma.ts and scripts/db-check.mjs.
  const url =
    process.env.DIRECT_DATABASE_URL ||
    process.env.DATABASE_URL ||
    (process.env.DB_HOST
      ? `postgresql://${process.env.DB_USER}:${encodeURIComponent(
          process.env.DB_PASSWORD ?? "",
        )}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`
      : null);
  if (!url) return null;
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    const { rows } = await client.query(
      `select id, name, email from users where email like '%@local.dev' order by email asc`,
    );
    return rows;
  } catch {
    return null; // Not this script's job to diagnose the database; `pnpm db:check` is.
  } finally {
    await client.end().catch(() => {});
  }
}

const users = await seededDevUsers();
const devAuth = process.env.ENABLE_DEV_AUTH === "true";

// `pnpm mcp:dev --user member` — the only choice there is to make locally, so
// it is a flag rather than something to go and edit .env for. A bare word is
// taken as `<word>@local.dev`; a full email or a user id works too. Without it,
// DEV_MCP_USER from the environment, then the seeded admin.
function userFlag() {
  const i = process.argv.indexOf("--user");
  const raw = i === -1 ? undefined : process.argv[i + 1];
  if (!raw) return undefined;
  return raw.includes("@") || raw.startsWith("user_") ? raw : `${raw}@local.dev`;
}
const chosen = userFlag();
if (chosen) process.env.DEV_MCP_USER = chosen;

const wanted = process.env.DEV_MCP_USER?.trim() || "admin@local.dev";
const matched = users?.find((u) => u.email === wanted || u.id === wanted);
const actingAs = matched ?? users?.[0];

const lines = [
  "",
  "  Visvine MCP — local, no auth",
  "",
  `    visvine-dev        ${APP_URL}/api/mcp`,
  `    visvine-tools-dev  ${APP_URL}/api/mcp/tools`,
  "",
  "  Both are in the committed .mcp.json. No token, no sign-in: just connect",
  "  (in Claude Code: /mcp → visvine-dev → Connect) and every tool is available.",
  "",
];

if (!devAuth) {
  lines.push(
    "  ENABLE_DEV_AUTH is not true, so this is OFF — requests will get a 401 and",
    "  demand a real OAuth token. Set ENABLE_DEV_AUTH=true in apps/web/.env.",
    "",
  );
} else if (users === null) {
  lines.push("  (Could not read the seeded users — try `pnpm db:check`.)", "");
} else if (!actingAs) {
  lines.push("  No @local.dev users yet — run `pnpm db:seed`, or requests get a 401.", "");
} else {
  // Say so when the requested user isn't there, rather than acting as somebody
  // else under a banner that looks like it did what was asked.
  if (!matched) {
    lines.push(`  No user matching "${wanted}" — falling back to:`);
  }
  lines.push(`  Acting as ${actingAs.name} · ${actingAs.email}`);
  const others = users.filter((u) => u.email !== actingAs.email);
  if (others.length) {
    const one = others[0].email.split("@")[0];
    lines.push(
      `  Also seeded: ${others.map((u) => u.email).join(", ")}`,
      `  Switch with \`pnpm mcp:dev --user ${one}\` (or DEV_MCP_USER in apps/web/.env)`,
    );
  }
  lines.push("");
}

console.log(lines.join("\n"));

const child = spawn("pnpm", ["--filter", "@visvine/web", "dev"], {
  cwd: ROOT,
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
