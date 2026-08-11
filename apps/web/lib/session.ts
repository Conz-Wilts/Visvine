import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";

export const COOKIE_NAME = "auth_session";
export const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET environment variable is not set");
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  userId: string;
  name: string;
  email: string;
  image?: string | null;
  personId?: string | null;
}

export async function createSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Returns true if the given email is listed in SUPER_ADMIN_EMAILS.
 * Super admins have admin access to every community without a DB membership record.
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
// registered the gate is skipped, which matches the old behavior.
let userExistsCheck: ((userId: string) => Promise<boolean>) | null = null;

export function setSessionUserCheck(fn: (userId: string) => Promise<boolean>): void {
  userExistsCheck = fn;
}

export async function getSession(): Promise<SessionPayload | null> {
  const headerStore = await headers();
  const authHeader = headerStore.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const bearer = authHeader.substring(7);
    const session = await verifySession(bearer);
    if (session) return session;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
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
