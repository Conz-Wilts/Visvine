import test from 'node:test';
import assert from 'node:assert/strict';
import { familyIdentityFor } from '../lib/identity/family';

test('a name the rest of the family holds under one identity takes that identity', () => {
  assert.equal(
    familyIdentityFor({ name: 'Priya  Shah' }, [{ identityId: 'id-1', name: 'priya shah' }, { identityId: 'id-2', name: 'Sam' }]),
    'id-1',
  );
});

test('the same name under two identities is ambiguous and folds nothing', () => {
  assert.equal(
    familyIdentityFor({ name: 'Sam Lee' }, [{ identityId: 'id-1', name: 'Sam Lee' }, { identityId: 'id-2', name: 'Sam Lee' }]),
    null,
  );
});

test('the same identity seen under several names is still one match', () => {
  assert.equal(
    familyIdentityFor({ name: 'Dev Admin' }, [{ identityId: 'id-1', name: 'Dev Admin' }, { identityId: 'id-1', name: 'Dev Admin' }]),
    'id-1',
  );
});

test('a strong id of its own is left to the global resolver', () => {
  const family = [{ identityId: 'id-1', name: 'Priya Shah' }];
  assert.equal(familyIdentityFor({ name: 'Priya Shah', email: 'p@x.com' }, family), null);
  assert.equal(familyIdentityFor({ name: 'Priya Shah', linkedinUrl: 'https://linkedin.com/in/priya' }, family), null);
});

test('a split a human recorded is never re-folded', () => {
  assert.equal(familyIdentityFor({ name: 'Priya Shah' }, [{ identityId: 'id-1', name: 'Priya Shah' }], new Set(['id-1'])), null);
});

test('no name, no fold', () => {
  assert.equal(familyIdentityFor({ name: '  ' }, [{ identityId: 'id-1', name: '' }]), null);
});
