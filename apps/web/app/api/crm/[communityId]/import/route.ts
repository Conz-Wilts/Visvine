import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { assertCrmPermission, PermissionError } from "@/lib/crm/permissions";
import { parseCSV, processImport } from "@/lib/crm/importService";
import { checkImportRateLimit } from "@/lib/crm/rateLimit";
import { FieldDefinition } from "@/lib/schemas/crm";
import prisma from "@/lib/prisma";

type RouteContext = { params: Promise<{ communityId: string }> };

const MAX_ROWS = 1000;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(req: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { communityId } = await params;

  try {
    await assertCrmPermission(session.userId, session.email, communityId, "manage_members");
  } catch (e) {
    if (e instanceof PermissionError)
      return NextResponse.json({ error: "permission_denied" }, { status: 403 });
    throw e;
  }

  // Rate limit: 5 imports per hour per user/community
  const rl = checkImportRateLimit(session.userId, communityId);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retry_after_ms: rl.retryAfterMs },
      { status: 429 }
    );
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > MAX_BYTES)
    return NextResponse.json({ error: "file_too_large", max_mb: 5 }, { status: 400 });

  const csv = await file.text();
  const { rows } = parseCSV(csv);

  if (rows.length === 0)
    return NextResponse.json({ error: "empty_file" }, { status: 400 });
  if (rows.length > MAX_ROWS)
    return NextResponse.json({ error: "too_many_rows", max: MAX_ROWS }, { status: 400 });

  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { crmSettings: true },
  });
  const settings = (community?.crmSettings as { fields?: FieldDefinition[] }) ?? {};
  const privateFields: FieldDefinition[] = settings.fields ?? [];

  const { results, summary } = await processImport(
    communityId,
    session.userId,
    rows,
    privateFields
  );

  const errors = results.filter((r) => r.error);

  return NextResponse.json({ summary, errors });
}
