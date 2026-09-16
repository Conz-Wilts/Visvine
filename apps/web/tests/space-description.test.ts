import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPACE_DESCRIPTION_MAX_WORDS, clampWords, countWords, descriptionDenial } from '@/lib/spaces/shared/description';

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

test('words are counted across any whitespace', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords('   '), 0);
  assert.equal(countWords(' one\ntwo  three\t'), 3);
});

test('a description over the limit is cut at its last allowed word', () => {
  const over = words(SPACE_DESCRIPTION_MAX_WORDS + 20);
  assert.equal(clampWords(over), words(SPACE_DESCRIPTION_MAX_WORDS));
  assert.equal(clampWords('a b '), 'a b ');
});

test('only a description over the limit is refused', () => {
  assert.equal(descriptionDenial(words(SPACE_DESCRIPTION_MAX_WORDS)), null);
  assert.ok(descriptionDenial(words(SPACE_DESCRIPTION_MAX_WORDS + 1)));
});
