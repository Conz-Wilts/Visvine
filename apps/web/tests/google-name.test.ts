import { test } from 'node:test'
import assert from 'node:assert/strict'
import { googleDisplayName } from '@/lib/auth/googleName'

test('given + family win over a display name carrying a nickname', () => {
  assert.equal(
    googleDisplayName({ name: 'Connor Wiltshire (Connor Wiltshire)', given_name: 'Connor', family_name: 'Wiltshire' }),
    'Connor Wiltshire',
  )
})

test('one part alone is the name', () => {
  assert.equal(googleDisplayName({ name: 'Cher (C)', given_name: 'Cher' }), 'Cher')
})

test('falls back to name, then email', () => {
  assert.equal(googleDisplayName({ name: ' Ana Ruiz ', given_name: '' }), 'Ana Ruiz')
  assert.equal(googleDisplayName({ email: 'a@b.co' }), 'a@b.co')
})
