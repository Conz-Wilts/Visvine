import { NextRequest, NextResponse } from "next/server";
import { verifySession, COOKIE_NAME } from "@/lib/session";
import { isDevAuthEnabled } from "@/lib/dev-auth";

const PUBLIC_PATHS = [
  "/signin",
  "/api/auth",
  "/claim",
  "/api/media",
  // Marketing / pre-auth surfaces (the bare "/" home is already public below).
  // NOTE: "/blog" is a startsWith prefix, so it also matches "/blog/admin" —
  // that page and draft visibility on "/blog/[slug]" self-gate via isSuperAdmin.
  "/manifesto",
  "/contact",
  "/blog",
  "/api/waitlist",
  "/api/blog",
  ...(isDevAuthEnabled() ? ["/dev", "/api/dev"] : []),
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname === "/" ||
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/fonts") ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/uploads");

  if (isPublic) return NextResponse.next();

  // Check cookie-based session
  const cookieToken = req.cookies.get(COOKIE_NAME)?.value;
  if (cookieToken) {
    const session = await verifySession(cookieToken);
    if (session) return NextResponse.next();
  }

  // Check Bearer token (mobile app)
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const bearerToken = authHeader.substring(7);
    const session = await verifySession(bearerToken);
    if (session) return NextResponse.next();
  }

  const signIn = new URL("/signin", req.url);
  signIn.searchParams.set("callbackUrl", pathname);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
