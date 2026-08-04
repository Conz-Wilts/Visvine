import { NextRequest, NextResponse } from "next/server";
import { requireCommunityAdmin } from "@/lib/api/route";
import prisma from "@/lib/prisma";

type RouteContext = { params: Promise<{ communityId: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { communityId } = await params;

  const session = await requireCommunityAdmin(communityId);
  if (session instanceof NextResponse) return session;

  const page = Math.max(
    1,
    parseInt(req.nextUrl.searchParams.get("page") ?? "1", 10) || 1
  );
  const limit = Math.min(
    100,
    Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10) || 50)
  );

  const [entries, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where: { communityId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.auditLog.count({ where: { communityId } }),
  ]);

  // Resolve actor/target names
  const userIds = new Set<string>();
  for (const e of entries) {
    userIds.add(e.actorId);
    if (e.targetId) userIds.add(e.targetId);
  }

  const users = await prisma.user.findMany({
    where: { id: { in: [...userIds] } },
    select: { id: true, name: true, email: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  const rows = entries.map((e) => ({
    id: e.id,
    action: e.action,
    actor: userMap.get(e.actorId) ?? { id: e.actorId, name: "Unknown", email: "" },
    target: e.targetId
      ? userMap.get(e.targetId) ?? { id: e.targetId, name: "Unknown", email: "" }
      : null,
    diff: e.diff,
    created_at: e.createdAt.toISOString(),
  }));

  return NextResponse.json({ entries: rows, total, page, limit });
}
