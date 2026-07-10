// One-time migration for the personal-brain restructure: per-community personal
// brains (owner_key = <userId>) are gone — a user's personal context now lives
// in the shared brain of their personal-space community (`me:<userId>`).
//
// For every community_notes row with owner_key != 'shared':
//   • already in the owner's personal community  → owner_key flips to 'shared'
//   • in a normal community                      → moved to `me:<userId>` under
//     `imported/<community-slug>/<path>` (trash rows keep deleted_path likewise)
// Personal communities are created (community + admin membership) when the user
// never finished onboarding. Explicit folder rows move the same way; stale
// personal-brain sidecar files and cached embeddings are deleted (ledgers are
// path-keyed and embeddings re-embed lazily).
//
//   node apps/web/scripts/migrate-personal-brains.mjs          (dry run)
//   node apps/web/scripts/migrate-personal-brains.mjs --apply
//
// Local-guarded like every destructive db:* script. Idempotent — a second run
// finds nothing to do.
import '../../../scripts/guard-local-db.mjs';
import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');

const connectionString =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'community';

async function ensurePersonalCommunity(userId) {
  const communityId = `me:${userId}`;
  const existing = await client.query('SELECT id FROM communities WHERE id = $1', [communityId]);
  if (existing.rowCount === 0) {
    const user = await client.query('SELECT name FROM users WHERE id = $1', [userId]);
    const name = user.rows[0]?.name ?? 'Personal space';
    if (APPLY) {
      await client.query(
        `INSERT INTO communities (id, name, description, personal_owner_id, data_file, member_count)
         VALUES ($1, $2, 'Your personal space', $3, $4, 1) ON CONFLICT (id) DO NOTHING`,
        [communityId, name, userId, `${communityId}.json`],
      );
      await client.query(
        `INSERT INTO user_communities (user_id, community_id, role)
         VALUES ($1, $2, 'admin') ON CONFLICT (user_id, community_id) DO NOTHING`,
        [userId, communityId],
      );
    }
    console.log(`  + personal community ${communityId} (${name})${APPLY ? '' : ' [dry]'}`);
  }
  return communityId;
}

async function freePath(communityId, desired) {
  let candidate = desired;
  let n = 1;
  for (;;) {
    const hit = await client.query(
      `SELECT id FROM community_notes WHERE community_id = $1 AND owner_key = 'shared' AND path = $2`,
      [communityId, candidate],
    );
    if (hit.rowCount === 0) return candidate;
    candidate = desired.replace(/\.md$/i, '') + `-${n++}.md`;
  }
}

const notes = await client.query(
  `SELECT id, community_id, owner_key, path, deleted_at, deleted_path
   FROM community_notes WHERE owner_key <> 'shared' ORDER BY community_id, owner_key`,
);
console.log(`${notes.rowCount} personal-brain notes to migrate${APPLY ? '' : ' (dry run — pass --apply)'}`);

const communityNames = new Map(
  (await client.query('SELECT id, name FROM communities')).rows.map((r) => [r.id, r.name]),
);

for (const row of notes.rows) {
  const userId = row.owner_key;
  const target = await ensurePersonalCommunity(userId);
  const inOwnSpace = row.community_id === target;
  const prefix = inOwnSpace ? '' : `imported/${slug(communityNames.get(row.community_id) ?? row.community_id)}/`;

  const isTrashed = row.deleted_at !== null;
  const livePath = isTrashed ? row.deleted_path ?? row.path : row.path;
  const desired = prefix + livePath;

  if (isTrashed) {
    // Trash rows keep their `:trash:<id>` path sentinel; only deleted_path moves.
    if (APPLY) {
      await client.query(
        `UPDATE community_notes SET community_id = $1, owner_key = 'shared', deleted_path = $2 WHERE id = $3`,
        [target, desired, row.id],
      );
    }
    console.log(`  trash ${row.community_id}:${livePath} → ${target}:${desired}`);
  } else {
    const dest = await freePath(target, desired);
    if (APPLY) {
      await client.query(
        `UPDATE community_notes SET community_id = $1, owner_key = 'shared', path = $2 WHERE id = $3`,
        [target, dest, row.id],
      );
    }
    console.log(`  note  ${row.community_id}:${row.path} → ${target}:${dest}`);
  }
}

const folders = await client.query(
  `SELECT id, community_id, owner_key, path FROM community_note_folders WHERE owner_key <> 'shared'`,
);
for (const row of folders.rows) {
  const userId = row.owner_key;
  const target = await ensurePersonalCommunity(userId);
  const inOwnSpace = row.community_id === target;
  const dest = (inOwnSpace ? '' : `imported/${slug(communityNames.get(row.community_id) ?? row.community_id)}/`) + row.path;
  if (APPLY) {
    // A duplicate folder row at the destination just means this one is redundant.
    const dup = await client.query(
      `SELECT id FROM community_note_folders WHERE community_id = $1 AND owner_key = 'shared' AND path = $2`,
      [target, dest],
    );
    if (dup.rowCount > 0) {
      await client.query('DELETE FROM community_note_folders WHERE id = $1', [row.id]);
    } else {
      await client.query(
        `UPDATE community_note_folders SET community_id = $1, owner_key = 'shared', path = $2 WHERE id = $3`,
        [target, dest, row.id],
      );
    }
  }
  console.log(`  folder ${row.community_id}:${row.path} → ${target}:${dest}`);
}

if (APPLY) {
  const sidecars = await client.query(`DELETE FROM community_brain_files WHERE owner_key <> 'shared'`);
  const embeddings = await client.query(`DELETE FROM community_note_embeddings WHERE owner_key <> 'shared'`);
  console.log(`cleaned ${sidecars.rowCount} personal sidecar files, ${embeddings.rowCount} cached embeddings`);
}

console.log(APPLY ? 'done.' : 'dry run complete — re-run with --apply to write.');
await client.end();
