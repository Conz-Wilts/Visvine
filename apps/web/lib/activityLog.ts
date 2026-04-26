import { logger } from './logger';

/**
 * Log activity for a community.
 * Note: Persistent activity logging not implemented yet — emits a
 * structured log event so the data is at least captured in the log drain.
 */
export async function logActivity(params: {
  communityId: string;
  actorEmail: string;
  actorName?: string | null;
  action: string;
  targetEmail?: string | null;
  targetName?: string | null;
  details?: Record<string, unknown>;
}) {
  logger.info('activity', {
    communityId: params.communityId,
    actorEmail: params.actorEmail,
    actorName: params.actorName,
    action: params.action,
    targetEmail: params.targetEmail,
    targetName: params.targetName,
    details: params.details,
  });
}
