/**
 * The Tool frame token (lib/tools/frameToken.ts): the one credential a
 * cookie-less Tool frame carries. Round-trip, expiry, and the two ways a token
 * from somewhere else must be refused — wrong audience (a session JWT replayed
 * here) and a payload that does not describe a loadable Tool.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-frame-token.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { SignJWT } from 'jose'
import { FRAME_TOKEN_AUDIENCE, mintFrameToken, verifyFrameToken } from '@/lib/tools/frameToken'

// The key is read per call, not at import, so setting it here is enough.
process.env.AUTH_SECRET ??= 'test-secret-for-frame-token-tests-0123456789'

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET)

test('an install token round-trips', async () => {
  const token = await mintFrameToken({
    kind: 'install',
    installId: 'inst_1',
    spaceId: 'community:acme',
    viewerId: 'user_1',
  })
  assert.deepEqual(await verifyFrameToken(token), {
    kind: 'install',
    installId: 'inst_1',
    spaceId: 'community:acme',
    viewerId: 'user_1',
  })
})

test('a preview token round-trips', async () => {
  const token = await mintFrameToken({
    kind: 'preview',
    name: 'deal-pipeline',
    spaceId: 'community:acme',
    viewerId: 'user_1',
  })
  assert.deepEqual(await verifyFrameToken(token), {
    kind: 'preview',
    name: 'deal-pipeline',
    spaceId: 'community:acme',
    viewerId: 'user_1',
  })
})

test('an expired token is refused', async () => {
  const token = await mintFrameToken(
    { kind: 'install', installId: 'inst_1', spaceId: 'community:acme', viewerId: 'user_1' },
    -10,
  )
  assert.equal(await verifyFrameToken(token), null)
})

test('a token for another audience is refused', async () => {
  // The frame token shares AUTH_SECRET with the session, so `aud` is the only
  // thing stopping a stolen session JWT from being spent as a frame token.
  const sessionish = await new SignJWT({
    kind: 'install',
    installId: 'inst_1',
    spaceId: 'community:acme',
    viewerId: 'user_1',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(secret())
  assert.equal(await verifyFrameToken(sessionish), null, 'no audience at all')

  const wrongAud = await new SignJWT({
    kind: 'install',
    installId: 'inst_1',
    spaceId: 'community:acme',
    viewerId: 'user_1',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience('visvine-something-else')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(secret())
  assert.equal(await verifyFrameToken(wrongAud), null)
  assert.equal(FRAME_TOKEN_AUDIENCE, 'visvine-tool-frame')
})

test('a bad signature or a malformed payload is refused', async () => {
  const foreign = await new SignJWT({
    kind: 'install',
    installId: 'inst_1',
    spaceId: 'community:acme',
    viewerId: 'user_1',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(FRAME_TOKEN_AUDIENCE)
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode('a-different-signing-key-that-is-long-enough'))
  assert.equal(await verifyFrameToken(foreign), null)
  assert.equal(await verifyFrameToken('not-a-jwt'), null)
  assert.equal(await verifyFrameToken(''), null)

  // Right audience, right key, but the payload does not name something the
  // runtime could load — a missing field must be a rejection, not a route
  // handler holding a half-filled object.
  for (const payload of [
    { kind: 'install', spaceId: 'community:acme', viewerId: 'user_1' }, // no installId
    { kind: 'preview', spaceId: 'community:acme', viewerId: 'user_1' }, // no name
    { kind: 'install', installId: 'inst_1', viewerId: 'user_1' }, // no spaceId
    { kind: 'install', installId: 'inst_1', spaceId: 'community:acme' }, // no viewerId
    { kind: 'admin', installId: 'inst_1', spaceId: 'community:acme', viewerId: 'user_1' },
    { installId: 'inst_1', spaceId: 'community:acme', viewerId: 'user_1' }, // no kind
  ]) {
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience(FRAME_TOKEN_AUDIENCE)
      .setExpirationTime('5m')
      .sign(secret())
    assert.equal(await verifyFrameToken(token), null, JSON.stringify(payload))
  }
})
