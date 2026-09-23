/**
 * A session is the one token on AUTH_SECRET that logs someone in. The others
 * signed with the same key (lib/resources/uploadToken.ts, the connector OAuth
 * pending cookie, the CRM claim) name a user too, so verifySession must refuse
 * anything that marks a purpose: an audience or a type.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/session-purpose-tokens.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { SignJWT } from 'jose'

process.env.AUTH_SECRET ??= 'test-secret-for-session-purpose-tests-0123456789'

import { createSession, verifySession } from '@/lib/session'
import { mintUploadToken, verifyUploadToken } from '@/lib/resources/uploadToken'

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET)

test('a session verifies as a session', async () => {
  const token = await createSession({ userId: 'user_1', name: 'Ana', email: 'ana@example.com' })
  const session = await verifySession(token)
  assert.equal(session?.userId, 'user_1')
})

test('an upload token is not a session', async () => {
  const { token } = await mintUploadToken({ userId: 'user_1', spaceId: 'space_1', folderId: null })
  assert.equal((await verifyUploadToken(token))?.userId, 'user_1')
  assert.equal(await verifySession(token), null)
})

test('a session is not an upload token', async () => {
  const token = await createSession({ userId: 'user_1', name: 'Ana', email: 'ana@example.com' })
  assert.equal(await verifyUploadToken(token), null)
})

test('a token typed for another purpose is not a session', async () => {
  for (const claim of [{ typ: 'connector_oauth_pending' }, { type: 'claim' }]) {
    const token = await new SignJWT({ userId: 'user_1', ...claim })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(secret())
    assert.equal(await verifySession(token), null)
  }
})

test('a token with no user is not a session', async () => {
  const token = await new SignJWT({ name: 'Ana' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(secret())
  assert.equal(await verifySession(token), null)
})
