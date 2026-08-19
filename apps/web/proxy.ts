import { NextRequest, NextResponse } from "next/server";
import { verifySession, COOKIE_NAME } from "@/lib/session";
import { isDevAuthEnabled } from "@/lib/dev-auth";
import { toolsHostDecision } from "@/lib/tools/origin";

const PUBLIC_PATHS = [
  "/signin",
  "/api/auth",
  "/claim",
  "/api/media",
  // Marketing / pre-auth surfaces (the bare "/" home is already public below).
  "/manifesto",
  "/contact",
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
  // Machine-to-machine endpoints for the agent scheduler: no user session by
  // nature. "Public" only means "no cookie" — each route authenticates itself
  // (Cloud Scheduler OIDC for the tick, an internal HS256 token for the run).
  "/api/internal/",
  // Inbound connector webhooks: a provider posts here with no session. The
  // route authenticates itself — a per-connector URL token plus the note's
  // declared signature scheme (lib/connectors/webhookInbound.ts).
  "/api/hooks/",
  // The sandboxed Tool runtime (frame document, compiled bundles, vendor ESM).
  // Served from a cookie-less origin, so it authenticates with the short-lived
  // frame token minted by the host page (lib/tools/frameToken.ts), never a
  // session. Listed here so the SAME paths work on the app host too — that is
  // the same-origin fallback while TOOLS_ORIGIN is unset.
  "/api/tools/runtime",
  ...(isDevAuthEnabled() ? ["/dev", "/api/dev"] : []),
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // The Tool frame origin (TOOLS_ORIGIN, e.g. tools.visvine.com) is this same
  // service reached under a different host. It exists so that third-party Tool
  // code runs where no `auth_session` cookie is scoped, so it serves the Tool
  // runtime and NOTHING else — no page, no session-bearing API — and touches no
  // cookie either way. Runtime paths pass through unauthenticated; the frame
  // token in the URL is what authorizes them. See lib/tools/origin.ts.
  const hostDecision = toolsHostDecision(req.headers.get("host"), pathname);
  if (hostDecision === "tool-runtime") return NextResponse.next();
  if (hostDecision === "not-found") {
    return new NextResponse("Not Found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

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

  // API requests must never be redirected to the sign-in page: a JSON client
  // follows the redirect, receives the /signin HTML with a 200, and surfaces
  // garbage ("Cannot destructure property … of null") instead of a clean
  // signed-out signal. Answer 401 JSON and drop the dead cookie so the client
  // can react (lib/fetchJson.ts sends the user to /signin on 401).
  if (pathname.startsWith("/api/")) {
    const res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (cookieToken) res.cookies.delete(COOKIE_NAME);
    return res;
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
  const redirect = NextResponse.redirect(signIn);
  // A cookie that exists but failed verification is dead weight — clear it so
  // it can't keep bouncing future requests.
  if (cookieToken) redirect.cookies.delete(COOKIE_NAME);
  return redirect;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
