import { NextRequest, NextResponse } from "next/server";
import { requireCommunityAdmin } from "@/lib/api/route";
import { getMember } from "@/lib/crm/memberService";
import { assertMembersCanLeave } from "@/lib/notes/aliases";
import { removeMemberAccess } from "@/lib/notes/access";
import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";

type RouteContext = { params: Promise<{ communityId: string; userId: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { communityId, userId } = await params;

  const session = await requireCommunityAdmin(communityId);
  if (session instanceof NextResponse) return session;

  const member = await getMember(communityId, userId);
  if (!member) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(member);
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { communityId, userId } = await params;

  const session = await requireCommunityAdmin(communityId);
  if (session instanceof NextResponse) return session;

  // Somebody must still be able to manage the community afterwards.
  try {
    await assertMembersCanLeave(communityId, [userId]);
  } catch (e) {
    return NextResponse.json(
      { error: "last_admin_protected", message: (e as Error).message },
      { status: 409 }
    );
  }

  await prisma.userCommunity.delete({
    where: { userId_communityId: { userId, communityId } },
  });

  // Brain access leaves with them: direct grants + the aliases they held here.
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
