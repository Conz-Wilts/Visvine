// One-time baseline for a database that predates `prisma migrate`. Runs ahead of
// every `migrate deploy` — in CI, in `db:migrate`, and in db-restore — because
// any of them can meet a database that was built by `db push`: prod itself, or
// a local restore of a dump taken before the switch.
//
// This project converged prod with `prisma db push` for its whole life, so the
// live database has no `_prisma_migrations` record. Handed that, `migrate
// deploy` would try to run 0_init — the entire schema as CREATE TABLE — against
// a database that already has all 37 tables, and fail.
//
// Baselining is the supported answer: tell Prisma "this database is already at
// 0_init, start tracking from here". It writes one row and changes no schema.
//
// It happens at most once. On every later deploy the record is non-empty and
// this exits immediately. There is no path here that touches a database already
// under migration control.
//
// The stamp is only written when the live schema genuinely matches
// schema.prisma, checked with `migrate diff`. Baselining a database that has
// drifted would record a state it is not in, and every later migration would
// build on that lie — so a mismatch fails the deploy instead, with the diff in
// the log.
//
// Usage (CI, behind the Cloud SQL proxy with DATABASE_URL pointed at it):
//   DATABASE_URL="$DB_URL" node scripts/baseline-migrations.mjs
import { execFileSync } from 'node:child_process';
import 'dotenv/config';
import pg from 'pg';

const BASELINE = '0_init';
const PRISMA = ['dlx', 'prisma@7.4.0'];

// The indexes apply-sql-functions.mjs creates. Prisma cannot express any of them
// in schema.prisma, so a diff against a database that has them always proposes
// dropping them. That is the one difference the baseline check tolerates —
// anything else means the live schema is genuinely not the one 0_init describes.
const HAND_WRITTEN_INDEXES = new Set([
  'context_note_embeddings_embedding_hnsw',
  'context_source_chunks_embedding_hnsw',
  'context_source_chunks_text_fts',
  'spaces_public_name_unique',
]);

// Every statement must be a DROP INDEX naming one of ours. A single statement
// that isn't fails the check.
const onlyHandWrittenIndexDrops = (script) => {
  const statements = script
    .split(';')
    .map((s) => s.replace(/--[^\n]*/g, '').trim())
    .filter(Boolean);
  if (statements.length === 0) return true;
  return statements.every((s) => {
    const m = /^DROP INDEX "?([^"\s]+)"?$/i.exec(s);
    return m !== null && HAND_WRITTEN_INDEXES.has(m[1]);
  });
};

const connectionString = process.env.DATABASE_URL ?? process.env.DIRECT_DATABASE_URL;
if (!connectionString) throw new Error('baseline-migrations: no DATABASE_URL resolved');

const pool = new pg.Pool({ connectionString });
const client = await pool.connect();
let action;
try {
  const applied = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = '_prisma_migrations'`,
  );
  if (applied.rows[0].n > 0) {
    const rows = await client.query(`SELECT count(*)::int AS n FROM _prisma_migrations`);
    if (rows.rows[0].n > 0) {
      console.log(`baseline-migrations: already tracked (${rows.rows[0].n} migration(s)) — nothing to do.`);
      action = 'none';
    }
  }

  if (action === undefined) {
    const tables = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
          AND table_name <> '_prisma_migrations'`,
    );
    // An empty database needs no baseline: `migrate deploy` builds it from
    // 0_init the ordinary way.
    action = tables.rows[0].n === 0 ? 'none' : 'baseline';
    if (action === 'none') console.log('baseline-migrations: empty database — 0_init will run normally.');
  }
} finally {
  client.release();
  await pool.end();
}

if (action === 'none') process.exit(0);

// Windows resolves the launcher as pnpm.cmd, which execFileSync does not find via
// PATHEXT — and since the CVE-2024-27980 fix Node refuses to spawn a .cmd without
// a shell (EINVAL). Both arguments are fixed strings, so there is nothing to quote.
const WIN = process.platform === 'win32';
const PNPM = WIN ? 'pnpm.cmd' : 'pnpm';

const run = (args, opts = {}) =>
  execFileSync(PNPM, [...PRISMA, ...args], {
    stdio: 'pipe',
    encoding: 'utf8',
    shell: WIN,
    ...opts,
  });

console.log(`baseline-migrations: untracked database — checking it matches schema.prisma before stamping ${BASELINE}.`);
// --from-config-datasource reads the live database through prisma.config.ts,
// which resolves the same DATABASE_URL this script connected with.
const script = run(['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--script'])
  .split('\n')
  .filter((line) => !line.startsWith('Loaded Prisma config'))
  .join('\n');

if (!onlyHandWrittenIndexDrops(script)) {
  console.error(script);
  throw new Error(
    'baseline-migrations: live schema does not match schema.prisma — refusing to stamp a state it is not in. ' +
      'Converge it first (the diff above is what differs), then re-run.',
  );
}

console.log(run(['migrate', 'resolve', '--applied', BASELINE]));
console.log(`baseline-migrations: stamped ${BASELINE}. Future deploys replay migrations normally.`);
