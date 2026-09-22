// Unit tests for the Feed's pure half (lib/messages/shared/feed.ts): the keyset
// cursor, filing comments under posts, and patching a feed from a realtime event.
// Run: node --import tsx --test tests/feed.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFeedEvent,
  decodeFeedCursor,
  encodeFeedCursor,
  groupComments,
  patchReactions,
  type FeedPlace,
  type FeedPost,
  filterPlaces,
} from '../lib/messages/shared/feed';
import type { SerializedMessage } from '../lib/messages/types';

const ME = 'me';

const message = (id: string, over: Partial<SerializedMessage> = {}): SerializedMessage => ({
  id,
  text: id,
  attachmentUrl: null,
  createdAt: '2026-09-21T10:00:00.000Z',
  sender: { id: 'peer', name: 'Peer', image: null },
  isOwn: false,
  readByCount: 0,
  recipientCount: 0,
  isFullyReadByRecipients: false,
  reactions: [],
  replyTo: null,
  ...over,
});

const reply = (id: string, postId: string) =>
  message(id, { replyTo: { id: postId, text: '', senderName: 'Peer' } });

const place: FeedPlace = {
  conversationId: 'c1',
  channel: { id: 'c1', name: 'News' },
  space: { id: 'acme', name: 'Acme' },
};
const places = new Map([[place.conversationId, place]]);

const post = (id: string, comments: SerializedMessage[] = [], over: Partial<SerializedMessage> = {}): FeedPost =>
  ({ ...place, message: message(id, over), comments });

test('a cursor survives a round trip, and junk decodes to null', () => {
  const createdAt = new Date('2026-09-21T10:00:00.123Z');
  const decoded = decodeFeedCursor(encodeFeedCursor({ createdAt, id: 'm|1' }));
  assert.equal(decoded?.createdAt.getTime(), createdAt.getTime());
  assert.equal(decoded?.id, 'm|1');
  for (const junk of [null, '', 'nope', '|id', '2026-09-21T10:00:00.000Z|', 'not-a-date|id']) {
    assert.equal(decodeFeedCursor(junk), null);
  }
});

test('comments are filed under their post in arrival order; strays are dropped', () => {
  const grouped = groupComments(
    [message('p1'), message('p2')],
    [reply('r1', 'p1'), reply('r2', 'p1'), reply('r3', 'gone')],
  );
  assert.deepEqual(grouped.get('p1')?.map((m) => m.id), ['r1', 'r2']);
  assert.deepEqual(grouped.get('p2'), []);
  assert.equal(grouped.has('gone'), false);
});

test('reactions: added, added again by me, removed down to nothing', () => {
  let list = patchReactions(undefined, { type: 'reaction.added', emoji: '🔥', userId: 'peer' }, ME);
  assert.deepEqual(list, [{ emoji: '🔥', count: 1, reacted: false }]);
  list = patchReactions(list, { type: 'reaction.added', emoji: '🔥', userId: ME }, ME);
  assert.deepEqual(list, [{ emoji: '🔥', count: 2, reacted: true }]);
  list = patchReactions(list, { type: 'reaction.removed', emoji: '🔥', userId: ME }, ME);
  assert.deepEqual(list, [{ emoji: '🔥', count: 1, reacted: false }]);
  list = patchReactions(list, { type: 'reaction.removed', emoji: '🔥', userId: 'peer' }, ME);
  assert.deepEqual(list, []);
});

test('an event from a channel the feed does not draw changes nothing', () => {
  const posts = [post('p1')];
  const next = applyFeedEvent(posts, { type: 'message.new', conversationId: 'dm', message: message('x') }, places, ME);
  assert.equal(next, posts);
  assert.equal(applyFeedEvent(posts, { type: 'conversation.updated', conversationId: 'c1' }, places, ME), posts);
});

test('a new post leads the feed with its place, once, marked own by sender', () => {
  const posts = [post('p1')];
  const event = { type: 'message.new' as const, conversationId: 'c1', message: message('p2', { sender: { id: ME, name: 'Me', image: null } }) };
  const next = applyFeedEvent(posts, event, places, ME);
  assert.deepEqual(next.map((p) => p.message.id), ['p2', 'p1']);
  assert.equal(next[0].message.isOwn, true);
  assert.equal(next[0].space.id, 'acme');
  assert.equal(applyFeedEvent(next, event, places, ME), next);
});

test('a new reply lands under its post, once', () => {
  const event = { type: 'message.new' as const, conversationId: 'c1', message: reply('r1', 'p1') };
  const next = applyFeedEvent([post('p1'), post('p2')], event, places, ME);
  assert.deepEqual(next[0].comments.map((c) => c.id), ['r1']);
  assert.deepEqual(next[1].comments, []);
  assert.deepEqual(applyFeedEvent(next, event, places, ME)[0].comments.map((c) => c.id), ['r1']);
});

test("an edit keeps the viewer's own star", () => {
  const next = applyFeedEvent(
    [post('p1', [], { starred: true })],
    { type: 'message.updated', conversationId: 'c1', message: message('p1', { text: 'edited', starred: false }) },
    places,
    ME,
  );
  assert.equal(next[0].message.text, 'edited');
  assert.equal(next[0].message.starred, true);
});

test('a deleted post leaves; a deleted comment keeps its place', () => {
  const posts = [post('p1', [reply('r1', 'p1')]), post('p2')];
  const gone = applyFeedEvent(posts, { type: 'message.deleted', conversationId: 'c1', messageId: 'p2' }, places, ME);
  assert.deepEqual(gone.map((p) => p.message.id), ['p1']);
  const blanked = applyFeedEvent(posts, { type: 'message.deleted', conversationId: 'c1', messageId: 'r1' }, places, ME);
  assert.equal(blanked[0].comments[0].text, '');
  assert.ok(blanked[0].comments[0].deletedAt);
});

test('a reaction reaches a post or a comment', () => {
  const posts = [post('p1', [reply('r1', 'p1')])];
  const event = { type: 'reaction.added' as const, conversationId: 'c1', emoji: '👍', userId: ME };
  assert.equal(applyFeedEvent(posts, { ...event, messageId: 'p1' }, places, ME)[0].message.reactions?.[0].count, 1);
  assert.equal(applyFeedEvent(posts, { ...event, messageId: 'r1' }, places, ME)[0].comments[0].reactions?.[0].reacted, true);
  assert.equal(applyFeedEvent(posts, { ...event, messageId: 'nope' }, places, ME), posts);
});

test('filterPlaces keeps one space, or everything when no space is named', () => {
  const places = [
    { conversationId: 'c1', channel: { id: 'c1', name: 'general' }, space: { id: 'acme', name: 'Acme' } },
    { conversationId: 'c2', channel: { id: 'c2', name: 'design' }, space: { id: 'beta', name: 'Beta' } },
  ];
  assert.deepEqual(filterPlaces(places, 'acme').map((p) => p.conversationId), ['c1']);
  assert.equal(filterPlaces(places, null).length, 2);
  assert.equal(filterPlaces(places, 'nope').length, 0);
});
