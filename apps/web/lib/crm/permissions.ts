import prisma from "@/lib/prisma";
import { isSuperAdmin } from "@/lib/session";
import type { CommunityRole } from "@/lib/crm/roles";

export type CrmAction =
  | "view_crm"
  | "edit_public"
  | "edit_private"
  | "manage_members"
  | "configure_fields";

/**
 * Whether a community role may perform a CRM action.
 *
 * Every current CRM action requires `admin` (the `moderator` role was removed;
 * any legacy/unknown role resolves to least privilege). Kept as a single named
 * predicate so the policy has one home if finer-grained roles return.
 */
export function roleCan(role: string, _action: CrmAction): boolean {
  return role === "admin";
}

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

  if (!membership || !roleCan(membership.role, action)) {
    throw new PermissionError(action);
  }

  return membership;
}
