// The Feed's pure half: one stream of the posts in every FEED-mode channel a
// person has joined, across their spaces. A post is a top-level message; a
// comment is a reply to it. Nothing here reads a database or a DOM, so the
// server builds a page with it and the client patches one from a realtime
// event with it.

import type { RealtimeEvent, SerializedLinkPreview, SerializedMessage, SerializedReaction } from '../types';
import { personAliases, type SpaceAlias } from '../../types/context';

/** Where a post was written — the channel, and the space that holds it. */
export interface FeedPlace {
  conversationId: string;
  channel: { id: string; name: string };
  space: { id: string; name: string };
}

export interface FeedPost extends FeedPlace {
  message: SerializedMessage;
  comments: SerializedMessage[];
}

export interface FeedPage {
  posts: FeedPost[];
  nextCursor: string | null;
  /** The channels the viewer can post into. First page only. */
  targets?: FeedPlace[];
  /** The alias each author wears in the space they wrote in, keyed
   *  `badgeKey(spaceId, userId)`. An author holding none is absent. */
  badges?: Record<string, FeedBadge>;
}

/** The alias beside an author's name — what they are in that space. */
export interface FeedBadge {
  name: string;
  color: string;
}

export const badgeKey = (spaceId: string, userId: string) => `${spaceId}:${userId}`;

/**
 * Each holder's badge: the first alias they hold in the space's own order,
 * the owning alias first. Holdings naming an alias the space no longer
 * defines are ignored.
 */
export function foldBadges(
  aliasesBySpace: ReadonlyMap<string, SpaceAlias[] | undefined>,
  held: readonly { spaceId: string; userId: string; aliasId: string }[],
): Record<string, FeedBadge> {
  const heldBy = new Map<string, Set<string>>();
  for (const h of held) {
    const key = badgeKey(h.spaceId, h.userId);
    const set = heldBy.get(key) ?? new Set<string>();
    set.add(h.aliasId);
    heldBy.set(key, set);
  }
  const out: Record<string, FeedBadge> = {};
  for (const [key, ids] of heldBy) {
    const spaceId = key.slice(0, key.indexOf(':'));
    const alias = personAliases(aliasesBySpace.get(spaceId)).find((a) => a.id && ids.has(a.id));
    if (alias) out[key] = { name: alias.name, color: alias.color };
  }
  return out;
}

/** The places in one space, or all of them when no space is named. */
export function filterPlaces<T extends FeedPlace>(places: readonly T[], spaceId?: string | null): T[] {
  return spaceId ? places.filter((p) => p.space.id === spaceId) : [...places];
}

export const FEED_PAGE_SIZE = 20;
export const FEED_PAGE_MAX = 50;

// ─── Cursor ──────────────────────────────────────────────────────────────────

/** A keyset position: the last post of a page, newest first. */
export interface FeedCursor {
  createdAt: Date;
  id: string;
}

export function encodeFeedCursor(cursor: { createdAt: Date | string; id: string }): string {
  const at = typeof cursor.createdAt === 'string' ? cursor.createdAt : cursor.createdAt.toISOString();
  return `${at}|${cursor.id}`;
}

export function decodeFeedCursor(raw: string | null | undefined): FeedCursor | null {
  if (!raw) return null;
  const split = raw.indexOf('|');
  if (split <= 0 || split === raw.length - 1) return null;
  const createdAt = new Date(raw.slice(0, split));
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id: raw.slice(split + 1) };
}

// ─── Building a page ─────────────────────────────────────────────────────────

/** File each reply under the post it answers. Replies arrive oldest first and
 *  stay that way; one whose post is not on the page is dropped. */
export function groupComments(
  posts: SerializedMessage[],
  replies: SerializedMessage[],
): Map<string, SerializedMessage[]> {
  const byPost = new Map<string, SerializedMessage[]>(posts.map((post) => [post.id, []]));
  for (const reply of replies) {
    const parent = reply.replyTo?.id;
    if (parent) byPost.get(parent)?.push(reply);
  }
  return byPost;
}

// ─── Patching from a realtime event ──────────────────────────────────────────

/** One reaction event applied to one message's reaction list. */
export function patchReactions(
  reactions: SerializedReaction[] | undefined,
  event: { type: 'reaction.added' | 'reaction.removed'; emoji: string; userId: string },
  currentUserId: string,
): SerializedReaction[] {
  const mine = event.userId === currentUserId;
  const list = reactions ?? [];
  const existing = list.find((r) => r.emoji === event.emoji);
  if (event.type === 'reaction.added') {
    if (!existing) return [...list, { emoji: event.emoji, count: 1, reacted: mine }];
    return list.map((r) => r === existing ? { ...r, count: r.count + 1, reacted: r.reacted || mine } : r);
  }
  if (!existing) return list;
  if (existing.count <= 1) return list.filter((r) => r !== existing);
  return list.map((r) => r === existing ? { ...r, count: r.count - 1, reacted: mine ? false : r.reacted } : r);
}

function mapMessages(posts: FeedPost[], messageId: string, change: (m: SerializedMessage) => SerializedMessage): FeedPost[] {
  let touched = false;
  const next = posts.map((post) => {
    if (post.message.id === messageId) {
      touched = true;
      return { ...post, message: change(post.message) };
    }
    const at = post.comments.findIndex((c) => c.id === messageId);
    if (at < 0) return post;
    touched = true;
    const comments = [...post.comments];
    comments[at] = change(comments[at]);
    return { ...post, comments };
  });
  return touched ? next : posts;
}

/**
 * The feed after one realtime event. `places` names the channels the feed
 * draws from: an event from anywhere else (a DM, a chat channel) changes
 * nothing, and the same array comes back so a render is skipped.
 */
/**
 * A message with one link card redrawn: the card of the same resource, if the
 * message carries it. The same object comes back when it does not, so a
 * list that holds none of it skips a render.
 */
export function withLinkCard<M extends { linkPreviews?: SerializedLinkPreview[] }>(message: M, card: SerializedLinkPreview): M {
  if (!card.resourceId || !message.linkPreviews?.some((p) => p.resourceId === card.resourceId)) return message;
  return { ...message, linkPreviews: message.linkPreviews.map((p) => (p.resourceId === card.resourceId ? card : p)) };
}

export function applyFeedEvent(
  posts: FeedPost[],
  event: RealtimeEvent,
  places: ReadonlyMap<string, FeedPlace>,
  currentUserId: string,
): FeedPost[] {
  if (event.type === 'typing' || event.type === 'conversation.updated') return posts;
  const place = places.get(event.conversationId);
  if (!place) return posts;

  if (event.type === 'message.new') {
    const message = { ...event.message, isOwn: event.message.sender.id === currentUserId };
    const parent = message.replyTo?.id;
    if (!parent) {
      if (posts.some((post) => post.message.id === message.id)) return posts;
      return [{ ...place, message, comments: [] }, ...posts];
    }
    return posts.map((post) => {
      if (post.message.id !== parent || post.comments.some((c) => c.id === message.id)) return post;
      return { ...post, comments: [...post.comments, message] };
    });
  }

  if (event.type === 'message.updated') {
    const updated = { ...event.message, isOwn: event.message.sender.id === currentUserId };
    // `starred` is per viewer and the broadcast was serialized for the editor.
    return mapMessages(posts, updated.id, (m) => ({ ...updated, starred: m.starred }));
  }

  if (event.type === 'resource.updated') {
    let changed = false;
    const next = posts.map((post) => {
      const message = withLinkCard(post.message, event.card);
      const comments = post.comments.map((c) => withLinkCard(c, event.card));
      if (message === post.message && comments.every((c, i) => c === post.comments[i])) return post;
      changed = true;
      return { ...post, message, comments };
    });
    return changed ? next : posts;
  }

  if (event.type === 'message.deleted') {
    const deletedAt = new Date().toISOString();
    // A deleted post leaves the feed; a deleted comment keeps its place.
    if (posts.some((post) => post.message.id === event.messageId)) {
      return posts.filter((post) => post.message.id !== event.messageId);
    }
    return mapMessages(posts, event.messageId, (m) => ({ ...m, deletedAt, text: '' }));
  }

  return mapMessages(posts, event.messageId, (m) => ({
    ...m,
    reactions: patchReactions(m.reactions, event, currentUserId),
  }));
}
