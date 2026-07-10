import { z } from 'zod';

/** Body for POST /api/intros. The requester is derived from the session, never the body. */
export const createIntroSchema = z.object({
  communityId: z.string().min(1),
  targetNodeId: z.string().min(1),
  introducerNodeId: z.string().min(1),
  messageToIntroducer: z.string().trim().min(1).max(600),
  messageToTarget: z.string().trim().min(1).max(600),
});

export type CreateIntroInput = z.infer<typeof createIntroSchema>;

/** Body for PATCH /api/intros/[id]. `endorsement` is optional on `approve`. */
export const introActionSchema = z.object({
  action: z.enum(['approve', 'decline', 'accept']),
  endorsement: z.string().trim().max(600).optional(),
});

export type IntroActionInput = z.infer<typeof introActionSchema>;
