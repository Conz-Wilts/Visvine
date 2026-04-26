import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { assertCrmPermission, PermissionError } from "@/lib/crm/permissions";
import { RolePatchSchema } from "@/lib/schemas/crm";
import prisma from "@/lib/prisma";

type RouteContext = { params: Promise<{ communityId: string; userId: string }> };

export async function PATCH(req: NextRequest, { params }: RouteContext) {
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

  const body = RolePatchSchema.safeParse(await req.json());
  if (!body.success)
    return NextResponse.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });

  const { role } = body.data;

  // Protect last admin
  if (role !== "admin") {
    const target = await prisma.userCommunity.findUnique({
      where: { userId_communityId: { userId, communityId } },
    });
    if (target?.role === "admin") {
      const adminCount = await prisma.userCommunity.count({
        where: { communityId, role: "admin" },
      });
      if (adminCount <= 1) {
        return NextResponse.json(
          { error: "last_admin_protected", message: "Cannot demote the last admin." },
          { status: 409 }
        );
      }
    }
  }

  const updated = await prisma.userCommunity.update({
    where: { userId_communityId: { userId, communityId } },
    data: { role },
  });

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
