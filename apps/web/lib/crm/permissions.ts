import prisma from "@/lib/prisma";
import { isSuperAdmin } from "@/lib/session";

export type CrmAction =
  | "view_crm"
  | "edit_public"
  | "edit_private"
  | "manage_members"
  | "configure_fields";

const ROLE_RANK: Record<string, number> = {
  admin: 2,
  moderator: 1,
  member: 0,
};

const REQUIRED_RANK: Record<CrmAction, number> = {
  view_crm: 1,        // moderator+
  edit_public: 2,     // admin only
  edit_private: 1,    // moderator+
  manage_members: 2,  // admin only
  configure_fields: 2,// admin only
};

export class PermissionError extends Error {
  action: CrmAction;
  requiredRole: string;

  constructor(action: CrmAction) {
    const requiredRole = Object.entries(ROLE_RANK).find(
      ([, rank]) => rank === REQUIRED_RANK[action]
    )?.[0] ?? "admin";
    super(`Insufficient role for action: ${action}. Required: ${requiredRole}`);
    this.action = action;
    this.requiredRole = requiredRole;
  }
}

/**
 * Asserts the actor has sufficient role in the community to perform the action.
 * Super-admins bypass all checks.
 * Throws PermissionError (→ 403) on failure.
 * Returns the membership row on success.
 */
export async function assertCrmPermission(
  actorId: string,
  actorEmail: string,
  communityId: string,
  action: CrmAction
) {
  // Super-admins have unrestricted access
  if (isSuperAdmin(actorEmail)) {
    return null;
  }

  const membership = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId: actorId, communityId } },
  });

  if (!membership) {
    throw new PermissionError(action);
  }

  const rank = ROLE_RANK[membership.role] ?? 0;
  if (rank < REQUIRED_RANK[action]) {
    throw new PermissionError(action);
  }

  return membership;
}
