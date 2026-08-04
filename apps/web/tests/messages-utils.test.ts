import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateUnreadCount } from '../lib/messages/utils';

test('calculateUnreadCount excludes own messages and respects lastReadAt', () => {
  const now = new Date('2026-02-18T12:00:00.000Z');
  const beforeRead = new Date('2026-02-18T11:00:00.000Z');
  const afterRead = new Date('2026-02-18T12:30:00.000Z');

  const unread = calculateUnreadCount(
    [
      { senderId: 'peer', createdAt: beforeRead },
      { senderId: 'peer', createdAt: afterRead },
      { senderId: 'me', createdAt: afterRead },
    ],
    'me',
    now,
  );

  assert.equal(unread, 1);
});

test('calculateUnreadCount counts all incoming when never read', () => {
  const unread = calculateUnreadCount(
    [
      { senderId: 'peer-1', createdAt: new Date('2026-02-18T10:00:00.000Z') },
      { senderId: 'peer-2', createdAt: new Date('2026-02-18T10:05:00.000Z') },
      { senderId: 'me', createdAt: new Date('2026-02-18T10:10:00.000Z') },
    ],
    'me',
    null,
  );

  assert.equal(unread, 2);
});
