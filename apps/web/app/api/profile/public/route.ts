import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api/route";
import { PublicFieldPatchSchema } from "@/lib/schemas/crm";
import { Prisma } from "@prisma/client";
import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";

export async function PATCH(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const body = PublicFieldPatchSchema.safeParse(await req.json());
  if (!body.success)
    return NextResponse.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });

  const { field, value } = body.data;

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  const current = (user.publicMeta as Record<string, unknown>) ?? {};

  await prisma.user.update({
    where: { id: session.userId },
    data: { publicMeta: { ...current, [field]: value } as Prisma.InputJsonObject },
  });

  revalidateTag(`crm-user-public-${session.userId}`, { expire: 0 });

  await prisma.auditLog.create({
    data: {
      actorId: session.userId,
      targetId: session.userId,
      action: "edit_public",
      diff: { before: { [field]: current[field] }, after: { [field]: value } } as Prisma.InputJsonObject,
    },
  });

  return NextResponse.json({ field, value });
}
