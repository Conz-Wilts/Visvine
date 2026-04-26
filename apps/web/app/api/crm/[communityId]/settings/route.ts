import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { assertCrmPermission, PermissionError } from "@/lib/crm/permissions";
import { CommunitySettingsSchema } from "@/lib/schemas/crm";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

type RouteContext = { params: Promise<{ communityId: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { communityId } = await params;

  try {
    await assertCrmPermission(session.userId, session.email, communityId, "view_crm");
  } catch (e) {
    if (e instanceof PermissionError)
      return NextResponse.json({ error: "permission_denied" }, { status: 403 });
    throw e;
  }

  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { crmSettings: true },
  });

  if (!community) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const settings = community.crmSettings as { fields?: unknown[] };
  return NextResponse.json({ fields: settings.fields ?? [] });
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { communityId } = await params;

  try {
    await assertCrmPermission(session.userId, session.email, communityId, "configure_fields");
  } catch (e) {
    if (e instanceof PermissionError)
      return NextResponse.json({ error: "permission_denied" }, { status: 403 });
    throw e;
  }

  const body = CommunitySettingsSchema.safeParse(await req.json());
  if (!body.success)
    return NextResponse.json({ error: "invalid_body", details: body.error.flatten() }, { status: 400 });

  await prisma.community.update({
    where: { id: communityId },
    data: { crmSettings: { fields: body.data.fields } as Prisma.InputJsonObject },
  });

  return NextResponse.json({ fields: body.data.fields });
}
