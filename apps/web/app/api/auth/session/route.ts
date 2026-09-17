import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { resolveSessionUser } from "@/lib/sessionUser";

export async function GET() {
  // getSession() already prefers a Bearer token (mobile) over the cookie (web).
  const session = await getSession();
  if (!session) return NextResponse.json({ session: null });

  // The editable half of the session comes from the user's row, not the token:
  // a 30-day JWT would otherwise keep serving the picture they had at sign-in.
  return NextResponse.json({ session: { user: await resolveSessionUser(session) } });
}
