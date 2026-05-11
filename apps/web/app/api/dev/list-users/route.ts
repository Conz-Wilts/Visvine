import { isDevAuthEnabled, devAuthDisabledResponse } from "@/lib/dev-auth";
import prisma from "@/lib/prisma";

export async function GET() {
  if (!isDevAuthEnabled()) return devAuthDisabledResponse();

  const users = await prisma.user.findMany({
    where: { email: { endsWith: "@local.dev" } },
    select: { id: true, name: true, email: true, image: true },
    orderBy: { email: "asc" },
  });

  return Response.json({ users });
}
