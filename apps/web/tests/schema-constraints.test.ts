import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Coverage guard for the CHECK constraints added in
 * 20260824120200_enum_check_constraints.
 *
 * A column whose comment enumerates its values ("pending | ready | failed") is
 * an enum that the database does not know is an enum. Before that migration
 * there were two CHECK constraints in the entire schema, so every one of those
 * columns would happily store a typo — committed, durable, and surfacing later
 * as a reader that silently skips the row.
 *
 * Adding constraints once fixes the columns that existed that day. This test is
 * what stops the next one from arriving unconstrained: it reads the schema,
 * finds every column whose comment enumerates alternatives, and asserts a
 * constraint exists for it. A new enum-ish column fails this until it is either
 * constrained or deliberately exempted below.
 *
 * It earns its keep immediately. Four column comments were already wrong when
 * the constraints were written: `context_sources.kind`, `agent_runs.trigger`,
 * `identity_resolutions.decision` — which only surfaced when
 * `pnpm db:constraints:validate` hit 624 real rows holding a value the comment
 * did not mention — and `agent_state.deactivatedReason`, which THIS TEST found
 * by failing on the first run, before the migration had ever left the branch.
 */

const root = join(__dirname, '..')
const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8')
const migrations = join(root, 'prisma/migrations')

const constraintSql = readdirSync(migrations)
  .filter((d) => !d.endsWith('.toml'))
  .map((d) => {
    try {
      return readFileSync(join(migrations, d, 'migration.sql'), 'utf8')
    } catch {
      return ''
    }
  })
  .join('\n')

/**
 * Columns that enumerate values in a comment but are deliberately NOT
 * constrained. An allowlist, not a loophole — a column cannot opt out by
 * accident, only by being named here with a reason.
 */
const EXEMPT = new Map<string, string>([
  // Open vocabularies: the space defines these, not the code. A CHECK would
  // make adding a node type or a relationship a migration.
  ['Node.type', 'space-defined vocabulary (Space.nodeTypes)'],
  ['Link.relationship', 'space-defined vocabulary (Space.linkTypes)'],
  ['ContextState.name', 'sidecar filenames, extended by feature not by schema'],
  ['ConnectorSecret.name', 'user-chosen secret names'],
  // Provider-shaped values we do not own.
  ['ContextNoteRevision.model', 'provider/model ids'],
  ['NoteProjectionJob.model', 'provider/model ids'],
  ['ContextSource.mimeType', 'IANA media types'],
  ['Resource.fileType', 'display bucket derived from the extension'],
  // Free text that happens to contain a pipe in its comment.
  ['AgentRun.terminalReason', 'TerminalReason is wide and grows with the runner'],
])

interface Column {
  model: string
  field: string
  table: string
  comment: string
}

/** `spaces` from `@@map("spaces")`, else the model name. */
function tableOf(modelName: string, body: string): string {
  const m = body.match(/@@map\("([^"]+)"\)/)
  return m ? m[1] : modelName
}

/** Every String/Int column whose trailing comment enumerates `a | b | c`. */
function enumishColumns(): Column[] {
  const out: Column[] = []
  const modelRe = /^model (\w+) \{([\s\S]*?)^\}/gm
  let m: RegExpExecArray | null
  while ((m = modelRe.exec(schema))) {
    const [, model, body] = m
    const table = tableOf(model, body)
    for (const raw of body.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('//') || line.startsWith('///') || line.startsWith('@@')) continue
      const field = line.match(/^(\w+)\s+(String|Int)\b/)
      if (!field) continue
      const comment = line.slice(line.indexOf('//') + 2).trim()
      if (!line.includes('//')) continue
      // "a | b" — at least two alternatives, all short bare words. This is what
      // an enum written as a comment looks like; prose with a pipe in it is not.
      const alts = comment.split('|').map((s) => s.trim())
      if (alts.length < 2) continue
      if (!alts.every((a) => /^'?[\w-]{1,24}'?$/.test(a.split(/\s+/)[0] ?? ''))) continue
      out.push({ model, field: field[1], table, comment })
    }
  }
  return out
}

const columns = enumishColumns()

test('the schema still has enum-ish columns to check (the detector works)', () => {
  assert.ok(columns.length >= 10, `detector found only ${columns.length} columns — it has stopped working`)
})

test('every enum-ish column is constrained or deliberately exempt', () => {
  const missing: string[] = []
  for (const c of columns) {
    const key = `${c.model}.${c.field}`
    if (EXEMPT.has(key)) continue
    // The constraints are named "<table>_<column>_check", with the column in
    // snake_case as it appears in the database.
    const snake = c.field.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`)
    const pattern = new RegExp(`ADD CONSTRAINT "${c.table}_(${c.field}|${snake})_check"`)
    if (!pattern.test(constraintSql)) missing.push(`${key} (${c.comment})`)
  }
  assert.deepEqual(
    missing,
    [],
    'these columns enumerate their values in a comment but nothing enforces them.\n' +
      'Add a CHECK constraint in a migration, or add the column to EXEMPT with a reason:\n  ' +
      missing.join('\n  '),
  )
})

test('an exemption names a column that actually exists', () => {
  // Otherwise the allowlist silently rots into a list of columns that were
  // renamed away, and the next real exemption hides among them.
  const known = new Set(columns.map((c) => `${c.model}.${c.field}`))
  const allFields = new Set<string>()
  const modelRe = /^model (\w+) \{([\s\S]*?)^\}/gm
  let m: RegExpExecArray | null
  while ((m = modelRe.exec(schema))) {
    for (const raw of m[2].split('\n')) {
      const f = raw.trim().match(/^(\w+)\s+\w+/)
      if (f) allFields.add(`${m[1]}.${f[1]}`)
    }
  }
  for (const key of EXEMPT.keys()) {
    assert.ok(allFields.has(key), `EXEMPT names ${key}, which is not a column in the schema`)
  }
  assert.ok(known.size > 0)
})

/**
 * The two migrations that add constraints. Both follow the same two rules, for
 * the same reason: deploy.yml migrates PRODUCTION before it builds the image, so
 * whatever these do runs unattended against live data with the old image still
 * serving.
 */
const CONSTRAINT_MIGRATIONS = [
  '20260824120200_enum_check_constraints',
  '20260824120100_user_reference_keys',
]

test('constraints are added NOT VALID so a migration cannot abort on legacy data', () => {
  // NOT VALID still creates the constraint's triggers in full — inserts and
  // updates are checked and ON DELETE CASCADE fires — and skips only the scan
  // proving EXISTING rows comply. So the protection lands immediately and the
  // only thing deferred is the audit, to db:constraints:validate, where it can
  // fail safely instead of aborting a deploy.
  let total = 0
  for (const name of CONSTRAINT_MIGRATIONS) {
    const file = readFileSync(join(migrations, name, 'migration.sql'), 'utf8')
    const adds = file.match(/ADD CONSTRAINT[\s\S]*?;/g) ?? []
    assert.ok(adds.length > 0, `${name}: expected constraints, found none`)
    for (const add of adds) {
      assert.match(add, /NOT VALID;/, `${name}: constraint added without NOT VALID:\n${add}`)
    }
    total += adds.length
  }
  assert.ok(total >= 25, `expected the full constraint batch, found ${total}`)
})

test('a constraint migration adds constraints and does not touch data', () => {
  // An earlier draft of the foreign-key migration DELETEd every row referencing
  // a missing user, so the constraint could be added valid. It looked like
  // tidiness and was not: unattended, destructive, and operating on a count
  // nobody had seen. A row referencing a long-gone user is broken, but "broken"
  // is a conclusion for a person to reach with the rows in front of them — not a
  // licence for a deploy step to delete data on its way past.
  // Anchored to the START of a statement. Unanchored, `ON DELETE CASCADE` and
  // `ON UPDATE CASCADE` inside a foreign-key definition read as data changes —
  // which is the opposite of what they are.
  const destructive = [
    /^\s*DELETE\s+FROM\b/im,
    /^\s*UPDATE\s+\w/im,
    /^\s*TRUNCATE\b/im,
    /^\s*DROP\s+TABLE\b/im,
  ]
  for (const name of CONSTRAINT_MIGRATIONS) {
    const file = readFileSync(join(migrations, name, 'migration.sql'), 'utf8')
    const statements = file
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
    for (const verb of destructive) {
      assert.doesNotMatch(
        statements,
        verb,
        `${name} modifies data. Constraint migrations add constraints; ` +
          'cleaning up what they reveal is db:constraints:validate plus a human.',
      )
    }
  }
})
