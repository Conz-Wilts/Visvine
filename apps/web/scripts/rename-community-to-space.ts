/**
 * The vocabulary rename, in the data: `community` becomes `space` everywhere a
 * stored value still spells it. The code stopped saying it in one commit; this
 * makes the rows agree, and until it has run against a database the app reads
 * ids and paths that no longer resolve.
 *
 * Four things move, and they must move in this order:
 *
 *   1. **Ids.** `spaces.id` and `nodes.id` carried a `community:` prefix
 *      (`community:visvine-hq`, `community:halter`), and so does every value
 *      derived from one — a tool key (`community:acme/deal-pipeline`), a
 *      machine ref, an agent's space column. Every column in the schema is
 *      SCANNED for one, outside any transaction; only the columns that hold
 *      one are then rewritten, with every FK to `spaces(id)` and `nodes(id)`
 *      dropped and restored from the catalog around them. One transaction:
 *      either the whole graph moves or none of it does — and when the scan
 *      comes back empty the transaction is never opened at all. Scanning
 *      first is not an optimisation: the first production run built an UPDATE
 *      for all 474 columns, and 474 no-op round trips through the Cloud SQL
 *      proxy expired the transaction before a row had changed.
 *
 *   2. **Note paths**, which are link identity, so a path is only ever renamed
 *      together with the links pointing at it. Sections move OFF `spaces/`
 *      first (`spaces/general.md` → `sections/general.md`), because the org
 *      namespace moves ONTO it second (`communities/halter/index.md` →
 *      `spaces/halter/index.md`). Reversing those two would collapse both
 *      namespaces into one. The grafted sub-space folder is `subspaces/` now
 *      and is not stored at all (lib/notes/federation.ts rebases at read time),
 *      so nothing here writes it.
 *
 *   3. **Note bodies**, so a markdown link or a `[[mention]]` still resolves
 *      after its target moved. Same order, and only inside link syntax — prose
 *      that happens to say "communities/" is left alone.
 *
 *   4. **Object storage.** The space media prefix was `communities/<id>/` and
 *      is `spaces/<id>/` (lib/storage/objectPaths.ts). `--storage` copies the
 *      bytes across and deletes the originals; without it the rows are pointed
 *      at the new prefix and the images 404 until someone re-uploads.
 *
 * Node `type` values fold too: rows written as `community`/`communities`
 * become `space`. The retired spellings stay accepted in TYPE_SYNONYMS, so a
 * row this misses still renders — it just stops being findable by its
 * canonical type.
 *
 * Run once, and only against a database that still spells the old words. Step
 * 2 is a two-stage shuffle through one namespace, so it is NOT idempotent: on
 * an already-renamed database it would drag the org notes it just created in
 * `spaces/` on into `sections/`. The run therefore refuses unless it finds the
 * old spelling still stored, and `--force` is the deliberate override for a
 * half-finished run. Run `db:index-notes:rebuild` afterwards — a folder's
 * child list holds relative hrefs this does not try to parse.
 *
 *   pnpm --filter @visvine/web db:rename:spaces --dry-run
 *   pnpm --filter @visvine/web db:rename:spaces
 *   pnpm --filter @visvine/web db:rename:spaces --storage
 *
 * Against production it is run once, straight after the deploy that carries
 * the rename, through the proxy with the guard's override (docs/runbook.md).
 */
import '../../../scripts/guard-local-db.mjs'
import 'dotenv/config'
import prisma from '../lib/prisma'
import { MEDIA_BUCKET, copyObject, deleteObject, listObjects } from '../lib/gcs'

const OLD_ID_PREFIX = 'community:'
const NEW_ID_PREFIX = 'space:'
const OLD_ORG_DIR = 'communities/'
const NEW_ORG_DIR = 'spaces/'
const OLD_SECTION_DIR = 'spaces/'
const NEW_SECTION_DIR = 'sections/'

/** Long enough for a migration holding DDL locks; Prisma's default is 5s. */
const TX_TIMEOUT_MS = 15 * 60 * 1000
const TX_MAX_WAIT_MS = 60 * 1000

const TEXT_UDTS = ['text', 'varchar', 'bpchar']
const TEXT_ARRAY_UDTS = ['_text', '_varchar']
const JSON_UDTS = ['jsonb']

/** Columns that hold a context-relative note path. */
const PATH_COLUMN_NAMES = ['path', 'from_path', 'deleted_path', 'resource_path']
/** Columns that hold note markdown. */
const CONTENT_COLUMN_NAMES = ['content']

type Column = { table: string; column: string; udt: string }
type ForeignKey = { table: string; name: string; definition: string }

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')
const withStorage = args.includes('--storage')

let statements = 0
let rowsTouched = 0

async function run(label: string, sql: string): Promise<void> {
  statements++
  if (dryRun) {
    console.log(`  [dry] ${label}`)
    return
  }
  const affected = await prisma.$executeRawUnsafe(sql)
  rowsTouched += affected
  if (affected > 0) console.log(`  ${label} — ${affected}`)
}

/**
 * Writable columns of the given Postgres types, by `udt_name` rather than
 * `data_type`: every array reads as ARRAY there, and rewriting a float[]
 * embedding as if it held ids is not an error Postgres would catch politely.
 */
async function columnsOfKind(udts: string[]): Promise<Column[]> {
  return prisma.$queryRawUnsafe<Column[]>(
    `SELECT c.table_name AS table, c.column_name AS column, c.udt_name AS udt
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
        AND c.udt_name = ANY($1::text[])
        AND c.is_generated = 'NEVER'
        AND c.is_updatable = 'YES'
      ORDER BY c.table_name, c.column_name`,
    udts,
  )
}

/** Every table in the public schema carrying a column of this name. */
async function columnsNamed(name: string): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<{ table: string }[]>(
    `SELECT table_name AS table FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = $1`,
    name,
  )
  return new Set(rows.map((r) => r.table))
}

/**
 * A guard that skips a row whose destination path is already taken, so the
 * move never trips the (space_id, owner_key, path) identity. It only applies
 * where that identity exists; elsewhere there is nothing to collide with.
 *
 * A skipped row is a genuine conflict — two notes claiming one path — which is
 * a person's call, not a migration's, so it is left where it is.
 */
function free(column: Column, owners: Set<string>, target: string): string {
  if (!owners.has(column.table)) return ''
  return (
    ` AND NOT EXISTS (SELECT 1 FROM ${q(column.table)} p` +
    ` WHERE p."space_id" = t."space_id" AND p."owner_key" = t."owner_key"` +
    ` AND p.${q(column.column)} = ${target})`
  )
}

/**
 * A `path` column is only a NOTE path in the context tables and the projection
 * queue. Elsewhere the word means something else — `agent_egress_log.path` is
 * the path of a URL a run fetched, `connector_state.path` a key inside a
 * connector's own store — and rewriting those would corrupt unrelated data
 * that merely happens to start with the same eight characters.
 */
function ownsNotePaths(table: string): boolean {
  return table.startsWith('context_') || table === 'note_projection_jobs'
}

/** Tables carrying a space_id — the ones whose `path` is a context path. */
async function contextTables(): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<{ table: string }[]>(
    `SELECT table_name AS table FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'space_id'`,
  )
  return new Set(rows.map((r) => r.table))
}

/** Every FK pointing at spaces(id) or nodes(id), with its exact definition. */
async function foreignKeysInto(tables: string[]): Promise<ForeignKey[]> {
  return prisma.$queryRawUnsafe<ForeignKey[]>(
    `SELECT src.relname AS table, con.conname AS name, pg_get_constraintdef(con.oid) AS definition
       FROM pg_constraint con
       JOIN pg_class src ON src.oid = con.conrelid
       JOIN pg_class tgt ON tgt.oid = con.confrelid
       JOIN pg_namespace ns ON ns.oid = src.relnamespace
      WHERE con.contype = 'f' AND ns.nspname = 'public' AND tgt.relname = ANY($1::text[])`,
    tables,
  )
}

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`
const lit = (value: string) => `'${value.replace(/'/g, "''")}'`

/**
 * Which of these columns actually hold a value starting `community:`?
 *
 * Asked BEFORE the transaction and in batches, because the answer is almost
 * always "none of them" and the alternative is what broke the first production
 * run: 500-odd no-op UPDATEs, each its own round trip through the Cloud SQL
 * proxy, blowing the transaction's clock before a single row had changed.
 * A probe outside the transaction has no clock to blow.
 */
async function columnsHoldingIds(
  text: Column[],
  arrays: Column[],
  json: Column[],
): Promise<{ text: Column[]; arrays: Column[]; json: Column[] }> {
  const probe = (c: Column, kind: 'text' | 'array' | 'json'): string => {
    if (kind === 'text') return `EXISTS (SELECT 1 FROM ${q(c.table)} WHERE ${q(c.column)} LIKE ${lit(OLD_ID_PREFIX + '%')})`
    if (kind === 'array') {
      return `EXISTS (SELECT 1 FROM ${q(c.table)}, unnest(${q(c.column)}) e WHERE e LIKE ${lit(OLD_ID_PREFIX + '%')})`
    }
    return `EXISTS (SELECT 1 FROM ${q(c.table)} WHERE ${q(c.column)}::text LIKE ${lit('%"' + OLD_ID_PREFIX + '%')})`
  }

  const all: Array<{ column: Column; kind: 'text' | 'array' | 'json' }> = [
    ...text.map((column) => ({ column, kind: 'text' as const })),
    ...arrays.map((column) => ({ column, kind: 'array' as const })),
    ...json.map((column) => ({ column, kind: 'json' as const })),
  ]

  const hits = new Set<string>()
  const BATCH = 40
  for (let i = 0; i < all.length; i += BATCH) {
    const slice = all.slice(i, i + BATCH)
    const sql = `SELECT ${slice.map((e, n) => `${probe(e.column, e.kind)} AS "c${n}"`).join(', ')}`
    const [row] = await prisma.$queryRawUnsafe<Array<Record<string, boolean>>>(sql)
    slice.forEach((e, n) => {
      if (row?.[`c${n}`]) hits.add(`${e.column.table}.${e.column.column}`)
    })
  }
  const kept = (list: Column[]) => list.filter((c) => hits.has(`${c.table}.${c.column}`))
  return { text: kept(text), arrays: kept(arrays), json: kept(json) }
}

/**
 * The id sweep. Broad in what it CONSIDERS — an id ends up in columns no schema
 * reading would predict: a tool key, a machine ref, an agent's space column —
 * but narrow in what it writes, because `columnsHoldingIds` has already asked
 * which of them hold one. The guard (`LIKE 'community:%'`, anchored) matches an
 * id and nothing a person wrote.
 *
 * The whole thing is one transaction, and the foreign keys come off inside it
 * so a renamed parent never fails a child's check mid-flight. Nothing is
 * dropped when there is nothing to write — a no-op run does not touch the
 * schema at all.
 */
async function renameIds(): Promise<void> {
  console.log('\n1. ids — community:<slug> → space:<slug>')
  const candidates = {
    text: await columnsOfKind(TEXT_UDTS),
    arrays: await columnsOfKind(TEXT_ARRAY_UDTS),
    json: await columnsOfKind(JSON_UDTS),
  }
  const { text, arrays, json } = await columnsHoldingIds(
    candidates.text,
    candidates.arrays,
    candidates.json,
  )
  const holding = text.length + arrays.length + json.length
  console.log(
    `  scanned ${candidates.text.length} text · ${candidates.arrays.length} array · ` +
      `${candidates.json.length} json columns — ${holding} hold a community: value`,
  )
  if (holding === 0) {
    console.log('  nothing to rewrite; leaving the foreign keys alone')
    return
  }

  const fks = await foreignKeysInto(['spaces', 'nodes'])
  const statementsInTx: string[] = []
  for (const fk of fks) {
    statementsInTx.push(`ALTER TABLE ${q(fk.table)} DROP CONSTRAINT ${q(fk.name)}`)
  }
  for (const c of text) {
    statementsInTx.push(
      `UPDATE ${q(c.table)} SET ${q(c.column)} = ${lit(NEW_ID_PREFIX)} || substring(${q(c.column)} from ${OLD_ID_PREFIX.length + 1})` +
        ` WHERE ${q(c.column)} LIKE ${lit(OLD_ID_PREFIX + '%')}`,
    )
  }
  for (const c of arrays) {
    statementsInTx.push(
      `UPDATE ${q(c.table)} SET ${q(c.column)} = (
         SELECT array_agg(CASE WHEN e LIKE ${lit(OLD_ID_PREFIX + '%')}
                               THEN ${lit(NEW_ID_PREFIX)} || substring(e from ${OLD_ID_PREFIX.length + 1})
                               ELSE e END ORDER BY ord)
           FROM unnest(${q(c.column)}) WITH ORDINALITY AS u(e, ord))
       WHERE EXISTS (SELECT 1 FROM unnest(${q(c.column)}) AS e WHERE e LIKE ${lit(OLD_ID_PREFIX + '%')})`,
    )
  }
  for (const c of json) {
    // Only a value that IS an id, never a substring of prose: the quote before
    // the prefix anchors it to the start of a JSON string.
    statementsInTx.push(
      `UPDATE ${q(c.table)} SET ${q(c.column)} =
         replace(${q(c.column)}::text, ${lit('"' + OLD_ID_PREFIX)}, ${lit('"' + NEW_ID_PREFIX)})::jsonb
       WHERE ${q(c.column)}::text LIKE ${lit('%"' + OLD_ID_PREFIX + '%')}`,
    )
  }
  for (const fk of fks) {
    statementsInTx.push(`ALTER TABLE ${q(fk.table)} ADD CONSTRAINT ${q(fk.name)} ${fk.definition}`)
  }

  console.log(`  ${fks.length} foreign keys off and back on, ${holding} columns rewritten`)
  if (dryRun) {
    statements += statementsInTx.length
    console.log(`  [dry] ${statementsInTx.length} statements in one transaction`)
    return
  }
  // Prisma's default transaction clock is 5s, which is a sensible default for a
  // request and useless for a migration holding DDL locks over a proxy.
  await prisma.$transaction(
    async (tx) => {
      for (const sql of statementsInTx) await tx.$executeRawUnsafe(sql)
    },
    { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS },
  )
  statements += statementsInTx.length
  console.log(`  ${statementsInTx.length} statements applied`)
}

/**
 * Note paths. Sections vacate `spaces/` before the org namespace moves in —
 * before this runs, every stored `spaces/…` path is a section, because a
 * sub-space's context is rebased at read time and never written to the parent.
 */
async function renamePaths(): Promise<void> {
  console.log('\n2. note paths — spaces/ → sections/, then communities/ → spaces/')
  const scoped = await contextTables()
  const owners = await columnsNamed('owner_key')
  const columns = (await columnsOfKind(TEXT_UDTS)).filter(
    (c) => PATH_COLUMN_NAMES.includes(c.column) && scoped.has(c.table) && ownsNotePaths(c.table),
  )
  for (const [from, to] of [
    [OLD_SECTION_DIR, NEW_SECTION_DIR],
    [OLD_ORG_DIR, NEW_ORG_DIR],
  ]) {
    // `from` carries its trailing slash, so the prefix match cannot cross into
    // a sibling. The bare folder path — a row for the namespace itself, with no
    // slash — is what an empty folder and a folder flag are stored under, so it
    // is matched separately rather than left behind for a rebuild to re-fill.
    const bare = from.slice(0, -1)
    const bareTo = to.slice(0, -1)
    for (const c of columns) {
      const moved = `${lit(to)} || substring(t.${q(c.column)} from ${from.length + 1})`
      await run(
        `${c.table}.${c.column} ${from} → ${to}`,
        `UPDATE ${q(c.table)} t SET ${q(c.column)} = ${moved}
          WHERE t.${q(c.column)} LIKE ${lit(from + '%')}${free(c, owners, moved)}`,
      )
      await run(
        `${c.table}.${c.column} ${bare} → ${bareTo}`,
        `UPDATE ${q(c.table)} t SET ${q(c.column)} = ${lit(bareTo)}
          WHERE t.${q(c.column)} = ${lit(bare)}${free(c, owners, lit(bareTo))}`,
      )
    }
  }
}

/**
 * Links inside note bodies. Only link syntax — `](communities/…)`,
 * `[[communities/…]]`, a quoted frontmatter path — so a sentence about a
 * community keeps its word.
 */
async function renameBodies(): Promise<void> {
  console.log('\n3. note bodies — links follow their targets')
  const scoped = await contextTables()
  const columns = (await columnsOfKind(TEXT_UDTS)).filter(
    (c) =>
      CONTENT_COLUMN_NAMES.includes(c.column) &&
      // A revision is keyed by its note, not by a space, so it has no space_id
      // to scope on — and a restore that skipped it would put the old paths
      // back. Every context_* table's `content` is note markdown.
      (scoped.has(c.table) || c.table.startsWith('context_')),
  )
  for (const [from, to] of [
    [OLD_SECTION_DIR, NEW_SECTION_DIR],
    [OLD_ORG_DIR, NEW_ORG_DIR],
  ]) {
    const opener = `([(\\[]|\\[\\[|["'/])`
    for (const c of columns) {
      await run(
        `${c.table}.${c.column} ${from} → ${to}`,
        `UPDATE ${q(c.table)} SET ${q(c.column)} = regexp_replace(${q(c.column)}, ${lit(opener + from)}, ${lit('\\1' + to)}, 'g')
          WHERE ${q(c.column)} ~ ${lit(opener + from)}`,
      )
    }
  }
}

/** `type: community` was always the org type; say so. */
async function renameNodeTypes(): Promise<void> {
  console.log('\n4. node types — community/communities → space')
  await run(
    'nodes.type',
    `UPDATE "nodes" SET "type" = 'space' WHERE lower("type") IN ('community', 'communities')`,
  )
}

/**
 * The space media prefix. The bytes are copied before the originals go, so an
 * interrupted run leaves both and a re-run finishes the job.
 */
async function moveObjects(): Promise<void> {
  console.log('\n5. object storage — communities/ → spaces/')
  if (!withStorage) {
    console.log('  skipped (pass --storage to move the bytes; rows already point at spaces/)')
    return
  }
  const bucket = MEDIA_BUCKET()
  const objects = await listObjects(bucket, OLD_ORG_DIR)
  if (objects.length === 0) {
    console.log('  nothing under communities/')
    return
  }
  for (const { name } of objects) {
    const next = NEW_ORG_DIR + name.slice(OLD_ORG_DIR.length)
    if (dryRun) {
      console.log(`  [dry] ${name} → ${next}`)
      continue
    }
    await copyObject(bucket, name, next)
    await deleteObject(bucket, name)
    console.log(`  ${name} → ${next}`)
  }
}

/**
 * Is the old spelling still stored anywhere? Four independent witnesses, so a
 * run interrupted between phases still reads as unfinished and can be resumed.
 */
async function pending(): Promise<string[]> {
  const checks: Array<[string, string]> = [
    ['space ids', `SELECT 1 FROM "spaces" WHERE "id" LIKE 'community:%' LIMIT 1`],
    ['node ids', `SELECT 1 FROM "nodes" WHERE "id" LIKE 'community:%' LIMIT 1`],
    ['node types', `SELECT 1 FROM "nodes" WHERE lower("type") IN ('community','communities') LIMIT 1`],
    [
      'note paths',
      `SELECT 1 FROM "context_notes" WHERE "path" = 'communities' OR "path" LIKE 'communities/%' LIMIT 1`,
    ],
  ]
  const found: string[] = []
  for (const [label, sql] of checks) {
    const rows = await prisma.$queryRawUnsafe<unknown[]>(sql)
    if (rows.length > 0) found.push(label)
  }
  return found
}

async function main(): Promise<void> {
  console.log(dryRun ? 'rename-community-to-space (dry run)\n' : 'rename-community-to-space\n')
  const found = await pending()
  if (found.length === 0 && !force) {
    console.log('Nothing to rename in the database: no community ids, types or note')
    console.log('paths are stored. Re-running the phases below would move the org')
    console.log('namespace they created in spaces/ on into sections/, so they are')
    console.log('skipped. Pass --force only to resume a run that died part-way.')
  } else {
    console.log(`  still stored: ${found.length > 0 ? found.join(', ') : 'nothing (forced)'}`)
    await renameIds()
    await renamePaths()
    await renameBodies()
    await renameNodeTypes()
  }
  // Outside that guard on purpose. The object move is idempotent on its own
  // terms — it lists what is left under the old prefix and moves that — so it
  // must stay reachable after the database half has already been done, which
  // is exactly the state a run that died at this phase leaves behind.
  await moveObjects()
  console.log(
    `\n${dryRun ? 'would run' : 'ran'} ${statements} statements` +
      (dryRun ? '' : `, ${rowsTouched} rows touched`),
  )
  console.log('next: pnpm --filter @visvine/web db:index-notes:rebuild')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
