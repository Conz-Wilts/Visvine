import { NextRequest, NextResponse } from "next/server";
import { verifySession, COOKIE_NAME } from "@/lib/session";
import { isDevAuthEnabled } from "@/lib/dev-auth";
import { toolsHostDecision } from "@/lib/tools/origin";
import { buildCsp, newNonce } from "@/lib/security/csp";
import {
  isSpaceScopedPath,
  parseSpacePath,
  SPACE_URL_PREFIX,
  type SpaceUrl,
} from "@/lib/spaces/shared/spaceUrl";
import { SPACE_COOKIE, SPACE_PREFIX_HEADER } from "@/lib/spaces/shared/spaceCookie";

const PUBLIC_PATHS = [
  "/signin",
  "/api/auth",
  // Liveness/readiness probe. Must answer before any session machinery runs —
  // a health check that needs the auth stack to be healthy cannot report on it.
  "/api/health",
  "/claim",
  // The desktop shell's sign-in page gates itself, so the challenge on its URL
  // survives the hop through /signin (this redirect carries the path alone).
  "/desktop/signin",
  "/api/media",
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
  // A file an AI chat asked for: the upload token in the path is the
  // credential (lib/resources/uploadToken.ts) — a sandbox's curl and a phone
  // with no session both reach it.
  "/api/uploads/",
  "/drop/",
  ...(isDevAuthEnabled() ? ["/dev", "/api/dev"] : []),
];

/**
 * The Tool runtime is the one surface whose CSP is NOT ours to set. Its routes
 * mint a per-response policy naming the app as the only permitted frame-ancestor
 * and pinning `connect-src 'none'` (lib/tools/csp.ts) — that `connect-src` is
 * the entire exfiltration control the sandbox rests on. Overwriting it from
 * here with the app's own policy would not merge with it; it would replace it.
 */
const TOOL_RUNTIME_PREFIX = "/api/tools/runtime";

/** The consent form's approve response is a cross-origin 303. See buildCsp. */
const OAUTH_AUTHORIZE = "/api/oauth/authorize";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Minted before anything branches, so that EVERY response below carries the
  // same policy — a redirect to /signin and a 401 JSON body are documents a
  // browser will happily render, and a policy that only covers the happy path
  // is a policy with holes in it.
  const nonce = newNonce();
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    toolsOrigin: process.env.TOOLS_ORIGIN || null,
    allowCrossOriginFormPost: pathname === OAUTH_AUTHORIZE,
    // Cloud Run terminates TLS and forwards the original scheme; the nextUrl
    // check covers running behind nothing at all.
    isSecureOrigin:
      req.headers.get("x-forwarded-proto") === "https" || req.nextUrl.protocol === "https:",
  });

  /** Stamp the policy on a response on its way out. */
  const secured = (res: NextResponse): NextResponse => {
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  /**
   * Continue rendering, handing the nonce forward on the REQUEST. Next reads it
   * back off this header during server rendering and stamps its own bootstrap
   * and bundles with it — which is what makes `'strict-dynamic'` work without
   * anything in app code having to know about nonces.
   */
  const forward = (): NextResponse => {
    const headers = new Headers(req.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    return secured(NextResponse.next({ request: { headers } }));
  };

  // The Tool frame origin (TOOLS_ORIGIN, e.g. tools.visvine.com) is this same
  // service reached under a different host. It exists so that third-party Tool
  // code runs where no `auth_session` cookie is scoped, so it serves the Tool
  // runtime and NOTHING else — no page, no session-bearing API — and touches no
  // cookie either way. Runtime paths pass through unauthenticated; the frame
  // token in the URL is what authorizes them. See lib/tools/origin.ts.
  const hostDecision = toolsHostDecision(req.headers.get("host"), pathname);
  if (hostDecision === "tool-runtime") return NextResponse.next();

  // The same paths reached on the APP host — the same-origin fallback while
  // TOOLS_ORIGIN is unset. They too must keep the frame's own policy, so they
  // leave before anything below can stamp the app's over it.
  if (pathname.startsWith(TOOL_RUNTIME_PREFIX)) return NextResponse.next();
  if (hostDecision === "not-found") {
    return new NextResponse("Not Found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  // Tools run on the web and in the desktop shell. The phone apps are the only
  // clients that send a session as a Bearer token (lib/tools/clientClass.ts),
  // so a Bearer header on a Tool door is refused before any route runs; the
  // routes refuse it again on their own.
  if (pathname.startsWith("/api/tools/") && req.headers.get("authorization")?.startsWith("Bearer ")) {
    return secured(NextResponse.json({ error: "Tools run on the web and in the desktop app." }, { status: 403 }));
  }

  const isPublic =
    pathname === "/" ||
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/fonts") ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/uploads");

  if (isPublic) return forward();

  /**
   * A signed-in request for a page. A space URL (`/s/<space>/<page>`) renders
   * the unprefixed route, told which prefix it came under; an unprefixed space
   * page is sent to the same page under a space — the one the page it was
   * opened FROM stands in, so a tab keeps its own space, else the space this
   * browser last stood in. With neither (a first visit, no space yet), it
   * renders as it is and the client decides.
   */
  const signedIn = (): NextResponse => {
    const spaceUrl = parseSpacePath(pathname);
    if (spaceUrl) {
      const prefix = spacePrefixOf(spaceUrl);
      const headers = new Headers(req.headers);
      headers.set("x-nonce", nonce);
      headers.set("Content-Security-Policy", csp);
      headers.set(SPACE_PREFIX_HEADER, prefix);
      const target = new URL(`${spaceUrl.rest}${req.nextUrl.search}`, req.url);
      const res = NextResponse.rewrite(target, { request: { headers } });
      const remembered = prefix.slice(SPACE_URL_PREFIX.length + 1);
      if (req.cookies.get(SPACE_COOKIE)?.value !== remembered) {
        res.cookies.set(SPACE_COOKIE, remembered, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
      }
      return secured(res);
    }
    if (req.method === "GET" && isSpaceScopedPath(pathname)) {
      const prefix = refererSpacePrefix(req) ?? cookieSpacePrefix(req);
      if (prefix) {
        return secured(NextResponse.redirect(new URL(`${prefix}${pathname}${req.nextUrl.search}`, req.url), 307));
      }
    }
    return forward();
  };

  // Check cookie-based session
  const cookieToken = req.cookies.get(COOKIE_NAME)?.value;
  if (cookieToken) {
    const session = await verifySession(cookieToken);
    if (session) return signedIn();
  }

  // Check Bearer token (mobile app)
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const bearerToken = authHeader.substring(7);
    const session = await verifySession(bearerToken);
    if (session) return signedIn();
  }

  // API requests must never be redirected to the sign-in page: a JSON client
  // follows the redirect, receives the /signin HTML with a 200, and surfaces
  // garbage ("Cannot destructure property … of null") instead of a clean
  // signed-out signal. Answer 401 JSON and drop the dead cookie so the client
  // can react (lib/fetchJson.ts sends the user to /signin on 401).
  if (pathname.startsWith("/api/")) {
    const res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (cookieToken) res.cookies.delete(COOKIE_NAME);
    return secured(res);
  }

  // A logged-out visitor opening an in-app event detail link (/events/<id>)
  // should land on the public share page (/e/<slug>) — which renders the event
  // for public events and 404s for non-public ones — rather than a login wall.
  // (getEventBySlug resolves by alias OR `event:<slug>` id, so the bare id works
  // as the slug here without a DB lookup.) Organizer sub-routes
  // (/events/<id>/manage|edit|rsvp), and the list (/events) are not
  // matched and still fall through to sign-in.
  const eventDetail = (parseSpacePath(pathname)?.rest ?? pathname).match(/^\/events\/([^/]+)$/);
  if (eventDetail && eventDetail[1] !== "new") {
    const slug = decodeURIComponent(eventDetail[1]).replace(/^event:/, "");
    return secured(NextResponse.redirect(new URL(`/e/${encodeURIComponent(slug)}`, req.url)));
  }

  const signIn = new URL("/signin", req.url);
  signIn.searchParams.set("callbackUrl", pathname);
  const redirect = NextResponse.redirect(signIn);
  // A cookie that exists but failed verification is dead weight — clear it so
  // it can't keep bouncing future requests.
  if (cookieToken) redirect.cookies.delete(COOKIE_NAME);
  return secured(redirect);
}

/** `/s/<house>` or `/s/<house>/<room>`, as the URL spelled it. */
function spacePrefixOf(url: SpaceUrl): string {
  const house = encodeURIComponent(url.houseId);
  return url.roomId
    ? `${SPACE_URL_PREFIX}/${house}/${encodeURIComponent(url.roomId)}`
    : `${SPACE_URL_PREFIX}/${house}`;
}

/** The space of the same-origin page a request was made from, if it stood in one. */
function refererSpacePrefix(req: NextRequest): string | null {
  const referer = req.headers.get("referer");
  if (!referer) return null;
  try {
    const from = new URL(referer);
    if (from.host !== req.nextUrl.host && from.host !== req.headers.get("host")) return null;
    const url = parseSpacePath(from.pathname);
    return url ? spacePrefixOf(url) : null;
  } catch {
    return null;
  }
}

/** The space this browser last stood in. */
function cookieSpacePrefix(req: NextRequest): string | null {
  const value = req.cookies.get(SPACE_COOKIE)?.value;
  if (!value) return null;
  const url = parseSpacePath(`${SPACE_URL_PREFIX}/${value}/home`);
  return url ? spacePrefixOf(url) : null;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
