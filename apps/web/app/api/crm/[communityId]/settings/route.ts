import { NextRequest, NextResponse } from "next/server";
import { requireCommunityAdmin } from "@/lib/api/route";
import { CommunitySettingsSchema } from "@/lib/schemas/crm";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

type RouteContext = { params: Promise<{ communityId: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { communityId } = await params;

  const session = await requireCommunityAdmin(communityId);
  if (session instanceof NextResponse) return session;

  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { crmSettings: true },
  });

  if (!community) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const settings = community.crmSettings as { fields?: unknown[] };
  return NextResponse.json({ fields: settings.fields ?? [] });
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  const { communityId } = await params;

  const session = await requireCommunityAdmin(communityId);
  if (session instanceof NextResponse) return session;

  const body = CommunitySettingsSchema.safeParse(await req.json());
  if (!body.success)
    return NextResponse.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });

  await prisma.community.update({
    where: { id: communityId },
    data: { crmSettings: { fields: body.data.fields } as Prisma.InputJsonObject },
  });

  return NextResponse.json({ fields: body.data.fields });
}
