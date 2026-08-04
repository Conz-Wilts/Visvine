import { z } from 'zod';

/** A short emoji string (grapheme clusters can be several code units long). */
const emojiSchema = z.string().trim().min(1).max(16);

/** Rendering style of a channel: classic chat thread or social-feed post cards. */
const viewModeSchema = z.enum(['CHAT', 'FEED']);

export const createChannelSchema = z.object({
  communityId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  icon: emojiSchema.optional(),
  spaceId: z.string().min(1).optional(),
  viewMode: viewModeSchema.optional(),
  // Starting text for the channel's context note (channels/<slug>.md). Optional
  // — the note is created either way, this just saves an empty first edit.
  context: z.string().trim().max(5000).optional(),
});

export const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  icon: emojiSchema.nullable().optional(),
  spaceId: z.string().min(1).nullable().optional(),
  viewMode: viewModeSchema.optional(),
});

export const createSpaceSchema = z.object({
  communityId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  emoji: emojiSchema.optional(),
  /** Starting text for the space's context note (spaces/<slug>.md). */
  context: z.string().trim().max(5000).optional(),
});

export const updateSpaceSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  emoji: emojiSchema.nullable().optional(),
  position: z.number().int().min(0).optional(),
});

export const sendMessageSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  attachmentUrl: z.string().url().optional(),
  imageUrls: z.array(z.string().url()).max(10).optional(),
  mentions: z.array(z.object({
    mentionedUserId: z.string().optional(),
    mentionedNodeId: z.string().optional(),
    mentionType: z.enum(['user', 'event']).default('user'),
  })).optional(),
  replyToId: z.string().optional(),
});

export const editMessageSchema = z.object({
  text: z.string().trim().min(1).max(4000),
});

export const reactionSchema = z.object({
  emoji: z.string().min(1).max(8),
});

export const markReadSchema = z.object({
  readAt: z.string().datetime().optional(),
});

export const typingSchema = z.object({
  isTyping: z.boolean(),
});
