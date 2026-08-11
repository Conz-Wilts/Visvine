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
// It also settles pre-existing duplicate PUBLIC space names, which would block
// the (hand-written, post-push) communities_public_name_unique index the same
// way — see lib/communities/publicName.ts.
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
  const tableExists = async (name) =>
    (await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = $1 LIMIT 1`,
      [name],
    )).rowCount > 0;

  await client.query('BEGIN');

  // Nothing to do if the links table doesn't exist yet (fresh DB — db push will
  // create it cleanly).
  if (!(await tableExists('links'))) {
    console.log('  links table absent — skipping link fixups.');
  } else {
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
  }

  // 3. Public space names are unique from now on (lib/communities/publicName.ts,
  //    backed by the communities_public_name_unique partial index that
  //    apply-sql-functions.mjs creates after the push). Rows that predate the
  //    rule can still collide and would stop that index building, so settle them
  //    here: oldest keeps the name, the rest get " (2)", " (3)"… — the same
  //    keep-the-earliest treatment as the link dedup, but a rename rather than a
  //    delete, since a whole space must never be thrown away over its name.
  if (await tableExists('communities')) {
    let resolved = 0;
    // Looped: a rename to "X (2)" can land on an existing "X (2)". Each pass
    // strictly reduces the collisions, so a handful of passes always settles it.
    for (let pass = 0; pass < 5; pass++) {
      const renamed = await client.query(
        `UPDATE communities c
            SET name = c.name || ' (' || d.rn || ')'
           FROM (
             SELECT id,
                    ROW_NUMBER() OVER (
                      PARTITION BY lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))
                      ORDER BY created_at ASC, id ASC
                    ) AS rn
               FROM communities
              WHERE visibility = 'public' AND personal_owner_id IS NULL
           ) d
          WHERE c.id = d.id AND d.rn > 1
        RETURNING c.id, c.name`,
      );
      if (renamed.rowCount === 0) break;
      resolved += renamed.rowCount;
      for (const row of renamed.rows) console.log(`    renamed public space ${row.id} → "${row.name}"`);
    }
    console.log(`  ✓ resolved ${resolved} duplicate public space name(s)`);
  }

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
