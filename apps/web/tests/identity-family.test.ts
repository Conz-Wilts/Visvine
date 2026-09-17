import test from 'node:test';
import assert from 'node:assert/strict';
import { familyIdentityFor, planFamilyCleanup, type CleanupIdentity } from '../lib/identity/family';

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

const ident = (id: string, over: Partial<CleanupIdentity> = {}): CleanupIdentity => ({
  id, claimed: false, email: null, linkedinHandle: null, global: false, ...over,
});
const plan = (nodes: Array<{ id: string; spaceId: string; name: string; identityId: string | null }>, ids: CleanupIdentity[] = [], splits = new Map<string, Set<string>>()) =>
  planFamilyCleanup({ houseId: 'hq', nodes, identities: new Map(ids.map((i) => [i.id, i])), splits });

test('cleanup: bare nodes take the one identity the family holds', () => {
  const p = plan(
    [{ id: 'a', spaceId: 'hq', name: 'Dev Admin', identityId: 'i1' }, { id: 'b', spaceId: 'eng', name: 'dev admin', identityId: null }],
    [ident('i1')],
  );
  assert.deepEqual(p.steps, [{ kind: 'attach', nodeId: 'b', identityId: 'i1' }]);
});

test('cleanup: a name nobody has an identity for resolves once, house first, rooms follow', () => {
  const p = plan([
    { id: 'r', spaceId: 'mkt', name: 'Priya Shah', identityId: null },
    { id: 'h', spaceId: 'hq', name: 'Priya Shah', identityId: null },
  ]);
  assert.deepEqual(p.steps, [{ kind: 'resolve', nodeId: 'h', followers: ['r'] }]);
});

test('cleanup: two identities for one name merge onto the claimed one', () => {
  const p = plan(
    [
      { id: 'h', spaceId: 'hq', name: 'Priya', identityId: 'i1' },
      { id: 'r', spaceId: 'mkt', name: 'Priya', identityId: 'i2' },
    ],
    [ident('i1'), ident('i2', { claimed: true })],
  );
  assert.deepEqual(p.steps, [{ kind: 'merge', from: 'i1', to: 'i2', nodeIds: ['h'] }]);
});

test('cleanup: never merges two accounts, two emails, a Visvine record or a split', () => {
  const nodes = [
    { id: 'h', spaceId: 'hq', name: 'Sam', identityId: 'i1' },
    { id: 'r', spaceId: 'mkt', name: 'Sam', identityId: 'i2' },
  ];
  assert.equal(plan(nodes, [ident('i1', { claimed: true }), ident('i2', { claimed: true })]).skipped[0].reason, 'two member accounts');
  assert.equal(plan(nodes, [ident('i1', { email: 'a@x' }), ident('i2', { email: 'b@x' })]).skipped[0].reason, 'different emails');
  assert.equal(plan(nodes, [ident('i1'), ident('i2', { global: true })]).skipped[0].reason, 'a Visvine record would be stranded');
  assert.equal(plan(nodes, [ident('i1'), ident('i2')], new Map([['r', new Set(['i1'])]])).skipped[0].reason, 'a split was recorded');
});

test('cleanup: the same name twice in one space is a human question; each still gets its own identity', () => {
  const p = plan([
    { id: 'a', spaceId: 'hq', name: 'Sam', identityId: null },
    { id: 'b', spaceId: 'hq', name: 'Sam', identityId: null },
  ]);
  assert.equal(p.skipped[0].reason, 'the same name twice in one space');
  assert.deepEqual(p.steps.map((s) => s.kind), ['resolve', 'resolve']);
});

test('cleanup: a clean family plans nothing', () => {
  const p = plan([{ id: 'a', spaceId: 'hq', name: 'A', identityId: 'i1' }, { id: 'b', spaceId: 'eng', name: 'A', identityId: 'i1' }], [ident('i1')]);
  assert.deepEqual(p, { steps: [], skipped: [] });
});
