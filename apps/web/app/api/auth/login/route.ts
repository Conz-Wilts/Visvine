import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/session";
import { safeRelativePath } from "@/lib/redirects";
import { verifyPassword, validateEmail } from "@/lib/auth/password";
import { ensurePerson, setSessionCookie, postAuthTarget } from "@/lib/auth/bootstrap";
import prisma from "@/lib/prisma";

const GENERIC_ERROR = "Invalid email or password.";

// In-memory sliding-window limiter (per Node process), keyed by IP + email.
// Slows credential-stuffing without external infra. Mirrors lib/crm/rateLimit.ts.
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, number[]>();

function isRateLimited(key: string): boolean {
  const windowStart = Date.now() - WINDOW_MS;
  const recent = (attempts.get(key) ?? []).filter((t) => t > windowStart);
  attempts.set(key, recent);
  if (recent.length >= MAX_ATTEMPTS) return true;
  recent.push(Date.now());
  return false;
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status });
}

/**
 * Email/password sign-in. Returns a generic 401 for unknown email, wrong
 * password, or Google-only accounts (no password set) to avoid account
 * enumeration. On success, mints the session cookie and returns the redirect
 * target (onboarding if not yet onboarded, otherwise the callbackUrl).
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
  if (isRateLimited(`${ip}:${email}`)) {
    return json(
      { error: "Too many attempts. Please try again in a few minutes." },
      429
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

  const dest = callbackUrl === "/" ? "/directory" : callbackUrl;
  const redirectTo = postAuthTarget(person.hasOnboarded, dest);
  return setSessionCookie(json({ redirectTo }, 200), token);
}
