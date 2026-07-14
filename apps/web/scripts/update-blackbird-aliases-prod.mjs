// =============================================================================
// update-blackbird-aliases-prod.mjs   (one-off, safe to delete after running)
//
// Surgically refreshes ONLY `community_aliases` on the prod Blackbird Ventures
// community — adds the LP / Investor / Employee person aliases alongside the
// existing Founder + Portfolio Company. Non-destructive: touches nothing else.
//
// Credential handling: this script NEVER reads gcloud or prints a password. It
// reads the prod connection string from the PROD_DATABASE_URL env var (which
// you populate from Secret Manager in your own shell) and rewrites it to the
// TCP proxy form (127.0.0.1:<PROXY_PORT>, default 5433). Only the target
// host:port/db is logged.
//
// Prereq: Cloud SQL Auth Proxy running and forwarding to
//   visvine-platform:australia-southeast1:visvine-pgdata on 127.0.0.1:5433.
//
// Usage (PowerShell, run by you so the credential stays in your session):
//   $env:PROD_DATABASE_URL = (gcloud secrets versions access latest `
//     --secret=DATABASE_URL --project=visvine-platform)
//   $env:CONFIRM_PROD_SEED = 'blackbird'
//   node apps/web/scripts/update-blackbird-aliases-prod.mjs
// =============================================================================

import pg from 'pg';

// Keep this array byte-for-byte in sync with COMMUNITY_ALIASES in
// scripts/seed-blackbird-prod.mjs and scripts/add-blackbird-ventures.mjs.
const COMMUNITY_ALIASES = [
  { name: 'Portfolio Company', color: '#0891b2', nodeType: 'Group' },
  { name: 'Founder', color: '#16a34a', nodeType: 'Person' },
  { name: 'LP', color: '#d97706', nodeType: 'Person' },
  { name: 'Investor', color: '#0ea5e9', nodeType: 'Person' },
  { name: 'Employee', color: '#db2777', nodeType: 'Person' },
];

const COMM = 'community:blackbird-ventures';
const PROXY_PORT = process.env.PROXY_PORT ?? '5433';

// ---- prod safety gate (same convention as seed-blackbird-prod.mjs) ----------
const confirmed =
  process.env.CONFIRM_PROD_SEED === 'blackbird' || process.argv.includes('--yes');
if (!confirmed) {
  console.error(
    '\n  REFUSED: this targets PRODUCTION.\n' +
      '  Re-run with CONFIRM_PROD_SEED=blackbird (or pass --yes) once the proxy\n' +
      '  is up and PROD_DATABASE_URL points at the intended Cloud SQL instance.\n',
  );
  process.exit(1);
}

const rawUrl = process.env.PROD_DATABASE_URL;
if (!rawUrl) {
  console.error('  REFUSED: PROD_DATABASE_URL is not set.');
  process.exit(1);
}

// Rewrite the Secret Manager URL (socket form, ?host=/cloudsql/...) to the TCP
// proxy form. We keep only user/password/db and force 127.0.0.1:<PROXY_PORT>.
let connectionString;
try {
  const u = new URL(rawUrl.trim());
  const user = decodeURIComponent(u.username);
  const pass = decodeURIComponent(u.password);
  const db = (u.pathname && u.pathname !== '/' ? u.pathname.slice(1) : '') || 'visvine';
  connectionString =
    `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}` +
    `@127.0.0.1:${PROXY_PORT}/${db}`;
  console.log(`update-blackbird-aliases-prod: target host=127.0.0.1:${PROXY_PORT} db=${db} user=${user}`);
} catch (err) {
  console.error('  Could not parse PROD_DATABASE_URL as a URL:', String(err));
  process.exit(1);
}

const pool = new pg.Pool({ connectionString });

async function main() {
  const client = await pool.connect();
  try {
    const before = await client.query(
      'SELECT community_aliases FROM communities WHERE id = $1',
      [COMM],
    );
    if (before.rowCount === 0) {
      throw new Error(`community ${COMM} not found on the target DB — aborting.`);
    }
    console.log('  BEFORE:', JSON.stringify(before.rows[0].community_aliases));

    const res = await client.query(
      'UPDATE communities SET community_aliases = $2::jsonb WHERE id = $1',
      [COMM, JSON.stringify(COMMUNITY_ALIASES)],
    );

    const after = await client.query(
      'SELECT community_aliases FROM communities WHERE id = $1',
      [COMM],
    );
    console.log('  AFTER :', JSON.stringify(after.rows[0].community_aliases));
    console.log(`  ✓ updated ${res.rowCount} community row(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('  FAILED:', err);
  process.exit(1);
});
