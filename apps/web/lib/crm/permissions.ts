import prisma from "@/lib/prisma";
import { isSuperAdmin } from "@/lib/session";
import { canManageCrm, type CommunityRole } from "@/lib/crm/roles";

export type CrmAction =
  | "view_crm"
  | "edit_public"
  | "edit_private"
  | "manage_members"
  | "configure_fields";

export class PermissionError extends Error {
  action: CrmAction;
  requiredRole: CommunityRole;

  constructor(action: CrmAction) {
    super(`Insufficient role for action: ${action}. Required: admin`);
    this.action = action;
    this.requiredRole = "admin";
  }
}

/**
 * Asserts the actor has sufficient role in the community to perform the action.
 * Super-admins bypass all checks. Throws PermissionError (→ 403) on failure.
 * Returns the membership row on success (null for super-admins).
 */
export async function assertCrmPermission(
  actorId: string,
  actorEmail: string,
  communityId: string,
  action: CrmAction
) {
  // Super-admins have unrestricted access.
  if (isSuperAdmin(actorEmail)) {
    return null;
  }

  const membership = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId: actorId, communityId } },
  });

  if (!membership || !canManageCrm(membership.role)) {
    throw new PermissionError(action);
  }

  return membership;
}
