import { NextRequest, NextResponse } from "next/server";
import { createSession, COOKIE_NAME, MAX_AGE } from "@/lib/session";
import { isDevAuthEnabled, devAuthDisabledResponse } from "@/lib/dev-auth";
import { safeRelativePath } from "@/lib/redirects";
import prisma from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  if (!isDevAuthEnabled()) return devAuthDisabledResponse();

  const { userId } = await params;
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

  // Dev-only "Create account" path: reset the user's onboarding flag so the
  // wizard runs again, and land them on /onboarding instead of the callback.
  // This lets us review the full sign-up/onboarding flow with a seeded user.
  const onboard = req.nextUrl.searchParams.get("onboard") === "1";
  if (onboard && user.person) {
    await prisma.person.update({
      where: { id: user.person.id },
      data: { hasOnboarded: false },
    });
  }

  const callbackUrl = onboard
    ? "/onboarding"
    : safeRelativePath(req.nextUrl.searchParams.get("callbackUrl"));
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  // 303 See Other so the browser follows with a GET — a default (307) redirect
  // would replay this POST against the destination page, which only handles GET
  // and renders a blank screen.
  const response = NextResponse.redirect(new URL(callbackUrl, appUrl), 303);
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
  return response;
}
