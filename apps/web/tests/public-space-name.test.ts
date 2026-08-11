// The pure half of the public-space-name rule (lib/communities/publicName.ts):
// what counts as the same name, and what a space's name/visibility will BE once
// a partial settings patch lands. The DB half (findPublicNameConflict) is a thin
// query over those two.
// Run: node --import tsx --test tests/public-space-name.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePublicName,
  effectiveNameAndVisibility,
  publicNameTakenMessage,
} from '../lib/communities/publicName';

describe('normalizePublicName', () => {
  it('ignores case and surrounding whitespace', () => {
    assert.equal(normalizePublicName('  Blackbird VC '), 'blackbird vc');
    assert.equal(normalizePublicName('BLACKBIRD VC'), normalizePublicName('blackbird vc'));
  });

  it('collapses runs of internal whitespace, including tabs and newlines', () => {
    assert.equal(normalizePublicName('Blackbird   VC'), 'blackbird vc');
    assert.equal(normalizePublicName('Blackbird\tVC'), 'blackbird vc');
    assert.equal(normalizePublicName('Blackbird\nVC'), 'blackbird vc');
  });

  it('keeps genuinely different names apart', () => {
    assert.notEqual(normalizePublicName('Founders'), normalizePublicName('Founders NZ'));
    assert.notEqual(normalizePublicName('Founders'), normalizePublicName('Founder'));
  });

  it('yields an empty key for a blank name (nothing to conflict with)', () => {
    assert.equal(normalizePublicName('   '), '');
  });
});

describe('effectiveNameAndVisibility', () => {
  const publicSpace = { name: 'Founders', visibility: 'public' };
  const privateSpace = { name: 'Founders', visibility: 'private' };

  it('treats a name-only patch on a public space as a public name', () => {
    const next = effectiveNameAndVisibility({ name: 'Founders NZ' }, publicSpace);
    assert.deepEqual(next, { name: 'Founders NZ', isPublic: true });
  });

  it('leaves a name-only patch on a private space unchecked', () => {
    const next = effectiveNameAndVisibility({ name: 'Founders NZ' }, privateSpace);
    assert.equal(next.isPublic, false);
  });

  it('carries the existing name into a visibility-only patch', () => {
    const next = effectiveNameAndVisibility({ visibility: 'public' }, privateSpace);
    assert.deepEqual(next, { name: 'Founders', isPublic: true });
  });

  it('applies both fields when the patch sets both', () => {
    const next = effectiveNameAndVisibility({ name: '  Founders NZ  ', visibility: 'public' }, privateSpace);
    assert.deepEqual(next, { name: 'Founders NZ', isPublic: true });
  });

  it('going private is never a name conflict', () => {
    const next = effectiveNameAndVisibility({ visibility: 'private' }, publicSpace);
    assert.equal(next.isPublic, false);
  });

  it('tolerates a null visibility (pre-default rows) as not public', () => {
    const next = effectiveNameAndVisibility({}, { name: 'Founders', visibility: null });
    assert.equal(next.isPublic, false);
  });
});

describe('publicNameTakenMessage', () => {
  it('names the space that holds it and what to do about it', () => {
    const msg = publicNameTakenMessage('Founders');
    assert.match(msg, /Founders/);
    assert.match(msg, /different name/i);
  });
});
