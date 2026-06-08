import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/session";
import { isDevAuthEnabled, devAuthDisabledResponse } from "@/lib/dev-auth";

export async function GET(req: NextRequest) {
  if (!isDevAuthEnabled()) return devAuthDisabledResponse();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const callbackUrl = req.nextUrl.searchParams.get("callbackUrl") ?? "/";
  const response = NextResponse.redirect(new URL(callbackUrl, appUrl));
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}
