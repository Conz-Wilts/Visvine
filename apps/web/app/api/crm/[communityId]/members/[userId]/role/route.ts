import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api/route";
import { assertCrmPermission, PermissionError } from "@/lib/crm/permissions";
import { RolePatchSchema } from "@/lib/schemas/crm";
import { LastAdminError, guardLastAdminThenMutate } from "@/lib/crm/lastAdminGuard";
import prisma from "@/lib/prisma";

type RouteContext = { params: Promise<{ communityId: string; userId: string }> };

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { communityId, userId } = await params;

  try {
    await assertCrmPermission(session.userId, session.email, communityId, "manage_members");
  } catch (e) {
    if (e instanceof PermissionError)
      return NextResponse.json({ error: "permission_denied" }, { status: 403 });
    throw e;
  }

  const body = RolePatchSchema.safeParse(await req.json());
  if (!body.success)
    return NextResponse.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });

  const { role } = body.data;

  // Protect last admin atomically: demotions to a non-admin role are guarded;
  // promotions to admin leave the headcount safe so the guard is skipped.
  let updated;
  try {
    updated = await guardLastAdminThenMutate(
      { communityId, userIds: [userId], guard: role !== "admin" },
      (tx) =>
        tx.userCommunity.update({
          where: { userId_communityId: { userId, communityId } },
          data: { role },
        })
    );
  } catch (e) {
    if (e instanceof LastAdminError) {
      return NextResponse.json(
        { error: "last_admin_protected", message: "Cannot demote the last admin." },
        { status: 409 }
      );
    }
    throw e;
  }

  await prisma.auditLog.create({
    data: {
      actorId: session.userId,
      communityId,
      targetId: userId,
      action: "change_role",
      diff: { role },
    },
  });

  return NextResponse.json({ role: updated.role });
}
