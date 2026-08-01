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
  // Public event share pages + their no-login RSVP API (visvine.com/e/<slug>).
  "/e/",
  "/api/public",
  // MCP server + its self-hosted OAuth 2.1 layer. These must bypass the HTML
  // redirect-to-/signin: the MCP endpoint answers 401 + WWW-Authenticate and
  // the OAuth endpoints validate Bearer/PKCE/cookie themselves. (`/.well-known`
  // serves public discovery metadata.)
  "/.well-known/oauth-",
  "/api/oauth",
  "/api/mcp",
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

  // A logged-out visitor opening an in-app event detail link (/events/<id>)
  // should land on the public share page (/e/<slug>) — which renders the event
  // for public events and 404s for non-public ones — rather than a login wall.
  // (getEventBySlug resolves by alias OR `event:<slug>` id, so the bare id works
  // as the slug here without a DB lookup.) Organizer sub-routes
  // (/events/<id>/manage|edit|rsvp), the list (/events) and /events/new are not
  // matched and still fall through to sign-in.
  const eventDetail = pathname.match(/^\/events\/([^/]+)$/);
  if (eventDetail && eventDetail[1] !== "new") {
    const slug = decodeURIComponent(eventDetail[1]).replace(/^event:/, "");
    return NextResponse.redirect(new URL(`/e/${encodeURIComponent(slug)}`, req.url));
  }

  const signIn = new URL("/signin", req.url);
  signIn.searchParams.set("callbackUrl", pathname);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
