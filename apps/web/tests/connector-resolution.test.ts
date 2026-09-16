/**
 * Where a connector name resolves to — and therefore whose account a run
 * spends. Against a real Postgres, because the whole behaviour is two note
 * lookups in two spaces.
 *
 * Same local-only guard as tests/agents-tick.test.ts: the LOCAL Docker
 * database (`apps/web/.env` DATABASE_URL, host localhost/127.0.0.1 only), and
 * a loud SKIP rather than a silent pass when there isn't one.
 *
 * Covered:
 *   • a connector that exists only in the caller's personal space resolves in
 *     a shared space they are in, carrying THEIR space for secrets, linked
 *     account, budget and audit;
 *   • the space's own note wins its name, so a personal one can never displace
 *     an admin's configuration;
 *   • `personal: false` (the Tools bridge, the console's test run) does not
 *     fall back;
 *   • one person's connector is not another's, and a system pass has none.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

function localDatabaseUrl(): string | null {
  const fromEnv = process.env.DATABASE_URL
  let url = fromEnv ?? null
  if (!url) {
    try {
      const env = readFileSync(join(root, '.env'), 'utf8')
      const m = env.match(/^DATABASE_URL=(.+)$/m)
      url = m ? m[1].trim().replace(/^["']|["']$/g, '') : null
    } catch {
      url = null
    }
  }
  if (!url) return null
  try {
    const host = new URL(url).hostname
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== 'visvine-postgres') return null
  } catch {
    return null
  }
  return url
}

const dbUrl = localDatabaseUrl()
if (dbUrl && !process.env.DATABASE_URL) process.env.DATABASE_URL = dbUrl
if (!process.env.SECRETS_KEY) process.env.SECRETS_KEY = 'ff'.repeat(32)

type Prisma = typeof import('@/lib/prisma').default
let prisma: Prisma | null = null
let probed: Promise<string | null> | null = null

function probe(): Promise<string | null> {
  if (probed) return probed
  probed = (async () => {
    if (!dbUrl) return 'no local DATABASE_URL (apps/web/.env) — connector resolution tests need the Docker Postgres'
    try {
      prisma = (await import('@/lib/prisma')).default
      await prisma.$queryRaw`SELECT 1`
      return null
    } catch (e) {
      prisma = null
      return `local Postgres not reachable (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`
    }
  })()
  return probed
}

// The service is imported lazily, INSIDE the tests: a static import is hoisted
// above the DATABASE_URL assignment above, so lib/prisma would be constructed
// against the fallback connection string before this file's first statement
// runs. Everything imported statically here is pure.
const service = () => import('@/lib/connectors/service')
import { OPEN_ACCESS } from '@/lib/notes/shared/authz'
import { personalSpaceId } from '@/lib/spaces/personalSpaceAccess'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'

// ── fixtures ────────────────────────────────────────────────────────────────

const SPACE = `test-conn-space-${process.pid}`
const MINE = `test-conn-user-${process.pid}`
const OTHER = `test-conn-other-${process.pid}`
const MY_SPACE = personalSpaceId(MINE)
const OTHER_SPACE = personalSpaceId(OTHER)

const NOTE = (title: string, host: string) =>
  `---\ntype: connector\ntitle: "${title}"\nhosts:\n  - ${host}\ntimeout_ms: 30000\n---\n\n${title}\n`

const shared = { spaceId: SPACE, ownerKey: 'shared' as const }

function principal(userId: string, spaceId: string, system = false): ContextPrincipal {
  return { userId, email: `${userId}@local.test`, name: userId, spaceId, spaceAdmin: true, access: OPEN_ACCESS, system }
}

async function setup() {
  const p = prisma!
  await teardown()
  for (const [id, name] of [
    [SPACE, 'connector resolution test'],
    [MY_SPACE, 'mine'],
    [OTHER_SPACE, 'theirs'],
  ]) {
    await p.space.create({ data: { id, name, timezone: 'UTC' } })
  }
  for (const id of [MINE, OTHER]) {
    await p.user.create({ data: { id, email: `${id}@local.test`, name: id } })
    await p.spaceMember.create({ data: { spaceId: SPACE, userId: id } })
  }
  const note = (spaceId: string, content: string) =>
    p.contextNote.create({ data: { spaceId, ownerKey: 'shared', path: 'connectors/drive.md', content, createdBy: MINE } })
  await note(MY_SPACE, NOTE('My Drive', 'www.googleapis.com'))
  await note(OTHER_SPACE, NOTE('Their Drive', 'www.googleapis.com'))
}

async function teardown() {
  const p = prisma!
  const spaces = [SPACE, MY_SPACE, OTHER_SPACE]
  await p.contextNote.deleteMany({ where: { spaceId: { in: spaces } } })
  await p.spaceMember.deleteMany({ where: { spaceId: { in: spaces } } })
  await p.space.deleteMany({ where: { id: { in: spaces } } })
  await p.user.deleteMany({ where: { id: { in: [MINE, OTHER] } } })
}

// ── tests ───────────────────────────────────────────────────────────────────

test('a connector connected in Settings resolves in every space you are in', async (t) => {
  const skip = await probe()
  if (skip) return t.skip(skip)
  await setup()
  try {
    // The shared space has no `drive` note at all — this is the whole point:
    // one sign-in in Settings, and it works wherever you go.
    const loaded = await (await service()).loadConnector(principal(MINE, SPACE), shared, 'drive')
    assert.ok(loaded, 'the caller’s own connector resolved')
    assert.equal(loaded.personal, true)
    // Its OWN space, so the secrets, the linked account, the run budget and the
    // audit line are all the person's rather than the space's.
    assert.equal(loaded.spaceId, MY_SPACE)
    assert.equal(loaded.principal.userId, MINE)
    assert.equal(loaded.principal.spaceId, MY_SPACE)
    // The name and email survive the swap, so the audit line still says who ran it.
    assert.equal(loaded.principal.email, `${MINE}@local.test`)

    // …and asking from inside your own space is the ordinary, non-personal read.
    const athome = await (await service()).loadConnector(principal(MINE, MY_SPACE), { spaceId: MY_SPACE, ownerKey: 'shared' }, 'drive')
    assert.ok(athome)
    assert.equal(athome.personal, false)
    assert.equal(athome.spaceId, MY_SPACE)
  } finally {
    await teardown()
  }
})

test('the space’s own connector wins its name', async (t) => {
  const skip = await probe()
  if (skip) return t.skip(skip)
  await setup()
  try {
    await prisma!.contextNote.create({
      data: { spaceId: SPACE, ownerKey: 'shared', path: 'connectors/drive.md', content: NOTE('Team Drive', 'drive.example.com'), createdBy: MINE },
    })
    const loaded = await (await service()).loadConnector(principal(MINE, SPACE), shared, 'drive')
    assert.ok(loaded)
    // An admin who configured this decided what its agents reach and whose
    // credentials they use; a personal note must never quietly displace it.
    assert.equal(loaded.personal, false)
    assert.equal(loaded.spaceId, SPACE)
    assert.deepEqual([...loaded.perimeter.hosts], ['drive.example.com'])
  } finally {
    await teardown()
  }
})

test('the fallback is off for code the person did not choose to run', async (t) => {
  const skip = await probe()
  if (skip) return t.skip(skip)
  await setup()
  try {
    // A Tool renders for whoever opens the page; a maintenance pass acts for
    // nobody. Neither may spend a viewer's own accounts.
    assert.equal(await (await service()).loadConnector(principal(MINE, SPACE), shared, 'drive', { personal: false }), null)
    assert.equal(await (await service()).loadConnector(principal(MINE, SPACE, true), shared, 'drive'), null)
  } finally {
    await teardown()
  }
})

test('one person’s connector is never another’s', async (t) => {
  const skip = await probe()
  if (skip) return t.skip(skip)
  await setup()
  try {
    const mine = await (await service()).loadConnector(principal(MINE, SPACE), shared, 'drive')
    const theirs = await (await service()).loadConnector(principal(OTHER, SPACE), shared, 'drive')
    assert.ok(mine && theirs)
    // Same name, same space, two different notes and two different tenants —
    // resolution runs through the person the run acts as, and only them.
    assert.equal(mine.spaceId, MY_SPACE)
    assert.equal(theirs.spaceId, OTHER_SPACE)
    assert.notEqual(mine.spaceId, theirs.spaceId)
  } finally {
    await teardown()
  }
})

test('a connector filed in a folder of the space’s own is the same connector', async (t) => {
  const skip = await probe()
  if (skip) return t.skip(skip)
  await setup()
  try {
    // A space that files its connectors by team has moved the note, not the
    // connector (lib/notes/shared/configKinds.ts): the name is the file name,
    // and every reader finds it where it is.
    await prisma!.contextNote.create({
      data: { spaceId: SPACE, ownerKey: 'shared', path: 'teams/growth/hubspot.md', content: NOTE('HubSpot', 'api.hubapi.com'), createdBy: MINE },
    })
    const locate = await import('@/lib/connectors/locate')
    assert.equal(await locate.connectorNotePathIn(shared, 'hubspot'), 'teams/growth/hubspot.md')
    assert.equal(await locate.connectorNotePathIn(shared, 'drive'), null)
    assert.deepEqual((await locate.connectorNoteRows(shared)).map((r) => [r.name, r.path]), [['hubspot', 'teams/growth/hubspot.md']])

    const loaded = await (await service()).loadConnector(principal(MINE, SPACE), shared, 'hubspot')
    assert.ok(loaded, 'the moved connector loads by name')
    assert.equal(loaded.spaceId, SPACE)
    assert.equal(loaded.personal, false)
    assert.deepEqual([...loaded.perimeter.hosts], ['api.hubapi.com'])

    const listed = await (await service()).listConnectors(principal(MINE, SPACE), shared)
    assert.deepEqual(listed.map((c) => [c.name, c.path]), [['hubspot', 'teams/growth/hubspot.md']])
    const described = await (await service()).describeConnector(principal(MINE, SPACE), shared, 'hubspot')
    assert.equal(described?.path, 'teams/growth/hubspot.md')

    // The built-in folder still wins its name over a copy elsewhere — the
    // tie rule for data written before the write gate refused the second.
    await prisma!.contextNote.create({
      data: { spaceId: SPACE, ownerKey: 'shared', path: 'connectors/hubspot.md', content: NOTE('HubSpot at home', 'home.example.com'), createdBy: MINE },
    })
    assert.equal(await locate.connectorNotePathIn(shared, 'hubspot'), 'connectors/hubspot.md')
  } finally {
    await teardown()
  }
})

test('the write gate follows the declaration: a connector is the admin’s wherever it sits', async (t) => {
  const skip = await probe()
  if (skip) return t.skip(skip)
  await setup()
  try {
    const { configKindDenial, folderConfigKindDenial } = await import('@/lib/notes/contextService')
    const admin = principal(MINE, SPACE)
    const member: ContextPrincipal = { ...principal(OTHER, SPACE), spaceAdmin: false }
    const hubspot = NOTE('HubSpot', 'api.hubapi.com')
    await prisma!.contextNote.create({
      data: { spaceId: SPACE, ownerKey: 'shared', path: 'teams/growth/hubspot.md', content: hubspot, createdBy: MINE },
    })

    // A member with edit rights in teams/ still cannot mint, edit, strip or
    // delete a connector there.
    assert.match((await configKindDenial(member, shared, 'teams/growth/slack.md', NOTE('Slack', 'slack.com'), { current: null }))!, /Only space admins/)
    assert.match((await configKindDenial(member, shared, 'teams/growth/hubspot.md', hubspot))!, /Only space admins/)
    assert.match((await configKindDenial(member, shared, 'teams/growth/hubspot.md', '---\ntitle: HubSpot\n---\n'))!, /Only space admins/)
    assert.match((await configKindDenial(member, shared, 'teams/growth/hubspot.md', null))!, /Only space admins/)
    assert.match((await folderConfigKindDenial(member, shared, 'teams/growth'))!, /holds the connector/)
    assert.equal(await folderConfigKindDenial(admin, shared, 'teams/growth'), null)
    // An ordinary note of theirs is untouched by this gate.
    assert.equal(await configKindDenial(member, shared, 'teams/growth/plan.md', '---\ntitle: Plan\n---\n', { current: null }), null)

    // An admin: anywhere a connector may sit, under its own name, once.
    assert.equal(await configKindDenial(admin, shared, 'teams/growth/hubspot.md', hubspot), null)
    assert.equal(await configKindDenial(admin, shared, 'ops/hubspot.md', null, { movingFrom: 'teams/growth/hubspot.md' }), null)
    assert.equal(await configKindDenial(admin, shared, 'connectors/hubspot.md', null, { movingFrom: 'teams/growth/hubspot.md' }), null)
    assert.match((await configKindDenial(admin, shared, 'people/craig/hubspot.md', null, { movingFrom: 'teams/growth/hubspot.md' }))!, /built-in folders/)
    assert.match((await configKindDenial(admin, shared, 'ops/hubspot-2.md', null, { movingFrom: 'teams/growth/hubspot.md' }))!, /name is its file name/)
    assert.match((await configKindDenial(admin, shared, 'ops/hubspot.md', NOTE('Another HubSpot', 'api.hubapi.com'), { current: null }))!, /already exists at teams\/growth\/hubspot\.md/)
    // A `me:<userId>` space is administered by its owner (resolveContext
    // stamps them admin), so their own write passes the same gate.
    assert.equal(await configKindDenial(principal(OTHER, OTHER_SPACE), { spaceId: OTHER_SPACE, ownerKey: 'shared' }, 'connectors/x.md', hubspot), null)
  } finally {
    await teardown()
  }
})
