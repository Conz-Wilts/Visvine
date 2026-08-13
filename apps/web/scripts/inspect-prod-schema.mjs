// Read-only report on what a deploy would find in prod. Answers the questions
// that decide whether the rename pass in prod-schema-presync.mjs is safe to run:
// which vocabulary the live schema is speaking, whether the hand-written indexes
// are there under their old names, and how many rows the two destructive-looking
// repairs would actually touch.
//
// Every statement is a SELECT, inside a READ ONLY transaction. It cannot write
// even if something here is wrong.
//
// Usage (with the Cloud SQL proxy running on 127.0.0.1:5433):
//   node scripts/inspect-prod-schema.mjs "$PROD_DATABASE_URL"
import 'dotenv/config';
import pg from 'pg';

const connectionString =
  process.argv[2] ?? process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('inspect-prod-schema: pass a URL or set PROD_DATABASE_URL');

const u = new URL(connectionString);
console.log(`\ninspect-prod-schema: ${u.hostname}:${u.port || '(default)'} db=${u.pathname.slice(1)}\n`);

const client = new pg.Client({ connectionString });
await client.connect();
await client.query('BEGIN READ ONLY');

const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await client.query(sql, params)).rows;
const exists = async (name) => (await one(`SELECT to_regclass($1) AS o`, [`"${name}"`])).o !== null;

const section = (title) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);

try {
  section('vocabulary');
  const pairs = [
    ['communities', 'spaces'],
    ['user_communities', 'space_members'],
    ['community_notes', 'context_notes'],
    ['community_note_folders', 'context_folders'],
    ['community_brain_files', 'context_state'],
    ['brain_grants', 'context_grants'],
    ['brain_access_requests', 'context_access_requests'],
    ['note_publications', 'context_publications'],
    ['community_secrets', 'connector_secrets'],
    ['attendees', 'event_attendees'],
    ['channel_spaces', 'channel_sections'],
    ['user', 'users'],
    ['persons', 'people'],
  ];
  let old = 0;
  let renamed = 0;
  for (const [from, to] of pairs) {
    const a = await exists(from);
    const b = await exists(to);
    if (a) old += 1;
    if (b) renamed += 1;
    const state = a && b ? 'BOTH (ambiguous)' : a ? 'old' : b ? 'renamed' : 'absent';
    console.log(`  ${from.padEnd(24)} → ${to.padEnd(26)} ${state}`);
  }
  console.log(`\n  ${old} old name(s), ${renamed} already renamed.`);

  section('hand-written indexes');
  for (const name of [
    'community_note_embeddings_embedding_hnsw',
    'context_note_embeddings_embedding_hnsw',
    'context_source_chunks_embedding_hnsw',
    'context_source_chunks_text_fts',
    'communities_public_name_unique',
    'spaces_public_name_unique',
  ]) {
    console.log(`  ${(await exists(name)) ? '✓' : '·'} ${name}`);
  }

  section('tables schema.prisma no longer describes');
  const dead = await all(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
        AND table_name = ANY($1::text[]) ORDER BY 1`,
    [[
      'posts', 'post_images', 'post_comments', 'post_reactions', 'post_comment_reactions',
      'community_columns', 'community_column_values', 'community_column_requests',
      'private_columns', 'private_column_values', 'value_share_requests', 'audit_log', 'audit_logs',
    ]],
  );
  console.log(dead.length === 0 ? '  none' : dead.map((r) => `  · ${r.table_name}`).join('\n'));
  console.log(`\n  ${dead.length} present — these are what the final db push removes.`);

  section('what presync would change');
  const linkTable = (await exists('links')) ? 'links' : null;
  if (linkTable) {
    const col = (await exists('links')) &&
      (await one(
        `SELECT count(*)::int AS n FROM pg_attribute
          WHERE attrelid = to_regclass('"links"') AND attname = 'space_id' AND NOT attisdropped`,
      )).n > 0
        ? 'space_id'
        : 'community_id';
    const nulls = await one(
      `SELECT count(*)::int AS n FROM pg_attribute
        WHERE attrelid = to_regclass('"links"') AND attname = 'pair_key' AND NOT attisdropped`,
    );
    console.log(`  links tenant column: ${col}`);
    if (nulls.n === 0) {
      const total = await one(`SELECT count(*)::int AS n FROM links`);
      console.log(`  pair_key: absent — would be added and backfilled for all ${total.n} link(s)`);
      const dupes = await one(
        `SELECT count(*)::int AS n FROM (
           SELECT 1 FROM links
            GROUP BY ${col},
                     LEAST(source_id, target_id) || '|' || GREATEST(source_id, target_id),
                     relationship
           HAVING count(*) > 1
         ) d`,
      );
      const extra = await one(
        `SELECT coalesce(sum(c - 1), 0)::int AS n FROM (
           SELECT count(*) AS c FROM links
            GROUP BY ${col},
                     LEAST(source_id, target_id) || '|' || GREATEST(source_id, target_id),
                     relationship
           HAVING count(*) > 1
         ) d`,
      );
      console.log(`  duplicate link groups: ${dupes.n} → ${extra.n} row(s) WOULD BE DELETED`);
    } else {
      const missing = await one(`SELECT count(*)::int AS n FROM links WHERE pair_key IS NULL`);
      console.log(`  pair_key: present, ${missing.n} row(s) to backfill`);
    }
  }

  const spaceTable = (await exists('spaces')) ? 'spaces' : (await exists('communities')) ? 'communities' : null;
  if (spaceTable) {
    const dupNames = await all(
      `SELECT lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) AS norm, count(*)::int AS c
         FROM ${spaceTable}
        WHERE visibility = 'public' AND personal_owner_id IS NULL
        GROUP BY 1 HAVING count(*) > 1 ORDER BY 2 DESC`,
    );
    console.log(
      dupNames.length === 0
        ? '  duplicate public space names: none'
        : `  duplicate public space names: ${dupNames.length} group(s) → ${dupNames.reduce((a, r) => a + r.c - 1, 0)} space(s) WOULD BE RENAMED`,
    );
    for (const r of dupNames) console.log(`      "${r.norm}" ×${r.c}`);
  }

  section('row counts');
  for (const t of [
    spaceTable, 'users', 'people', 'nodes', 'links',
    (await exists('context_notes')) ? 'context_notes' : 'community_notes',
    (await exists('messages')) ? 'messages' : null,
  ].filter(Boolean)) {
    if (!(await exists(t))) continue;
    const n = await one(`SELECT count(*)::int AS n FROM ${t}`);
    console.log(`  ${t.padEnd(24)} ${n.n}`);
  }

  section('migration tracking');
  const tracked = await exists('_prisma_migrations');
  if (!tracked) console.log('  _prisma_migrations absent — needs the one-time baseline.');
  else {
    const rows = await all(`SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at`);
    console.log(rows.length === 0 ? '  present but empty.' : rows.map((r) => `  ${r.migration_name}`).join('\n'));
  }
  console.log('');
} finally {
  await client.query('ROLLBACK');
  await client.end();
}
