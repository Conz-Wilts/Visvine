import { NextRequest, NextResponse } from "next/server";
import { parseBody, requireApiSession } from "@/lib/api/route";
import { assertCrmPermission, PermissionError } from "@/lib/crm/permissions";
import { revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { COMMUNITY_ROLES } from "@/lib/crm/roles";
import { LastAdminError, guardLastAdminThenMutate } from "@/lib/crm/lastAdminGuard";

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
    role: z.enum(COMMUNITY_ROLES),
  }),
  z.object({
    action: z.literal("remove"),
    user_ids: z.array(z.string().min(1)).min(1).max(200),
  }),
]);

export async function POST(req: NextRequest, { params }: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

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

  const body = await parseBody(req, BulkActionSchema);
  if (body instanceof NextResponse) return body;

  const data = body;
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
    // Demotions to a non-admin role are guarded against stripping the last
    // admin; promotions to admin leave the headcount safe so skip the guard.
    try {
      affected = await guardLastAdminThenMutate(
        { communityId, userIds: data.user_ids, guard: data.role !== "admin" },
        async (tx) => {
          const result = await tx.userCommunity.updateMany({
            where: { communityId, userId: { in: data.user_ids } },
            data: { role: data.role },
          });
          return result.count;
        }
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
        action: "bulk_change_role",
        diff: {
          role: data.role,
          user_ids: data.user_ids,
          affected,
        } as unknown as Prisma.InputJsonObject,
      },
    });
  } else if (data.action === "remove") {
    // Atomic last-admin guard (see change_role above).
    try {
      affected = await guardLastAdminThenMutate(
        { communityId, userIds: data.user_ids, guard: true },
        async (tx) => {
          const result = await tx.userCommunity.deleteMany({
            where: { communityId, userId: { in: data.user_ids } },
          });
          return result.count;
        }
      );
    } catch (e) {
      if (e instanceof LastAdminError) {
        return NextResponse.json(
          { error: "last_admin_protected", message: "Cannot remove the last admin." },
          { status: 409 }
        );
      }
      throw e;
    }

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
