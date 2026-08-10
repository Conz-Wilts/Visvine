import { NextRequest } from "next/server";
import { createSession } from "@/lib/session";
import { isDevAuthEnabled, devAuthDisabledResponse } from "@/lib/dev-auth";
import prisma from "@/lib/prisma";

export async function POST(req: NextRequest) {
  if (!isDevAuthEnabled()) return devAuthDisabledResponse();

  let body: { userId?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const userId = typeof body.userId === "string" ? body.userId : null;
  if (!userId) {
    return new Response(JSON.stringify({ error: "userId required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { person: true },
  });
  if (!user) {
    return new Response(JSON.stringify({ error: "user not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const token = await createSession({
    userId: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    personId: user.person?.id ?? null,
  });

  return Response.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      personId: user.person?.id ?? null,
    },
  });
}
