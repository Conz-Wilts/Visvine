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

  assert.ok(orphans.length > 0, 'expected at least Identity / SpaceMember.addedBy here')

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
const REDACTED_BY_DESIGN = new Set(['ContextAuditEntry', 'AgentConfigChange', 'ResourceAccess'])

test('the audit trail is redacted on account deletion, never deleted', () => {
  // If deleting an account erased its audit entries, deleting an account would
  // be how you erase your own trail — the one thing an audit log exists to
  // prevent. The event stays; the person in it goes.
  assert.match(service, /\.contextAuditEntry\.updateMany/)
  assert.doesNotMatch(service, /\.contextAuditEntry\.delete/)
})

test('a Tool incident keeps its record and drops the viewer', () => {
  // `viewerId`, not `userId`, so the schema guard above cannot see it.
  assert.match(service, /\.appToolIncident\.updateMany\(\{ where: \{ viewerId: userId \}, data: \{ viewerId: null \} \}\)/)
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
    service.indexOf('tx.identity.deleteMany(') < userDelete,
    'Identity must go before User; it is looked up by userId',
  )
})

/**
 * The guards above reason about COLUMNS on tables, which is why they could not
 * see the widest gap of all: a whole TENANT keyed to the person.
 *
 * A personal space is `me:<userId>` with `personalOwnerId` set, and its notes
 * are stored with `ownerKey = 'shared'` INSIDE that space — the ownership lives
 * in the space id, not in the owner key. So the `ownerKey = userId` sweep never
 * matched one of them, `personalOwnerId` has no foreign key for a cascade to
 * follow, and closing an account left the space and every note in it standing,
 * owned by a user row that no longer existed.
 */
test('the personal space is deleted with the account', () => {
  assert.match(
    service,
    /personalOwnerId:\s*userId/,
    'deleteAccount must find personal spaces by personalOwnerId',
  )
  assert.match(
    service,
    /tx\.space\.deleteMany/,
    'deleteAccount must delete the personal space itself — its notes are ownerKey "shared" inside it',
  )
})

test('the personal space is exempt from the last-admin guard', () => {
  // Its owner being its only possible admin is the definition of a personal
  // space; running assertMembersCanLeave over it would refuse every deletion.
  assert.match(
    service,
    /personalIds\.has\(/,
    'the ownership guard must skip personal spaces or no account can ever be closed',
  )
})

test('bytes are purged before the rows that point at them', () => {
  // The media bucket is keyed by ENTITY id, so a node's images are only
  // findable while the node exists. Purging after the cascade would leave
  // objects that nothing can attribute to a tenant any more.
  const purge = service.indexOf('purgeSpaceObjects(')
  const rows = service.indexOf('prisma.$transaction')
  assert.ok(purge > 0, 'account deletion never purges GCS objects')
  assert.ok(rows > 0, 'expected the row deletion transaction')
  assert.ok(purge < rows, 'objects must be purged before the rows that identify them are deleted')
})
