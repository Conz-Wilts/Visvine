import { NextRequest, NextResponse } from "next/server";
import { getSession, isSuperAdmin, verifySession } from "@/lib/session";

export async function GET(req: NextRequest) {
  // Check for Bearer token (mobile app) or cookie (web)
  const authHeader = req.headers.get("authorization");
  let session = null;

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    session = await verifySession(token);
  } else {
    session = await getSession();
  }

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
