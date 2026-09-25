/**
 * Pulling a Tool back after approval (lib/tools/verdicts.ts): which installs a
 * withdrawn version or a held listing stops, that the gate runs where a
 * version is chosen (installability) and where it runs (resolveBridgeTarget),
 * and that an admin's lock on a Tool's rail row holds on the server.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { runDenial } from '@/lib/tools/verdicts'
import { installability } from '@/lib/tools/registry'
import { resolveBridgeTarget, type ResolvedTarget, type TargetDeps } from '@/lib/tools/target'
import { OPEN_ACCESS } from '@/lib/notes/shared/authz'
import type { BridgeError } from '@/lib/tools/protocol'
import type { ResolvedContext } from '@/lib/notes/resolve'
import type { SessionPayload } from '@/lib/session'

const HOUSE = 'space-house'
const ROOM = 'space-room'
const STRANGER = 'space-stranger'

const standing = { revokedAt: null, revokeReason: null }
const withdrawn = { revokedAt: new Date('2026-09-20'), revokeReason: 'leaked a note' }

test('a withdrawn version stops everywhere, rooms and strangers included', () => {
  for (const installSpaceId of [HOUSE, ROOM, STRANGER]) {
    const denial = runDenial({
      version: withdrawn,
      listing: null,
      sourceSpaceId: HOUSE,
      installSpaceId,
      sharedFromSpaceId: installSpaceId === ROOM ? HOUSE : null,
    })
    assert.equal(denial?.code, 'revoked', installSpaceId)
    assert.match(denial!.message, /Withdrawn by the space that made it — leaked a note/)
  }
})

test('a held listing stops installs outside the family, never the family', () => {
  const suspended = { state: 'suspended' as const, stateReason: 'under review' }
  assert.equal(runDenial({ version: standing, listing: suspended, sourceSpaceId: HOUSE, installSpaceId: HOUSE }), null)
  assert.equal(
    runDenial({ version: standing, listing: suspended, sourceSpaceId: HOUSE, installSpaceId: ROOM, sharedFromSpaceId: HOUSE }),
    null,
    'a room running its house’s Tool got it from its family, not the listing',
  )
  const stranger = runDenial({ version: standing, listing: suspended, sourceSpaceId: HOUSE, installSpaceId: STRANGER })
  assert.equal(stranger?.code, 'revoked')
  assert.match(stranger!.message, /^Suspended by Visvine — under review$/)
  const removed = runDenial({
    version: standing,
    listing: { state: 'revoked', stateReason: null },
    sourceSpaceId: HOUSE,
    installSpaceId: STRANGER,
  })
  assert.equal(removed?.message, 'Removed by Visvine')
  assert.equal(
    runDenial({ version: standing, listing: { state: 'active', stateReason: null }, sourceSpaceId: HOUSE, installSpaceId: STRANGER }),
    null,
  )
})

test('installability refuses a withdrawn version, and a held listing outside its space', () => {
  const base = { status: 'approved' as const, marketplaceStatus: 'approved' as const, sourceSpaceId: HOUSE }
  assert.equal(installability({ ...base, spaceId: HOUSE, revoked: true }).ok, false)
  assert.equal(installability({ ...base, spaceId: STRANGER, revoked: true }).ok, false)
  assert.equal(installability({ ...base, spaceId: STRANGER, listingState: 'suspended' }).ok, false)
  assert.equal(installability({ ...base, spaceId: STRANGER, listingState: 'revoked' }).ok, false)
  assert.equal(installability({ ...base, spaceId: HOUSE, listingState: 'suspended' }).ok, true, 'its own space still installs it')
  assert.equal(installability({ ...base, spaceId: STRANGER, listingState: 'active' }).ok, true)
})

// ── at the door ──────────────────────────────────────────────────────────────

const SESSION: SessionPayload = { userId: 'user-1', name: 'Viewer', email: 'viewer@local.dev' }

function resolved(over: Partial<ResolvedContext> = {}): ResolvedContext {
  return {
    spaceId: STRANGER,
    ownerKey: 'shared',
    scope: 'shared',
    isAdmin: false,
    isPersonalSpace: false,
    actor: { id: 'user-1', name: 'Viewer', email: 'viewer@local.dev' },
    ...over,
  }
}

function installRow(over: { version?: Record<string, unknown>; spaceId?: string; sharedFromSpaceId?: string | null } = {}) {
  return {
    id: 'install-1',
    versionId: 'version-1',
    spaceId: over.spaceId ?? STRANGER,
    slug: 'deals',
    key: `${HOUSE}/deals`,
    enabled: true,
    requirements: {},
    sharedFromSpaceId: over.sharedFromSpaceId ?? null,
    version: {
      name: 'deals',
      title: 'Deals',
      config: { title: 'Deals' },
      perimeter: {},
      dataBundle: '',
      sourceSpaceId: HOUSE,
      revokedAt: null,
      revokeReason: null,
      ...over.version,
    },
  }
}

function deps(over: Partial<TargetDeps> = {}): TargetDeps {
  return {
    findInstall: async () => installRow(),
    findBuild: async () => null,
    resolveContext: async () => resolved(),
    principalOf: async (r) => ({
      userId: r.actor.id,
      email: r.actor.email ?? '',
      name: r.actor.name,
      spaceId: r.spaceId,
      spaceAdmin: r.isAdmin,
      access: OPEN_ACCESS,
    }),
    readVisible: async () => null,
    featureAccessForbidden: async () => false,
    listingHold: async () => null,
    ...over,
  }
}

async function refusal(d: TargetDeps): Promise<BridgeError> {
  const answer = await resolveBridgeTarget(SESSION, { kind: 'install', installId: 'install-1' }, d)
  assert.ok('code' in answer, `expected a refusal, got ${JSON.stringify(answer).slice(0, 200)}`)
  return answer as BridgeError
}

test('a withdrawn version is refused at the door with `revoked`', async () => {
  const error = await refusal(deps({ findInstall: async () => installRow({ version: withdrawn }) }))
  assert.equal(error.code, 'revoked')
})

test('a suspended listing is refused outside the family, and its hold is read on every call', async () => {
  let asked = 0
  const error = await refusal(
    deps({
      listingHold: async () => {
        asked++
        return { state: 'suspended', stateReason: null }
      },
    }),
  )
  assert.equal(error.code, 'revoked')
  assert.equal(asked, 1)
})

test('the publisher’s own install never asks for the listing', async () => {
  const answer = await resolveBridgeTarget(
    SESSION,
    { kind: 'install', installId: 'install-1' },
    deps({
      findInstall: async () => installRow({ spaceId: HOUSE }),
      resolveContext: async () => resolved({ spaceId: HOUSE }),
      listingHold: async () => assert.fail('the source space is not held by its listing'),
    }),
  )
  assert.equal('code' in answer, false)
  assert.equal((answer as ResolvedTarget).versionId, 'version-1')
})

test('an admin-only Tool refuses a member at the bridge, not only in the browser', async () => {
  const asked: string[] = []
  const error = await refusal(
    deps({
      featureAccessForbidden: async (_user, _space, key) => {
        asked.push(key)
        return key === 'tool:deals'
      },
    }),
  )
  assert.equal(error.code, 'forbidden')
  assert.match(error.message, /for admins/)
  assert.deepEqual(asked, ['directory', 'tool:deals'])
})
