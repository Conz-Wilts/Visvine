import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { assertCrmPermission, PermissionError } from "@/lib/crm/permissions";
import { revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { z } from "zod";

type RouteContext = { params: Promise<{ communityId: string }> };

const BulkActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_private"),
    user_ids: z.array(z.string().min(1)).min(1).max(200),
    field: z.string().min(1).max(64),
    value: z.unknown(),
  }),
  z.object({
    action: z.literal("change_role"),
    user_ids: z.array(z.string().min(1)).min(1).max(200),
    role: z.enum(["admin", "moderator", "member"]),
  }),
  z.object({
    action: z.literal("remove"),
    user_ids: z.array(z.string().min(1)).min(1).max(200),
  }),
]);

export async function POST(req: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { communityId } = await params;

  try {
    await assertCrmPermission(
      session.userId,
      session.email,
      communityId,
      "manage_members"
    );
  } catch (e) {
    if (e instanceof PermissionError)
      return NextResponse.json(
        { error: "permission_denied" },
        { status: 403 }
      );
    throw e;
  }

  const body = BulkActionSchema.safeParse(await req.json());
  if (!body.success)
    return NextResponse.json(
      { error: "invalid_body" },
      { status: 400 }
    );

  const data = body.data;
  let affected = 0;

  if (data.action === "update_private") {
    // Validate field exists in community settings
    const community = await prisma.community.findUnique({
      where: { id: communityId },
      select: { crmSettings: true },
    });
    const settings = (community?.crmSettings as {
      fields?: Array<{ key: string; type: string; options?: string[] }>;
    }) ?? {};
    const fieldDef = settings.fields?.find((f) => f.key === data.field);
    if (!fieldDef) {
      return NextResponse.json(
        { error: "unknown_field", field: data.field },
        { status: 400 }
      );
    }
    if (
      fieldDef.type === "select" &&
      fieldDef.options &&
      !fieldDef.options.includes(data.value as string)
    ) {
      return NextResponse.json(
        { error: "invalid_field_value", field: data.field, allowed: fieldDef.options },
        { status: 400 }
      );
    }

    // Batch fetch all memberships, then batch update in a transaction
    const memberships = await prisma.userCommunity.findMany({
      where: { communityId, userId: { in: data.user_ids } },
      select: { userId: true, privateMeta: true },
    });

    const updates = memberships.map((m) => {
      const current = (m.privateMeta as Record<string, unknown>) ?? {};
      return prisma.userCommunity.update({
        where: { userId_communityId: { userId: m.userId, communityId } },
        data: {
          privateMeta: {
            ...current,
            [data.field]: data.value,
          } as Prisma.InputJsonObject,
        },
      });
    });

    if (updates.length > 0) {
      await prisma.$transaction(updates);
    }
    affected = updates.length;

    await prisma.auditLog.create({
      data: {
        actorId: session.userId,
        communityId,
        action: "bulk_edit_private",
        diff: {
          field: data.field,
          value: data.value,
          user_ids: data.user_ids,
          affected,
        } as unknown as Prisma.InputJsonObject,
      },
    });
  } else if (data.action === "change_role") {
    // Protect last admin
    if (data.role !== "admin") {
      const adminCount = await prisma.userCommunity.count({
        where: { communityId, role: "admin" },
      });
      const adminsBeingDemoted = await prisma.userCommunity.count({
        where: {
          communityId,
          userId: { in: data.user_ids },
          role: "admin",
        },
      });
      if (adminCount - adminsBeingDemoted < 1) {
        return NextResponse.json(
          { error: "last_admin_protected", message: "Cannot demote the last admin." },
          { status: 409 }
        );
      }
    }

    const result = await prisma.userCommunity.updateMany({
      where: { communityId, userId: { in: data.user_ids } },
      data: { role: data.role },
    });
    affected = result.count;

    await prisma.auditLog.create({
      data: {
        actorId: session.userId,
        communityId,
        action: "bulk_change_role",
        diff: {
          role: data.role,
          user_ids: data.user_ids,
          affected,
        } as unknown as Prisma.InputJsonObject,
      },
    });
  } else if (data.action === "remove") {
    // Protect last admin
    const adminCount = await prisma.userCommunity.count({
      where: { communityId, role: "admin" },
    });
    const adminsBeingRemoved = await prisma.userCommunity.count({
      where: {
        communityId,
        userId: { in: data.user_ids },
        role: "admin",
      },
    });
    if (adminCount - adminsBeingRemoved < 1) {
      return NextResponse.json(
        { error: "last_admin_protected", message: "Cannot remove the last admin." },
        { status: 409 }
      );
    }

    const result = await prisma.userCommunity.deleteMany({
      where: { communityId, userId: { in: data.user_ids } },
    });
    affected = result.count;

    await prisma.auditLog.create({
      data: {
        actorId: session.userId,
        communityId,
        action: "bulk_remove",
        diff: {
          user_ids: data.user_ids,
          affected,
        } as unknown as Prisma.InputJsonObject,
      },
    });
  }

  revalidateTag(`crm-list-${communityId}`);
  return NextResponse.json({ affected });
}
