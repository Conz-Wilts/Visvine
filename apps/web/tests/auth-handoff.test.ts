import test from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET ??= 'x'.repeat(48);

import {
  createHandoff,
  readHandoff,
  pkceChallenge,
  verifierMatches,
  isWellFormedChallenge,
} from '@/lib/auth/handoff';
import { createSession } from '@/lib/session';

test('a verifier only matches its own challenge', () => {
  const verifier = 'a'.repeat(64);
  const challenge = pkceChallenge(verifier);
  assert.equal(verifierMatches(verifier, challenge), true);
  assert.equal(verifierMatches('b'.repeat(64), challenge), false);
  assert.equal(verifierMatches(verifier, pkceChallenge('b')), false);
  assert.equal(verifierMatches('', challenge), false);
  assert.equal(verifierMatches(verifier, ''), false);
});

test('a challenge off the URL is base64url and sha256-sized', () => {
  assert.equal(isWellFormedChallenge(pkceChallenge('anything')), true);
  assert.equal(isWellFormedChallenge('short'), false);
  assert.equal(isWellFormedChallenge('+/='.padEnd(43, 'a')), false);
  assert.equal(isWellFormedChallenge(null), false);
});

test('a handoff carries the user and the challenge, and nothing else', async () => {
  const challenge = pkceChallenge('v');
  const token = await createHandoff({ userId: 'user_1', challenge }, 'desktop');
  const claims = await readHandoff(token, 'desktop');
  assert.deepEqual(claims, { userId: 'user_1', challenge });
});

test('a handoff signed with another secret is refused', async () => {
  const token = await createHandoff({ userId: 'user_1', challenge: pkceChallenge('v') }, 'desktop');
  const real = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'y'.repeat(48);
  assert.equal(await readHandoff(token, 'desktop'), null);
  process.env.AUTH_SECRET = real;
});

test('a session JWT is not a handoff', async () => {
  const session = await createSession({ userId: 'user_1', name: 'A', email: 'a@b.c' });
  // Same secret, same algorithm — the audience is what keeps the two apart, so
  // a stolen session cookie can never be replayed as a browser's approval.
  assert.equal(await readHandoff(session, 'desktop'), null);
  assert.equal(await readHandoff(session, 'mobile'), null);
});

test("one app's handoff is never redeemed at the other's door", async () => {
  const challenge = pkceChallenge('v');
  const mobile = await createHandoff({ userId: 'user_1', challenge }, 'mobile');
  const desktop = await createHandoff({ userId: 'user_1', challenge }, 'desktop');
  assert.deepEqual(await readHandoff(mobile, 'mobile'), { userId: 'user_1', challenge });
  assert.equal(await readHandoff(mobile, 'desktop'), null);
  assert.equal(await readHandoff(desktop, 'mobile'), null);
});

test('a session minted by a phone door carries the claim, and is still a session', async () => {
  const { verifySession } = await import('@/lib/session');
  const token = await createSession({ userId: 'user_1', name: 'A', email: 'a@b.c', cl: 'mobile' });
  const session = await verifySession(token);
  assert.equal(session?.userId, 'user_1');
  assert.equal(session?.cl, 'mobile');
});
