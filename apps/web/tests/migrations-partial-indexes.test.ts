import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guard for the indexes Prisma cannot express.
 *
 * A partial index — `CREATE INDEX … WHERE …` — has no representation in
 * `schema.prisma`, so it exists only in hand-written SQL. `prisma migrate dev`
 * diffs the schema against the database, sees an index it has no model for, and
 * writes a `DROP INDEX` for it into whatever migration it generates next. That
 * drop is silent, it lands in a migration about something else entirely, and it
 * replays into production on the next deploy.
 *
 * It has happened: 20260902050032_agent_state_brief_note_id opens with drops of
 * `agent_events_dedupe_key` and `agent_events_pending_idx`, and the first of
 * those is behavioural — `enqueueAgentEvent` collapses repeat events with
 * INSERT … ON CONFLICT DO NOTHING, which conflicts on nothing once the unique
 * index is gone. The drop shipped, and three tests in agents-tick failed for a
 * day before anyone read the migration.
 *
 * So: replay every migration in order and assert that each partial index some
 * migration deliberately created is still standing at the end. A regenerated
 * drop then fails here, in the diff that introduces it, rather than in a
 * database. Removing one on purpose is still allowed — delete its CREATE too.
 */

const migrations = join(__dirname, '..', 'prisma/migrations')

const CREATE = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/i
const DROP = /DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?"([^"]+)"/i

/** Statements, comments stripped so a commented-out DROP is not read as one. */
function statements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

test('a partial index a migration creates is never left dropped', () => {
  const files = readdirSync(migrations, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()

  // name → the migration that last created it, for the failure message.
  const alive = new Map<string, string>()
  // Every partial index this repo has ever created, so a drop of one that was
  // never re-created is what fails rather than a drop of some plain index.
  const partial = new Set<string>()

  for (const dir of files) {
    let sql: string
    try {
      sql = readFileSync(join(migrations, dir, 'migration.sql'), 'utf8')
    } catch {
      continue
    }
    for (const statement of statements(sql)) {
      const created = CREATE.exec(statement)
      if (created) {
        if (/\bWHERE\b/i.test(statement)) partial.add(created[1])
        alive.set(created[1], dir)
        continue
      }
      const dropped = DROP.exec(statement)
      if (dropped) alive.delete(dropped[1])
    }
  }

  const lost = [...partial].filter((name) => !alive.has(name))
  assert.deepEqual(
    lost,
    [],
    `partial index dropped and never re-created: ${lost.join(', ')} — ` +
      'if `prisma migrate dev` wrote that DROP, it did not mean it; recreate the index in a migration of its own',
  )
})

test('the agent_events mailbox keeps the indexes its behaviour depends on', () => {
  // Named explicitly, because the generic guard above only notices a drop of an
  // index some migration created — and the failure mode here is a CREATE that
  // gets deleted alongside its DROP in a well-meaning tidy-up.
  const sql = readdirSync(migrations, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((dir) => {
      try {
        return readFileSync(join(migrations, dir, 'migration.sql'), 'utf8')
      } catch {
        return ''
      }
    })

  const all = sql.flatMap(statements)
  for (const name of ['agent_events_dedupe_key', 'agent_events_pending_idx']) {
    const creates = all.filter((s) => CREATE.exec(s)?.[1] === name)
    const drops = all.filter((s) => DROP.exec(s)?.[1] === name)
    assert.ok(creates.length > drops.length, `${name} is dropped more often than it is created`)
    assert.ok(
      creates.every((s) => /\bWHERE\b/i.test(s)),
      `${name} must stay partial — a full index over dedupe_key would refuse rows the mailbox needs`,
    )
  }
})
