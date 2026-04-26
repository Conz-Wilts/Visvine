import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { assertCrmPermission, PermissionError } from "@/lib/crm/permissions";
import { getMember } from "@/lib/crm/memberService";
import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";

type RouteContext = { params: Promise<{ communityId: string; userId: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

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
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { communityId, userId } = await params;

  try {
    await assertCrmPermission(session.userId, session.email, communityId, "manage_members");
  } catch (e) {
    if (e instanceof PermissionError)
      return NextResponse.json({ error: "permission_denied" }, { status: 403 });
    throw e;
  }

  // Protect last admin
  if (userId !== session.userId) {
    const adminCount = await prisma.userCommunity.count({
      where: { communityId, role: "admin" },
    });
    const targetMembership = await prisma.userCommunity.findUnique({
      where: { userId_communityId: { userId, communityId } },
    });
    if (targetMembership?.role === "admin" && adminCount <= 1) {
      return NextResponse.json(
        { error: "last_admin_protected", message: "Cannot remove the last admin from a community." },
        { status: 409 }
      );
    }
  }

  await prisma.userCommunity.delete({
    where: { userId_communityId: { userId, communityId } },
  });

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
