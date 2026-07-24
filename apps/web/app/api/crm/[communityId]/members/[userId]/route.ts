import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api/route";
import { assertCrmPermission, PermissionError } from "@/lib/crm/permissions";
import { getMember } from "@/lib/crm/memberService";
import { LastAdminError, guardLastAdminThenMutate } from "@/lib/crm/lastAdminGuard";
import { removeMemberAccess } from "@/lib/notes/access";
import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";

type RouteContext = { params: Promise<{ communityId: string; userId: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { communityId, userId } = await params;

  try {
    await assertCrmPermission(session.userId, session.email, communityId, "view_crm");
  } catch (e) {
    if (e instanceof PermissionError)
      return NextResponse.json({ error: "permission_denied" }, { status: 403 });
    throw e;
  }

  const member = await getMember(communityId, userId);
  if (!member) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(member);
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
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

  // Protect last admin atomically. Self-removal skips the guard (an admin may
  // always leave); removing another member enforces the invariant.
  try {
    await guardLastAdminThenMutate(
      { communityId, userIds: [userId], guard: userId !== session.userId },
      (tx) =>
        tx.userCommunity.delete({
          where: { userId_communityId: { userId, communityId } },
        })
    );
  } catch (e) {
    if (e instanceof LastAdminError) {
      return NextResponse.json(
        { error: "last_admin_protected", message: "Cannot remove the last admin from a community." },
        { status: 409 }
      );
    }
    throw e;
  }

  // Brain access leaves with them: direct grants + team memberships here.
  await removeMemberAccess(communityId, userId);

  revalidateTag(`crm-list-${communityId}`);

  await prisma.auditLog.create({
    data: {
      actorId: session.userId,
      communityId,
      targetId: userId,
      action: "remove_member",
    },
  });

  return new NextResponse(null, { status: 204 });
}
