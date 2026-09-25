import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MOBILE_CALLBACK,
  mobileErrorUrl,
  mobileHandoffUrl,
  parseMobileState,
  safeInAppPath,
} from '@/lib/auth/mobileState';
import { pkceChallenge } from '@/lib/auth/handoff';

const challenge = pkceChallenge('verifier');

test('a return address other than the app is flagged, and the app’s own is fine', () => {
  const attacker = parseMobileState(JSON.stringify({ redirectUri: 'https://evil.example/steal', challenge }));
  assert.equal(attacker.foreignRedirect, true);
  const own = parseMobileState(JSON.stringify({ redirectUri: MOBILE_CALLBACK, challenge }));
  assert.equal(own.foreignRedirect, false);
  const none = parseMobileState(JSON.stringify({ challenge }));
  assert.equal(none.foreignRedirect, false);
  // Any other scheme or path is foreign too — a lookalike deep link included.
  assert.equal(parseMobileState(JSON.stringify({ redirectUri: 'visvine://auth/callback/x' })).foreignRedirect, true);
  assert.equal(parseMobileState(JSON.stringify({ redirectUri: 'visvine-evil://auth/callback' })).foreignRedirect, true);
});

test('the challenge is read only when it is sha256-sized base64url', () => {
  assert.equal(parseMobileState(JSON.stringify({ challenge })).challenge, challenge);
  assert.equal(parseMobileState(JSON.stringify({ challenge: 'short' })).challenge, null);
  assert.equal(parseMobileState(JSON.stringify({})).challenge, null);
});

test('state that is not JSON, or not an object, reads as empty', () => {
  for (const raw of [null, '', 'nope', '[]', '"x"', '42']) {
    const state = parseMobileState(raw);
    assert.equal(state.challenge, null);
    assert.equal(state.nonce, null);
    assert.equal(state.callbackUrl, '/home');
    assert.equal(state.foreignRedirect, false);
  }
  // A URL-encoded state (what an older client sent) still parses.
  assert.equal(parseMobileState(encodeURIComponent(JSON.stringify({ challenge }))).challenge, challenge);
});

test('callbackUrl is an in-app path or the default', () => {
  assert.equal(safeInAppPath('/directory'), '/directory');
  assert.equal(safeInAppPath('/s/acme/events'), '/s/acme/events');
  for (const bad of ['//evil.example', 'https://evil.example', '/a/../b', 'directory', '/a?b=c', '/a b', 42, null]) {
    assert.equal(safeInAppPath(bad), null, String(bad));
  }
  assert.equal(parseMobileState(JSON.stringify({ callbackUrl: '//evil.example' })).callbackUrl, '/home');
});

test('the nonce is echoed back on both links; the success link carries a handoff, never a token', () => {
  const state = parseMobileState(JSON.stringify({ state: 'n0nce-1234', challenge, callbackUrl: '/directory' }));
  const ok = new URL(mobileHandoffUrl('HANDOFF', state));
  assert.equal(`${ok.protocol}//${ok.host}${ok.pathname}`, MOBILE_CALLBACK);
  assert.equal(ok.searchParams.get('handoff'), 'HANDOFF');
  assert.equal(ok.searchParams.get('state'), 'n0nce-1234');
  assert.equal(ok.searchParams.get('callbackUrl'), '/directory');
  assert.equal(ok.searchParams.has('token'), false);

  const err = new URL(mobileErrorUrl('no_code', state));
  assert.equal(err.searchParams.get('error'), 'no_code');
  assert.equal(err.searchParams.get('state'), 'n0nce-1234');
});

test('a nonce outside its grammar is dropped', () => {
  assert.equal(parseMobileState(JSON.stringify({ state: 'a"><script>' })).nonce, null);
  assert.equal(parseMobileState(JSON.stringify({ state: 'short' })).nonce, null);
});
