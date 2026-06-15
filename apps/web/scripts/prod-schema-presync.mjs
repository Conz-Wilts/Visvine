// Pre-`prisma db push` schema fixups for prod (run in CI before the push).
//
// `prisma db push` converges the live DB to schema.prisma, but it CANNOT do a
// couple of things on a populated table:
//
//   1. Add a NOT NULL column that has no default (it would fail with "column
//      contains null values"). The schema's `links.pair_key` is exactly this.
//   2. Create a UNIQUE index when duplicate rows already exist
//      (links @@unique([community_id, pair_key, relationship])).
//
// So this script does the minimum, idempotent prep that lets the subsequent
// `db push` succeed: it backfills `pair_key` (LEAST|GREATEST of the endpoints —
// identical to the migration + lib/graph upsertLink) and removes any duplicate
// links that would violate the unique index, keeping the earliest row.
//
// It is additive/idempotent: safe to run on every deploy. When a future schema
// change adds another NOT-NULL-without-default column on a populated table, add
// its backfill here.
//
// Usage (CI, behind the Cloud SQL proxy with DATABASE_URL pointed at it):
//   DATABASE_URL="$DB_URL" node scripts/prod-schema-presync.mjs
import 'dotenv/config';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL ?? process.env.DIRECT_DATABASE_URL;
if (!connectionString) throw new Error('prod-schema-presync: no DATABASE_URL resolved');

try {
  const u = new URL(connectionString);
  console.log(`prod-schema-presync: target host=${u.hostname}:${u.port || '(default)'} db=${u.pathname.slice(1) || '(unknown)'}`);
} catch {
  console.log('prod-schema-presync: target = (unparseable url)');
}

const pool = new pg.Pool({ connectionString });
const client = await pool.connect();
try {
  // Nothing to do if the links table doesn't exist yet (fresh DB — db push will
  // create it cleanly).
  const hasLinks = (await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'links' LIMIT 1`,
  )).rowCount > 0;
  if (!hasLinks) {
    console.log('  links table absent — nothing to presync.');
    process.exit(0);
  }

  await client.query('BEGIN');

  // 1. pair_key: add nullable (if missing) + backfill, so db push can SET NOT NULL.
  await client.query(`ALTER TABLE links ADD COLUMN IF NOT EXISTS pair_key TEXT`);
  const bf = await client.query(
    `UPDATE links
        SET pair_key = LEAST(source_id, target_id) || '|' || GREATEST(source_id, target_id)
      WHERE pair_key IS NULL`,
  );
  console.log(`  ✓ pair_key backfilled (${bf.rowCount} row(s))`);

  // 2. Dedup so the unique (community_id, pair_key, relationship) index can build.
  //    Keep the earliest row per group (oldest created_at, then id).
  const dedup = await client.query(
    `DELETE FROM links l
       USING (
         SELECT id,
                ROW_NUMBER() OVER (
                  PARTITION BY community_id, pair_key, relationship
                  ORDER BY created_at ASC, id ASC
                ) AS rn
           FROM links
       ) d
      WHERE l.id = d.id AND d.rn > 1`,
  );
  console.log(`  ✓ removed ${dedup.rowCount} duplicate link(s)`);

  await client.query('COMMIT');
  console.log('=== presync committed ===');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('prod-schema-presync ROLLED BACK:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
