import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { requestMemo } from "@/lib/requestMemo";

export const COOKIE_NAME = "auth_session";
export const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET environment variable is not set");
  // HS256 is only as strong as its key. Reject anything short enough to be
  // brute-forced offline from an issued JWT (e.g. the dev placeholder leaking
  // into prod). 32+ chars ≈ 256 bits of entropy for a random secret.
  if (secret.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters (use `openssl rand -hex 32`)");
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  userId: string;
  name: string;
  email: string;
  image?: string | null;
  /** The person's own node — their profile page (User.nodeId). */
  nodeId?: string | null;
  /**
   * Which sign-in door issued the token, set only by the phone apps' doors.
   * It records the route, not the device — any client can walk a sign-in flow
   * — so what keeps tools off the phones is the transport (`getSessionInfo`).
   */
  cl?: 'mobile';
}

/**
 * Mint a session JWT. `maxAgeSeconds` defaults to the 30-day web session; a
 * caller minting a session for its own short-lived use (the headless Tool
 * preview in lib/tools/screenshot.ts) passes something far smaller so the
 * token is worthless minutes after the job it was minted for.
 */
export async function createSession(
  payload: SessionPayload,
  opts: { maxAgeSeconds?: number } = {},
): Promise<string> {
  const maxAge = Math.min(MAX_AGE, Math.max(1, Math.floor(opts.maxAgeSeconds ?? MAX_AGE)));
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    // Pin the algorithm: a symmetric key already makes jose reject `alg:none`
    // and RSA/EC confusion, but stating HS256 keeps that guarantee explicit
    // against a future refactor that swaps in an asymmetric key.
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    // Other tokens are signed with this key too (the upload token, the
    // connector OAuth pending cookie, the CRM claim), several naming a
    // `userId`. Each marks its purpose with an audience or a type; a session
    // carries neither, so a token that does is never a login.
    if ("aud" in payload || "typ" in payload || "type" in payload) return null;
    if (typeof payload.userId !== "string" || !payload.userId) return null;
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Returns true if the given email is listed in SUPER_ADMIN_EMAILS.
 * Super admins have admin access to every space without a DB membership record.
 */
export function isSuperAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const raw = process.env.SUPER_ADMIN_EMAILS ?? '';
  const admins = raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(email.toLowerCase());
}

// Sessions are 30-day JWTs, so a token can outlive its user row (a rebuilt
// database, a deleted account). Without this check such a session passes
// verification and then fails deeper down as Forbidden responses and
// foreign-key violations instead of a clean sign-out. The checker is injected
// by lib/prisma.ts because proxy.ts (edge) imports this module, which
// therefore can never import the DB client itself; when no checker is
// registered the gate is skipped.
let userExistsCheck: ((userId: string) => Promise<boolean>) | null = null;

export function setSessionUserCheck(fn: (userId: string) => Promise<boolean>): void {
  userExistsCheck = fn;
}

/**
 * Whether the session's user row still exists and is active. Runs the injected
 * DB check (or passes when none is registered, e.g. the edge bundle). Exposed so
 * the API gates in lib/api/route.ts enforce the same liveness check that
 * requireSession does — otherwise a deleted/deactivated account's still-valid
 * 30-day JWT keeps authenticating on every requireApiSession route.
 */
export async function sessionUserValid(userId: string): Promise<boolean> {
  return userExistsCheck ? userExistsCheck(userId) : true;
}

/**
 * How a session reached this request. Web and the desktop shell hold the
 * `auth_session` cookie; the phone apps are the only clients that send their
 * session as a Bearer token. The transport is observed, never signed into the
 * token — it is what keeps tools off the phones (lib/tools/clientClass.ts).
 */
type SessionTransport = 'cookie' | 'bearer';

export interface SessionInfo {
  session: SessionPayload;
  transport: SessionTransport;
}

/**
 * The caller's session and how it arrived, read once per request: a route's
 * own gate, the context resolver and any helper underneath all share one
 * verification.
 */
export const getSessionInfo = requestMemo('sessionInfo', async (): Promise<SessionInfo | null> => {
  const headerStore = await headers();
  const authHeader = headerStore.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const bearer = authHeader.substring(7);
    const session = await verifySession(bearer);
    if (session) return { session, transport: 'bearer' };
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await verifySession(token);
  return session ? { session, transport: 'cookie' } : null;
});

/** The caller's session, read once per request (see {@link getSessionInfo}). */
export async function getSession(): Promise<SessionPayload | null> {
  return (await getSessionInfo())?.session ?? null;
}

/**
 * Returns the current session or a 401 JSON response.
 * Use in API routes: `const session = await requireSession(); if (session instanceof Response) return session;`
 */
export async function requireSession(): Promise<SessionPayload | Response> {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (userExistsCheck && !(await userExistsCheck(session.userId))) {
    // Stale token: clear the cookie so the next page navigation lands on
    // /signin instead of replaying the dead session forever. Harmless for
    // Bearer (mobile) callers, which just see the 401.
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${
          process.env.NODE_ENV === 'production' ? '; Secure' : ''
        }`,
      },
    });
  }
  return session;
}
