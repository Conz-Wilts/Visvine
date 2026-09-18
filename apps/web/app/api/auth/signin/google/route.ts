import { NextRequest, NextResponse } from "next/server";

export function GET(req: NextRequest) {
  const callbackUrl = req.nextUrl.searchParams.get("callbackUrl") ?? "/home";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const redirectUri = `${appUrl}/api/auth/callback/google`;

  const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleUrl.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  googleUrl.searchParams.set("redirect_uri", redirectUri);
  googleUrl.searchParams.set("response_type", "code");
  googleUrl.searchParams.set("scope", "openid email profile");
  googleUrl.searchParams.set("state", encodeURIComponent(callbackUrl));
  // Google reuses the browser's signed-in account unless it is told otherwise.
  // Only the two prompts that mean "ask me again" are passed on, so nothing a
  // caller puts on this URL can change the flow itself.
  const prompt = req.nextUrl.searchParams.get("prompt");
  if (prompt === "select_account" || prompt === "consent") googleUrl.searchParams.set("prompt", prompt);

  return NextResponse.redirect(googleUrl.toString());
}
