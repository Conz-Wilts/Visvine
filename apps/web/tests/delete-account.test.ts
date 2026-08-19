import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Coverage guard for lib/account/deleteAccount.ts.
 *
 * The service can't be unit-tested against a database here, but its one real
 * failure mode is a missed table — a person's rows are scattered across models
 * that key them by a plain scalar (`owner_key`, `user_id`) with no foreign key
 * for Postgres to cascade. So this reads the schema, works out which models
 * those are, and asserts the service names each one. Add a table keyed that way
 * and this fails until account deletion is taught about it.
 */

// tsx compiles this to CJS, so `import.meta.dirname` is undefined — `__dirname`
// is the one that survives either module format.
const root = join(__dirname, '..')
const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8')
const service = readFileSync(join(root, 'lib/account/deleteAccount.ts'), 'utf8')

interface Model {
  name: string
  body: string
}

function models(): Model[] {
  const out: Model[] = []
  const re = /^model (\w+) \{([\s\S]*?)^\}/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(schema))) out.push({ name: m[1], body: m[2] })
  return out
}

/** `SpaceNote` → `spaceNote`, the prisma delegate the service calls. */
function delegate(name: string): string {
  return name[0].toLowerCase() + name.slice(1)
}

function fieldLines(body: string): string[] {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('///') && !l.startsWith('@@'))
}

const all = models()

test('every ownerKey-scoped model is cleared by deleteAccount', () => {
  const owned = all.filter((m) => fieldLines(m.body).some((l) => /^ownerKey\s/.test(l)))

  // Sanity: the personal-context tables exist and the regex found them.
  assert.ok(owned.length >= 5, `expected several ownerKey models, found ${owned.length}`)

  for (const m of owned) {
    assert.match(
      service,
      new RegExp(`\\.${delegate(m.name)}\\.deleteMany`),
      `${m.name} is keyed by ownerKey but deleteAccount never clears it`,
    )
  }
})

test('every userId-scoped model without a cascading User FK is cleared by deleteAccount', () => {
  const orphans = all.filter((m) => {
    const lines = fieldLines(m.body)
    if (!lines.some((l) => /^userId\s/.test(l))) return false
    // A `user User @relation(...onDelete: Cascade)` means Postgres handles it
    // when the User row goes; anything else is left behind for us to delete.
    return !lines.some((l) => /references:\s*\[id\]/.test(l) && /onDelete:\s*Cascade/.test(l) && /User/.test(l))
  })

  assert.ok(orphans.length > 0, 'expected at least UserAlias / Person / Identity here')

  for (const m of orphans) {
    if (REDACTED_BY_DESIGN.has(m.name)) {
      assert.match(
        service,
        new RegExp(`\\.${delegate(m.name)}\\.updateMany`),
        `${m.name} is on the redaction list but deleteAccount never redacts it`,
      )
      continue
    }
    assert.match(
      service,
      new RegExp(`\\.${delegate(m.name)}\\.delete(Many)?`),
      `${m.name} keys a userId with no cascading FK but deleteAccount never clears it`,
    )
  }
})

/**
 * Models where the person is scrubbed OUT of the row but the row survives.
 * An allowlist, not a loophole: a new table cannot opt out of deletion by
 * accident, only by being named here deliberately.
 */
const REDACTED_BY_DESIGN = new Set(['ContextAuditEntry'])

test('the audit trail is redacted on account deletion, never deleted', () => {
  // If deleting an account erased its audit entries, deleting an account would
  // be how you erase your own trail — the one thing an audit log exists to
  // prevent. The event stays; the person in it goes.
  assert.match(service, /\.contextAuditEntry\.updateMany/)
  assert.doesNotMatch(service, /\.contextAuditEntry\.delete/)
})

test('queued move proposals are deleted with the account', () => {
  // The coverage guard above structurally cannot see this one: the column is
  // `proposedBy`, not `userId`. The row holds a full snapshot of a note from
  // the person's PERSONAL context, so it is their data wherever it sits.
  assert.match(service, /\.contextMoveProposal\.deleteMany/)
})

test('deleteAccount deletes the User row last', () => {
  const userDelete = service.indexOf('tx.user.delete(')
  assert.ok(userDelete > 0, 'the User row is never deleted')
  assert.ok(
    service.indexOf('tx.person.deleteMany(') < userDelete,
    'Person must go before User — its FK is SET NULL, so the profile would be orphaned',
  )
  assert.ok(
    service.indexOf('tx.identity.deleteMany(') < userDelete,
    'Identity must go before User; it is looked up by userId',
  )
})
