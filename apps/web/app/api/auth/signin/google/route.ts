import { NextRequest, NextResponse } from "next/server";
import { isDevAuthEnabled } from "@/lib/dev-auth";

export function GET(req: NextRequest) {
  const callbackUrl = req.nextUrl.searchParams.get("callbackUrl") ?? "/directory";
  // The sign-in card offers a separate "Dev login" button; the Google button
  // passes ?real=1 so it always runs real OAuth, even with ENABLE_DEV_AUTH set.
  const forceReal = req.nextUrl.searchParams.get("real") === "1";

  // In local dev with ENABLE_DEV_AUTH=true, skip Google entirely and send the
  // user to the dev picker — unless real OAuth was explicitly requested.
  if (isDevAuthEnabled() && !forceReal) {
    const devLogin = new URL("/dev/login", req.url);
    devLogin.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(devLogin);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const redirectUri = `${appUrl}/api/auth/callback/google`;

  const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleUrl.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  googleUrl.searchParams.set("redirect_uri", redirectUri);
  googleUrl.searchParams.set("response_type", "code");
  googleUrl.searchParams.set("scope", "openid email profile");
  googleUrl.searchParams.set("state", encodeURIComponent(callbackUrl));

  return NextResponse.redirect(googleUrl.toString());
}
