import { NextRequest, NextResponse } from "next/server";
import { requireCommunityAdmin } from "@/lib/api/route";
import { listCommunityMembers } from "@/lib/crm/memberService";
import { MemberListQuerySchema, CreateShadowMemberSchema } from "@/lib/schemas/crm";
import { Prisma } from "@prisma/client";
import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";

type RouteContext = { params: Promise<{ communityId: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { communityId } = await params;

  const session = await requireCommunityAdmin(communityId);
  if (session instanceof NextResponse) return session;

  const query = MemberListQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams)
  );
  if (!query.success)
    return NextResponse.json({ error: "invalid_query", details: query.error.flatten() }, { status: 400 });

  const { members, total } = await listCommunityMembers(communityId, query.data);

  return NextResponse.json({
    members,
    total,
    page: query.data.page,
    limit: query.data.limit,
  });
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { communityId } = await params;

  const session = await requireCommunityAdmin(communityId);
  if (session instanceof NextResponse) return session;

  const body = CreateShadowMemberSchema.safeParse(await req.json());
  if (!body.success)
    return NextResponse.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });

  const { email, name, headline, private_meta } = body.data;
  const normalizedEmail = email.toLowerCase();

  const publicMeta: Record<string, unknown> = { name };
  if (headline) publicMeta["headline"] = headline;

  let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name,
        isActive: false,
        publicMeta: publicMeta as Prisma.InputJsonObject,
      },
    });
  } else if (!user.isActive) {
    // Shadow exists — merge public_meta (existing wins)
    const existing = (user.publicMeta as Record<string, unknown>) ?? {};
    await prisma.user.update({
      where: { id: user.id },
      data: { publicMeta: { ...publicMeta, ...existing } as Prisma.InputJsonObject },
    });
  }
  // If active user: just add to community, don't touch their public data

  const existingMembership = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId: user.id, communityId } },
  });

  if (existingMembership) {
    return NextResponse.json({ error: "already_member" }, { status: 409 });
  }

  await prisma.userCommunity.create({
    data: {
      userId: user.id,
      communityId,
      addedBy: session.userId,
      privateMeta: (private_meta ?? {}) as Prisma.InputJsonObject,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: session.userId,
      communityId,
      targetId: user.id,
      action: "create_shadow",
      diff: { email: normalizedEmail, name },
    },
  });

  revalidateTag(`crm-list-${communityId}`, { expire: 0 });

  const member = await prisma.userCommunity.findUniqueOrThrow({
    where: { userId_communityId: { userId: user.id, communityId } },
    include: {
      user: { select: { email: true, isActive: true, name: true, image: true, publicMeta: true } },
    },
  });

  return NextResponse.json(member, { status: 201 });
}
