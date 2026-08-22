import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/session";
import { safeRelativePath } from "@/lib/redirects";
import { verifyPassword, validateEmail } from "@/lib/auth/password";
import { ensurePerson, setSessionCookie } from "@/lib/auth/bootstrap";
import prisma from "@/lib/prisma";
import { takeToken } from "@/lib/rateLimit";

const GENERIC_ERROR = "Invalid email or password.";

// Credential-stuffing brake, keyed by IP + email, and shared across instances
// (lib/rateLimit.ts) because a per-process one is not a brake here: an attacker
// reaching a service that scales out gets a fresh allowance per instance and
// again on every cold start.
//
// 10 back-to-back attempts, then one more every 90s — the same shape as a
// 10-per-15-minutes window, expressed as the bucket the shared limiter speaks.
const LOGIN_LIMIT = { capacity: 10, refillPerSec: 10 / (15 * 60) };

// Per attacker-controlled key, so it must not be a way to grow the bucket table
// without bound: the shared limiter hashes keys and sweeps idle ones.
const CREDENTIAL_KEY = (ip: string, email: string) => `login:${ip}:${email}`;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status });
}

/**
 * Email/password sign-in. Returns a generic 401 for unknown email, wrong
 * password, or Google-only accounts (no password set) to avoid account
 * enumeration. On success, mints the session cookie and returns the redirect
 * target (the callbackUrl).
 */
export async function POST(req: NextRequest) {
  let body: { email?: unknown; password?: unknown; callbackUrl?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const callbackUrl = safeRelativePath(
    typeof body.callbackUrl === "string" ? body.callbackUrl : null
  );

  if (!validateEmail(email).ok || !password) {
    return json({ error: GENERIC_ERROR }, 401);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = await takeToken(CREDENTIAL_KEY(ip, email), LOGIN_LIMIT);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again in a few minutes." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
      }
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
    return json({ error: GENERIC_ERROR }, 401);
  }

  const person = await ensurePerson({
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
  });

  const token = await createSession({
    userId: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    personId: person.id,
  });

  const redirectTo = callbackUrl === "/" ? "/home" : callbackUrl;
  return setSessionCookie(json({ redirectTo }, 200), token);
}
