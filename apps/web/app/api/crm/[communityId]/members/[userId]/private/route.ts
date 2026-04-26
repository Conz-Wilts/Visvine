import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { assertCrmPermission, PermissionError } from "@/lib/crm/permissions";
import { PrivateFieldPatchSchema } from "@/lib/schemas/crm";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

type RouteContext = { params: Promise<{ communityId: string; userId: string }> };

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { communityId, userId } = await params;

  try {
    await assertCrmPermission(session.userId, session.email, communityId, "edit_private");
  } catch (e) {
    if (e instanceof PermissionError)
      return NextResponse.json({ error: "permission_denied" }, { status: 403 });
    throw e;
  }

  const body = PrivateFieldPatchSchema.safeParse(await req.json());
  if (!body.success)
    return NextResponse.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });

  const { field, value } = body.data;

  // Validate field exists in community settings and value matches its type
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { crmSettings: true },
  });

  const settings = (community?.crmSettings as { fields?: Array<{ key: string; type: string; options?: string[] }> }) ?? {};
  const fieldDef = settings.fields?.find((f) => f.key === field);

  if (!fieldDef) {
    return NextResponse.json(
      { error: "unknown_field", message: `Field "${field}" is not defined in community settings.` },
      { status: 400 }
    );
  }

  if (fieldDef.type === "select" && fieldDef.options && !fieldDef.options.includes(value as string)) {
    return NextResponse.json(
      { error: "invalid_field_value", field, allowed: fieldDef.options },
      { status: 400 }
    );
  }

  const membership = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId, communityId } },
  });
  if (!membership) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const current = (membership.privateMeta as Record<string, unknown>) ?? {};
  await prisma.userCommunity.update({
    where: { userId_communityId: { userId, communityId } },
    data: { privateMeta: { ...current, [field]: value } as Prisma.InputJsonObject },
  });

  await prisma.auditLog.create({
    data: {
      actorId: session.userId,
      communityId,
      targetId: userId,
      action: "edit_private",
      diff: { before: { [field]: current[field] }, after: { [field]: value } } as Prisma.InputJsonObject,
    },
  });

  return NextResponse.json({ field, value });
}
