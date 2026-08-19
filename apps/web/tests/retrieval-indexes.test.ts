import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards for the retrieval index decision recorded in migration
 * 20260824120000_retrieval_index_correction.
 *
 * Two HNSW indexes existed for months and were never used once, for two
 * independent reasons that are both invisible at the call site:
 *
 *  1. The stages write `ORDER BY 1 - (embedding <=> $1) DESC`. Postgres only
 *     recognises an HNSW index for `ORDER BY embedding <=> $1` — the bare
 *     operator, ascending. The `1 - (...)` wrapper is semantically identical and
 *     plans as `Seq Scan -> Sort`.
 *  2. Both queries filter on `path IN (<visible paths>)`, the candidate set
 *     assembled in memory by the vault cache. HNSW applies that filter AFTER the
 *     index scan, so a `LIMIT 20` could return fewer than 20 visible rows — the
 *     index would not have been an optimisation, it would have been a silent
 *     recall bug.
 *
 * The resolution was to drop them: there is nothing for an ANN index to skip
 * once candidates are already narrowed, and the exact scan measures ~21ms on a
 * 5,000-note context. These tests keep the two halves of that decision from
 * drifting apart — the danger is someone "fixing" one without the other.
 */

const root = join(__dirname, '..')
const migrations = join(root, 'prisma/migrations')

function allMigrationSql(): string {
  return readdirSync(migrations)
    .filter((d) => !d.endsWith('.toml'))
    .map((d) => {
      try {
        return readFileSync(join(migrations, d, 'migration.sql'), 'utf8')
      } catch {
        return ''
      }
    })
    .join('\n')
}

const sqlDir = readFileSync(join(root, 'prisma/sql/retrieval-indexes.sql'), 'utf8')
const vectorStage = readFileSync(join(root, 'lib/notes/vectorStage.ts'), 'utf8')
const sourceStage = readFileSync(join(root, 'lib/notes/sourceStage.ts'), 'utf8')

test('no ANN index is created outside a migration that explains itself', () => {
  // apply-sql-functions.mjs runs this file on every db:migrate, so an index
  // added here reaches every database including production.
  assert.doesNotMatch(
    sqlDir,
    /CREATE\s+INDEX[\s\S]*?USING\s+(hnsw|ivfflat)/i,
    'retrieval-indexes.sql must not create an ANN index — see 20260824120000_retrieval_index_correction',
  )
})

test('the HNSW indexes that were never used are dropped', () => {
  const sql = allMigrationSql()
  assert.match(sql, /DROP INDEX IF EXISTS "context_note_embeddings_embedding_hnsw"/)
  assert.match(sql, /DROP INDEX IF EXISTS "context_source_chunks_embedding_hnsw"/)
})

/**
 * The pairing that has to hold: a query may use the index-eligible ordering ONLY
 * alongside iterative scan, because HNSW post-filters. Today neither stage does,
 * and that is correct — they scan exactly. If someone switches an ORDER BY to
 * the bare operator to "make the index work", this fails until they also set
 * `hnsw.iterative_scan`, which is the part that keeps results from being
 * silently dropped.
 */
for (const [name, src] of [
  ['vectorStage', vectorStage],
  ['sourceStage', sourceStage],
] as const) {
  test(`${name}: a bare-operator ORDER BY requires iterative scan`, () => {
    const usesBareOperator = /ORDER BY\s+embedding\s+<=>/i.test(src)
    if (!usesBareOperator) return // exact scan — the current, correct state
    assert.match(
      src,
      /hnsw\.iterative_scan/,
      `${name} orders by the raw distance operator, which can engage HNSW. ` +
        'HNSW applies the path filter after the scan, so this needs ' +
        "hnsw.iterative_scan = relaxed_order or it will silently return fewer rows than it should.",
    )
  })
}

test('both vector stages still intersect with the live candidate paths', () => {
  // This is what makes an exact scan cheap AND what makes a stale embedding row
  // harmless: a vector whose note was deleted can never be in `docs`, so it can
  // never surface. Dropping the filter would turn the orphan-prune from a
  // storage concern into a correctness one.
  assert.match(vectorStage, /path IN \(\$\{Prisma\.join\(paths\)\}\)/)
  assert.match(sourceStage, /path IN \(\$\{Prisma\.join\(visiblePaths\)\}\)/)
})
