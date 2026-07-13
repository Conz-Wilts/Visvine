import test from 'node:test';
import assert from 'node:assert/strict';
import { contextRedirectUrl } from '../lib/notes/contextRedirect';

test('bare /context lands on the directory context view', () => {
  assert.equal(contextRedirectUrl({}), '/directory?view=context');
});

test('the Create-modal hand-off (?new=note) rides along', () => {
  assert.equal(contextRedirectUrl({ new: 'note' }), '/directory?view=context&new=note');
});

test('arbitrary params are preserved', () => {
  const url = contextRedirectUrl({ new: 'note', foo: 'bar baz' });
  const params = new URLSearchParams(url.split('?')[1]);
  assert.equal(params.get('view'), 'context');
  assert.equal(params.get('new'), 'note');
  assert.equal(params.get('foo'), 'bar baz');
});

test('array-valued params keep every value', () => {
  const url = contextRedirectUrl({ tag: ['a', 'b'] });
  const params = new URLSearchParams(url.split('?')[1]);
  assert.deepEqual(params.getAll('tag'), ['a', 'b']);
});

test('an incoming view param cannot override the context view', () => {
  assert.equal(contextRedirectUrl({ view: 'grid' }), '/directory?view=context');
});

test('undefined values are skipped', () => {
  assert.equal(contextRedirectUrl({ ghost: undefined }), '/directory?view=context');
});
