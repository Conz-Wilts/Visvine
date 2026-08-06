import { NextRequest, NextResponse } from "next/server";
import { requireCommunityAdmin } from "@/lib/api/route";
import { PublicFieldPatchSchema } from "@/lib/schemas/crm";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { revalidateTag } from "next/cache";

type RouteContext = { params: Promise<{ communityId: string; userId: string }> };

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { communityId, userId } = await params;

  const session = await requireCommunityAdmin(communityId);
  if (session instanceof NextResponse) return session;

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Core partitioning rule: active users own their own public data
  if (target.isActive) {
    return NextResponse.json(
      { error: "public_field_owned_by_user", message: "This user controls their own public profile." },
      { status: 403 }
    );
  }

  const body = PublicFieldPatchSchema.safeParse(await req.json());
  if (!body.success)
    return NextResponse.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });

  const { field, value } = body.data;
  const current = (target.publicMeta as Record<string, unknown>) ?? {};

  await prisma.user.update({
    where: { id: userId },
    data: { publicMeta: { ...current, [field]: value } as Prisma.InputJsonObject },
  });

  revalidateTag(`crm-user-public-${userId}`, { expire: 0 });

  await prisma.auditLog.create({
    data: {
      actorId: session.userId,
      communityId,
      targetId: userId,
      action: "edit_public",
      diff: { before: { [field]: current[field] }, after: { [field]: value } } as Prisma.InputJsonObject,
    },
  });

  return NextResponse.json({ field, value });
}
