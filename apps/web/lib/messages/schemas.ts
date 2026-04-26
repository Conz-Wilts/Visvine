import { z } from 'zod';

export const createDmSchema = z.object({
  userId: z.string().min(1),
});

export const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  memberIds: z.array(z.string().min(1)).min(1),
  avatarUrl: z.string().url().optional(),
});

export const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

export const mutateMemberSchema = z.object({
  userId: z.string().min(1),
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
