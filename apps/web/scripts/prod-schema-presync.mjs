// Pre-`prisma db push` schema fixups for prod (run in CI before the push).
//
// `prisma db push` converges the live DB to schema.prisma, but there are things
// it CANNOT do, or would do destructively, on a populated database:
//
//   1. A RENAME. `db push` diffs by name, so a renamed table or column reads as
//      "one table dropped, one added" — with --accept-data-loss that silently
//      empties it. Every rename must therefore land here, BEFORE the push, so
//      the push sees a schema that already matches and does nothing.
//   2. Add a NOT NULL column that has no default (it would fail with "column
//      contains null values"). The schema's `links.pair_key` is exactly this.
//   3. Create a UNIQUE index when duplicate rows already exist
//      (links @@unique([space_id, pair_key, relationship])).
//
// So this script does the minimum, idempotent prep that lets the subsequent
// `db push` succeed: it applies the renames, backfills `pair_key`
// (LEAST|GREATEST of the endpoints — identical to the migration + lib/graph
// upsertLink) and removes any duplicate links that would violate the unique
// index, keeping the earliest row.
//
// It also settles pre-existing duplicate PUBLIC space names, which would block
// the (hand-written, post-push) spaces_public_name_unique index the same
// way — see lib/spaces/publicName.ts.
//
// It is additive/idempotent: safe to run on every deploy. Every rename is
// guarded on the catalogs, so a database already at the target names skips the
// whole block. When a future schema change renames anything, or adds another
// NOT-NULL-without-default column on a populated table, add it here — the
// prisma/migrations/* files are the local-dev record and are never run against
// prod.
//
// Usage (CI, behind the Cloud SQL proxy with DATABASE_URL pointed at it):
//   DATABASE_URL="$DB_URL" node scripts/prod-schema-presync.mjs
import 'dotenv/config';
import pg from 'pg';

// The rename history, oldest first, mirroring prisma/migrations/*. Order is
// load-bearing: each step renames names the previous step produced (for
// example communities -> spaces -> the space_* tables -> context_*), so the
// steps must run in this sequence and not the lexical order of the migration
// directories.
//
// Op shapes:
//   ['table', from, to]
//   ['column', table, from, to]        table = its name at THIS point in the sequence
//   ['index', from, to]                also renames a constraint the index backs
//   ['constraint', table, from, to]
//
// Tables and columns that were dropped rather than renamed are absent: `db push`
// removes anything schema.prisma no longer describes, which is what we want.
const RENAME_STEPS = [
  {
    label: 'normalize table names (user -> users, persons -> people)',
    ops: [
      ['table', 'user', 'users'],
      ['index', 'user_pkey', 'users_pkey'],
      ['index', 'user_email_key', 'users_email_key'],
      ['index', 'user_claim_nonce_key', 'users_claim_nonce_key'],
      ['index', 'user_google_id_key', 'users_google_id_key'],
      ['table', 'persons', 'people'],
      ['index', 'persons_pkey', 'people_pkey'],
      ['index', 'persons_user_id_key', 'people_user_id_key'],
      ['constraint', 'people', 'persons_user_id_fkey', 'people_user_id_fkey'],
    ],
  },
  {
    label: 'ChannelSpace -> ChannelSection',
    ops: [
      ['table', 'channel_spaces', 'channel_sections'],
      ['index', 'channel_spaces_pkey', 'channel_sections_pkey'],
      ['index', 'channel_spaces_community_id_position_idx', 'channel_sections_community_id_position_idx'],
      ['constraint', 'channel_sections', 'channel_spaces_community_id_fkey', 'channel_sections_community_id_fkey'],
      // Frees `conversations.space_id` for the tenant, which the next step assigns.
      ['column', 'conversations', 'space_id', 'section_id'],
      ['index', 'conversations_space_id_idx', 'conversations_section_id_idx'],
      ['constraint', 'conversations', 'conversations_space_id_fkey', 'conversations_section_id_fkey'],
    ],
  },
  {
    label: 'Community -> Space',
    ops: [
      ['table', 'community_note_revisions', 'space_note_revisions'],
      ['table', 'community_note_embeddings', 'space_note_embeddings'],
      ['table', 'community_note_folders', 'space_note_folders'],
      ['table', 'community_brain_files', 'space_brain_files'],
      ['table', 'community_secrets', 'space_secrets'],
      ['table', 'community_notes', 'space_notes'],
      ['table', 'user_communities', 'space_members'],
      ['table', 'communities', 'spaces'],

      ['column', 'brain_access_requests', 'community_id', 'space_id'],
      ['column', 'brain_grants', 'community_id', 'space_id'],
      ['column', 'channel_sections', 'community_id', 'space_id'],
      ['column', 'spaces', 'community_aliases', 'aliases'],
      ['column', 'space_brain_files', 'community_id', 'space_id'],
      ['column', 'space_note_embeddings', 'community_id', 'space_id'],
      ['column', 'space_note_folders', 'community_id', 'space_id'],
      ['column', 'space_notes', 'community_id', 'space_id'],
      ['column', 'space_secrets', 'community_id', 'space_id'],
      ['column', 'context_source_chunks', 'community_id', 'space_id'],
      ['column', 'context_sources', 'community_id', 'space_id'],
      ['column', 'conversations', 'community_id', 'space_id'],
      ['column', 'links', 'community_id', 'space_id'],
      ['column', 'nodes', 'community_id', 'space_id'],
      ['column', 'note_publications', 'source_community_id', 'source_space_id'],
      ['column', 'note_publications', 'target_community_id', 'target_space_id'],
      ['column', 'resources', 'community_id', 'space_id'],
      ['column', 'user_aliases', 'community_id', 'space_id'],
      ['column', 'space_members', 'community_id', 'space_id'],

      ['index', 'brain_access_requests_community_id_status_idx', 'brain_access_requests_space_id_status_idx'],
      ['index', 'brain_grants_community_id_subject_type_subject_id_idx', 'brain_grants_space_id_subject_type_subject_id_idx'],
      ['index', 'brain_grants_community_id_subject_type_subject_id_resource__key', 'brain_grants_space_id_subject_type_subject_id_resource__key'],
      ['index', 'channel_sections_community_id_position_idx', 'channel_sections_space_id_position_idx'],
      ['index', 'communities_invite_token_key', 'spaces_invite_token_key'],
      ['index', 'communities_personal_owner_id_idx', 'spaces_personal_owner_id_idx'],
      ['index', 'community_brain_files_community_id_owner_key_name_key', 'space_brain_files_space_id_owner_key_name_key'],
      ['index', 'community_note_embeddings_community_id_owner_key_path_key', 'space_note_embeddings_space_id_owner_key_path_key'],
      ['index', 'community_note_folders_community_id_owner_key_idx', 'space_note_folders_space_id_owner_key_idx'],
      ['index', 'community_note_folders_community_id_owner_key_path_key', 'space_note_folders_space_id_owner_key_path_key'],
      ['index', 'community_note_revisions_note_id_at_idx', 'space_note_revisions_note_id_at_idx'],
      ['index', 'community_notes_community_id_owner_key_deleted_at_idx', 'space_notes_space_id_owner_key_deleted_at_idx'],
      ['index', 'community_notes_community_id_owner_key_path_key', 'space_notes_space_id_owner_key_path_key'],
      ['index', 'community_secrets_community_id_name_key', 'space_secrets_space_id_name_key'],
      ['index', 'context_source_chunks_community_id_owner_key_model_idx', 'context_source_chunks_space_id_owner_key_model_idx'],
      ['index', 'context_sources_community_id_owner_key_path_key', 'context_sources_space_id_owner_key_path_key'],
      ['index', 'context_sources_community_id_owner_key_status_idx', 'context_sources_space_id_owner_key_status_idx'],
      ['index', 'conversations_community_id_type_idx', 'conversations_space_id_type_idx'],
      ['index', 'links_community_id_idx', 'links_space_id_idx'],
      ['index', 'links_community_id_pair_key_relationship_key', 'links_space_id_pair_key_relationship_key'],
      ['index', 'nodes_community_id_idx', 'nodes_space_id_idx'],
      ['index', 'nodes_community_id_type_idx', 'nodes_space_id_type_idx'],
      ['index', 'note_publications_source_community_id_source_path_idx', 'note_publications_source_space_id_source_path_idx'],
      ['index', 'note_publications_source_community_id_source_path_target_co_key', 'note_publications_source_space_id_source_path_target_co_key'],
      ['index', 'note_publications_target_community_id_target_path_idx', 'note_publications_target_space_id_target_path_idx'],
      ['index', 'resources_community_id_idx', 'resources_space_id_idx'],
      ['index', 'user_aliases_community_id_alias_name_idx', 'user_aliases_space_id_alias_name_idx'],
      ['index', 'user_aliases_community_id_user_id_alias_name_key', 'user_aliases_space_id_user_id_alias_name_key'],
      ['index', 'user_communities_community_id_idx', 'space_members_space_id_idx'],
      ['index', 'user_communities_user_id_community_id_key', 'space_members_user_id_space_id_key'],
      ['index', 'user_communities_user_id_idx', 'space_members_user_id_idx'],

      ['constraint', 'brain_access_requests', 'brain_access_requests_community_id_fkey', 'brain_access_requests_space_id_fkey'],
      ['constraint', 'brain_grants', 'brain_grants_community_id_fkey', 'brain_grants_space_id_fkey'],
      ['constraint', 'channel_sections', 'channel_sections_community_id_fkey', 'channel_sections_space_id_fkey'],
      ['constraint', 'spaces', 'communities_pkey', 'spaces_pkey'],
      ['constraint', 'space_brain_files', 'community_brain_files_community_id_fkey', 'space_brain_files_space_id_fkey'],
      ['constraint', 'space_brain_files', 'community_brain_files_pkey', 'space_brain_files_pkey'],
      ['constraint', 'space_note_embeddings', 'community_note_embeddings_community_id_fkey', 'space_note_embeddings_space_id_fkey'],
      ['constraint', 'space_note_embeddings', 'community_note_embeddings_pkey', 'space_note_embeddings_pkey'],
      ['constraint', 'space_note_folders', 'community_note_folders_community_id_fkey', 'space_note_folders_space_id_fkey'],
      ['constraint', 'space_note_folders', 'community_note_folders_pkey', 'space_note_folders_pkey'],
      ['constraint', 'space_note_revisions', 'community_note_revisions_note_id_fkey', 'space_note_revisions_note_id_fkey'],
      ['constraint', 'space_note_revisions', 'community_note_revisions_pkey', 'space_note_revisions_pkey'],
      ['constraint', 'space_notes', 'community_notes_community_id_fkey', 'space_notes_space_id_fkey'],
      ['constraint', 'space_notes', 'community_notes_pkey', 'space_notes_pkey'],
      ['constraint', 'space_secrets', 'community_secrets_community_id_fkey', 'space_secrets_space_id_fkey'],
      ['constraint', 'space_secrets', 'community_secrets_pkey', 'space_secrets_pkey'],
      ['constraint', 'context_sources', 'context_sources_community_id_fkey', 'context_sources_space_id_fkey'],
      ['constraint', 'conversations', 'conversations_community_id_fkey', 'conversations_space_id_fkey'],
      ['constraint', 'links', 'links_community_id_fkey', 'links_space_id_fkey'],
      ['constraint', 'nodes', 'nodes_community_id_fkey', 'nodes_space_id_fkey'],
      ['constraint', 'note_publications', 'note_publications_source_community_id_fkey', 'note_publications_source_space_id_fkey'],
      ['constraint', 'note_publications', 'note_publications_target_community_id_fkey', 'note_publications_target_space_id_fkey'],
      ['constraint', 'user_aliases', 'user_aliases_community_id_fkey', 'user_aliases_space_id_fkey'],
      ['constraint', 'space_members', 'user_communities_added_by_fkey', 'space_members_added_by_fkey'],
      ['constraint', 'space_members', 'user_communities_community_id_fkey', 'space_members_space_id_fkey'],
      ['constraint', 'space_members', 'user_communities_pkey', 'space_members_pkey'],
      ['constraint', 'space_members', 'user_communities_user_id_fkey', 'space_members_user_id_fkey'],

      // Two names had been truncated at 63 chars against the old columns;
      // the shorter columns free enough room for the full generated name.
      ['index', 'brain_grants_space_id_subject_type_subject_id_resource__key', 'brain_grants_space_id_subject_type_subject_id_resource_path_key'],
      ['index', 'note_publications_source_space_id_source_path_target_co_key', 'note_publications_source_space_id_source_path_target_space__key'],
    ],
  },
  {
    label: 'brain -> Context (plus secrets -> Connectors, attendees -> Events)',
    ops: [
      ['table', 'space_notes', 'context_notes'],
      ['table', 'space_note_revisions', 'context_note_revisions'],
      ['table', 'space_note_folders', 'context_folders'],
      ['table', 'space_note_embeddings', 'context_note_embeddings'],
      ['table', 'space_brain_files', 'context_state'],
      ['table', 'brain_grants', 'context_grants'],
      ['table', 'brain_access_requests', 'context_access_requests'],
      ['table', 'note_publications', 'context_publications'],
      ['table', 'space_secrets', 'connector_secrets'],
      ['table', 'attendees', 'event_attendees'],

      ['index', 'space_notes_pkey', 'context_notes_pkey'],
      ['index', 'space_note_revisions_pkey', 'context_note_revisions_pkey'],
      ['index', 'space_note_folders_pkey', 'context_folders_pkey'],
      ['index', 'space_note_embeddings_pkey', 'context_note_embeddings_pkey'],
      ['index', 'space_brain_files_pkey', 'context_state_pkey'],
      ['index', 'brain_grants_pkey', 'context_grants_pkey'],
      ['index', 'brain_access_requests_pkey', 'context_access_requests_pkey'],
      ['index', 'note_publications_pkey', 'context_publications_pkey'],
      ['index', 'space_secrets_pkey', 'connector_secrets_pkey'],
      ['index', 'attendees_pkey', 'event_attendees_pkey'],

      ['index', 'space_notes_space_id_owner_key_path_key', 'context_notes_space_id_owner_key_path_key'],
      ['index', 'space_note_folders_space_id_owner_key_path_key', 'context_folders_space_id_owner_key_path_key'],
      ['index', 'space_note_embeddings_space_id_owner_key_path_key', 'context_note_embeddings_space_id_owner_key_path_key'],
      ['index', 'space_brain_files_space_id_owner_key_name_key', 'context_state_space_id_owner_key_name_key'],
      ['index', 'brain_grants_space_id_subject_type_subject_id_resource_path_key', 'context_grants_space_id_subject_type_subject_id_resource_pa_key'],
      ['index', 'note_publications_source_space_id_source_path_target_space__key', 'context_publications_source_space_id_source_path_target_spa_key'],
      ['index', 'space_secrets_space_id_name_key', 'connector_secrets_space_id_name_key'],
      ['index', 'attendees_event_id_email_key', 'event_attendees_event_id_email_key'],

      ['index', 'space_notes_space_id_owner_key_deleted_at_idx', 'context_notes_space_id_owner_key_deleted_at_idx'],
      ['index', 'space_note_revisions_note_id_at_idx', 'context_note_revisions_note_id_at_idx'],
      ['index', 'space_note_folders_space_id_owner_key_idx', 'context_folders_space_id_owner_key_idx'],
      ['index', 'brain_grants_space_id_subject_type_subject_id_idx', 'context_grants_space_id_subject_type_subject_id_idx'],
      ['index', 'brain_access_requests_space_id_status_idx', 'context_access_requests_space_id_status_idx'],
      ['index', 'brain_access_requests_user_id_idx', 'context_access_requests_user_id_idx'],
      ['index', 'note_publications_source_space_id_source_path_idx', 'context_publications_source_space_id_source_path_idx'],
      ['index', 'note_publications_target_space_id_target_path_idx', 'context_publications_target_space_id_target_path_idx'],
      ['index', 'attendees_event_id_idx', 'event_attendees_event_id_idx'],
      ['index', 'attendees_event_id_status_idx', 'event_attendees_event_id_status_idx'],
      ['index', 'attendees_person_id_idx', 'event_attendees_person_id_idx'],
      ['index', 'attendees_email_idx', 'event_attendees_email_idx'],

      ['constraint', 'context_notes', 'space_notes_space_id_fkey', 'context_notes_space_id_fkey'],
      ['constraint', 'context_note_revisions', 'space_note_revisions_note_id_fkey', 'context_note_revisions_note_id_fkey'],
      ['constraint', 'context_folders', 'space_note_folders_space_id_fkey', 'context_folders_space_id_fkey'],
      ['constraint', 'context_note_embeddings', 'space_note_embeddings_space_id_fkey', 'context_note_embeddings_space_id_fkey'],
      ['constraint', 'context_state', 'space_brain_files_space_id_fkey', 'context_state_space_id_fkey'],
      ['constraint', 'context_grants', 'brain_grants_space_id_fkey', 'context_grants_space_id_fkey'],
      ['constraint', 'context_access_requests', 'brain_access_requests_space_id_fkey', 'context_access_requests_space_id_fkey'],
      ['constraint', 'context_publications', 'note_publications_source_space_id_fkey', 'context_publications_source_space_id_fkey'],
      ['constraint', 'context_publications', 'note_publications_target_space_id_fkey', 'context_publications_target_space_id_fkey'],
      ['constraint', 'connector_secrets', 'space_secrets_space_id_fkey', 'connector_secrets_space_id_fkey'],
      ['constraint', 'event_attendees', 'attendees_event_id_fkey', 'event_attendees_event_id_fkey'],
      ['constraint', 'event_attendees', 'attendees_person_id_fkey', 'event_attendees_person_id_fkey'],
    ],
  },
];

// Stored VALUES that spelled the old vocabulary. They are enum-like strings and
// metadata keys the code compares against, so they move with it. Each is
// self-extinguishing — its WHERE clause stops matching once applied.
const VALUE_FIXUPS = [
  {
    table: 'context_grants',
    label: "grant subject_type 'community' -> 'space'",
    sql: `UPDATE context_grants SET subject_type = 'space' WHERE subject_type = 'community'`,
  },
  {
    table: 'nodes',
    label: "event visibility 'community' -> 'space'",
    sql: `UPDATE nodes SET metadata = jsonb_set(metadata, '{visibility}', '"space"')
           WHERE type = 'event' AND metadata->>'visibility' = 'community'`,
  },
  {
    table: 'nodes',
    label: 'node metadata communityRef -> spaceRef',
    sql: `UPDATE nodes SET metadata = (metadata - 'communityRef') || jsonb_build_object('spaceRef', metadata->'communityRef')
           WHERE metadata ? 'communityRef'`,
  },
  {
    table: 'nodes',
    label: 'section node metadata spaceId -> sectionId',
    sql: `UPDATE nodes SET metadata = (metadata - 'spaceId') || jsonb_build_object('sectionId', metadata->'spaceId')
           WHERE metadata ? 'spaceId'`,
  },
];

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

  const quote = (id) => `"${id.replace(/"/g, '""')}"`;
  // to_regclass resolves a table OR an index through the search path and returns
  // NULL rather than erroring when the name is free.
  const relationExists = async (name) =>
    (await client.query(`SELECT to_regclass($1) AS oid`, [quote(name)])).rows[0].oid !== null;
  const columnExists = async (table, column) =>
    (await client.query(
      `SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass($1) AND attname = $2 AND attnum > 0 AND NOT attisdropped`,
      [quote(table), column],
    )).rowCount > 0;
  const constraintExists = async (table, name) =>
    (await client.query(
      `SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass($1) AND conname = $2`,
      [quote(table), name],
    )).rowCount > 0;

  await client.query('BEGIN');

  // 1. Renames. Each op is applied only when the old name is present and the new
  //    one is free, so a database already carrying the new names — or one where
  //    the object was dropped entirely — skips it. Both names present at once is
  //    ambiguous and never resolved silently: it is reported and left alone.
  let renameCount = 0;
  let ambiguous = 0;
  for (const step of RENAME_STEPS) {
    let applied = 0;
    for (const op of step.ops) {
      const [kind] = op;
      let from;
      let to;
      let present;
      let taken;
      let sql;

      if (kind === 'table') {
        [, from, to] = op;
        present = await relationExists(from);
        taken = await relationExists(to);
        sql = `ALTER TABLE ${quote(from)} RENAME TO ${quote(to)}`;
      } else if (kind === 'index') {
        [, from, to] = op;
        present = await relationExists(from);
        taken = await relationExists(to);
        sql = `ALTER INDEX ${quote(from)} RENAME TO ${quote(to)}`;
      } else if (kind === 'column') {
        const [, table, f, t] = op;
        [from, to] = [`${table}.${f}`, `${table}.${t}`];
        present = await columnExists(table, f);
        taken = await columnExists(table, t);
        sql = `ALTER TABLE ${quote(table)} RENAME COLUMN ${quote(f)} TO ${quote(t)}`;
      } else {
        const [, table, f, t] = op;
        [from, to] = [f, t];
        present = await constraintExists(table, f);
        taken = await constraintExists(table, t);
        sql = `ALTER TABLE ${quote(table)} RENAME CONSTRAINT ${quote(f)} TO ${quote(t)}`;
      }

      if (!present) continue;
      if (taken) {
        console.warn(`    ! ${from} and ${to} both exist — left alone`);
        ambiguous += 1;
        continue;
      }
      await client.query(sql);
      applied += 1;
    }
    renameCount += applied;
    console.log(`  ${applied === 0 ? '·' : '✓'} ${step.label}: ${applied} rename(s)`);
  }
  console.log(`  ✓ ${renameCount} rename(s) applied${ambiguous > 0 ? `, ${ambiguous} ambiguous` : ''}`);

  // 2. Values that spelled the old vocabulary.
  for (const fix of VALUE_FIXUPS) {
    if (!(await tableExists(fix.table))) continue;
    const res = await client.query(fix.sql);
    console.log(`  ✓ ${fix.label} (${res.rowCount} row(s))`);
  }

  // 3. Nothing to do if the links table doesn't exist yet (fresh DB — db push will
  //    create it cleanly).
  if (!(await tableExists('links'))) {
    console.log('  links table absent — skipping link fixups.');
  } else {
    // pair_key: add nullable (if missing) + backfill, so db push can SET NOT NULL.
    await client.query(`ALTER TABLE links ADD COLUMN IF NOT EXISTS pair_key TEXT`);
    const bf = await client.query(
      `UPDATE links
          SET pair_key = LEAST(source_id, target_id) || '|' || GREATEST(source_id, target_id)
        WHERE pair_key IS NULL`,
    );
    console.log(`  ✓ pair_key backfilled (${bf.rowCount} row(s))`);

    // Dedup so the unique (space_id, pair_key, relationship) index can build.
    // Keep the earliest row per group (oldest created_at, then id).
    const dedup = await client.query(
      `DELETE FROM links l
         USING (
           SELECT id,
                  ROW_NUMBER() OVER (
                    PARTITION BY space_id, pair_key, relationship
                    ORDER BY created_at ASC, id ASC
                  ) AS rn
             FROM links
         ) d
        WHERE l.id = d.id AND d.rn > 1`,
    );
    console.log(`  ✓ removed ${dedup.rowCount} duplicate link(s)`);
  }

  // 4. Public space names are unique from now on (lib/spaces/publicName.ts,
  //    backed by the spaces_public_name_unique partial index that
  //    apply-sql-functions.mjs creates after the push). Rows that predate the
  //    rule can still collide and would stop that index building, so settle them
  //    here: oldest keeps the name, the rest get " (2)", " (3)"… — the same
  //    keep-the-earliest treatment as the link dedup, but a rename rather than a
  //    delete, since a whole space must never be thrown away over its name.
  if (await tableExists('spaces')) {
    let resolved = 0;
    // Looped: a rename to "X (2)" can land on an existing "X (2)". Each pass
    // strictly reduces the collisions, so a handful of passes always settles it.
    for (let pass = 0; pass < 5; pass++) {
      const renamed = await client.query(
        `UPDATE spaces c
            SET name = c.name || ' (' || d.rn || ')'
           FROM (
             SELECT id,
                    ROW_NUMBER() OVER (
                      PARTITION BY lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))
                      ORDER BY created_at ASC, id ASC
                    ) AS rn
               FROM spaces
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
