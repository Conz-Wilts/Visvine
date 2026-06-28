import { NextResponse } from "next/server";
import { getSession, isSuperAdmin } from "@/lib/session";

export async function GET() {
  // getSession() already prefers a Bearer token (mobile) over the cookie (web).
  const session = await getSession();
  if (!session) return NextResponse.json({ session: null });

  return NextResponse.json({
    session: {
      user: {
        id: session.userId,
        name: session.name,
        email: session.email,
        image: session.image,
        nodeId: session.personId,
        isSuperAdmin: isSuperAdmin(session.email),
      },
    },
  });
}
