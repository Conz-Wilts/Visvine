import { NextRequest, NextResponse } from "next/server";
import { parseBody, requireCommunityAdmin } from "@/lib/api/route";
import { revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { assertMembersCanLeave } from "@/lib/notes/aliases";
import { removeMemberAccess } from "@/lib/notes/access";

type RouteContext = { params: Promise<{ communityId: string }> };

const BulkActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_private"),
    user_ids: z.array(z.string().min(1)).min(1).max(200),
    field: z.string().min(1).max(64),
    value: z.unknown(),
  }),
  z.object({
    action: z.literal("remove"),
    user_ids: z.array(z.string().min(1)).min(1).max(200),
  }),
]);

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { communityId } = await params;

  const session = await requireCommunityAdmin(communityId);
  if (session instanceof NextResponse) return session;

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
  } else if (data.action === "remove") {
    // Somebody must still be able to manage the community afterwards.
    try {
      await assertMembersCanLeave(communityId, data.user_ids);
    } catch (e) {
      return NextResponse.json(
        { error: "last_admin_protected", message: (e as Error).message },
        { status: 409 }
      );
    }

    const result = await prisma.userCommunity.deleteMany({
      where: { communityId, userId: { in: data.user_ids } },
    });
    affected = result.count;

    // Brain access leaves with them: direct grants + the aliases they held here.
    for (const userId of data.user_ids) {
      await removeMemberAccess(communityId, userId);
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

  revalidateTag(`crm-list-${communityId}`, { expire: 0 });
  return NextResponse.json({ affected });
}
