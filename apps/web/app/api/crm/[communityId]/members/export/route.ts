import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { assertCrmPermission, PermissionError } from "@/lib/crm/permissions";
import { listCommunityMembers, MemberRow } from "@/lib/crm/memberService";
import { FieldDefinition } from "@/lib/schemas/crm";
import { MemberListQuerySchema } from "@/lib/schemas/crm";
import prisma from "@/lib/prisma";

type RouteContext = { params: Promise<{ communityId: string }> };

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

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

  const query = MemberListQuerySchema.safeParse({
    ...Object.fromEntries(req.nextUrl.searchParams),
    limit: 200,
    page: 1,
  });
  if (!query.success)
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { crmSettings: true },
  });
  const settings = (community?.crmSettings as { fields?: FieldDefinition[] }) ?? {};
  const privateFields: FieldDefinition[] = settings.fields ?? [];

  // Fetch all pages
  const allMembers: MemberRow[] = [];
  let page = 1;
  while (true) {
    const { members, total } = await listCommunityMembers(communityId, {
      ...query.data,
      page,
      limit: 200,
    });
    allMembers.push(...members);
    if (allMembers.length >= total) break;
    page++;
  }

  const publicHeaders = ["email", "name", "headline", "bio", "location", "status", "role", "joined_at"];
  const privateHeaders = privateFields.map((f) => f.key);
  const headers = [...publicHeaders, ...privateHeaders];

  const csvLines = [
    headers.join(","),
    ...allMembers.map((m) => {
      const publicCols = [
        m.email,
        m.name,
        m.headline ?? "",
        m.bio ?? "",
        m.location ?? "",
        m.is_active ? "active" : "shadow",
        m.role,
        m.joined_at,
      ].map(escapeCSV);

      const privateCols = privateHeaders.map((key) =>
        escapeCSV(m.private_meta[key] ?? "")
      );

      return [...publicCols, ...privateCols].join(",");
    }),
  ];

  const csv = csvLines.join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="members-${communityId}.csv"`,
    },
  });
}
