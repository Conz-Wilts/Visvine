import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/session";
import { hashPassword, validateSignup } from "@/lib/auth/password";
import { ensurePerson, setSessionCookie } from "@/lib/auth/bootstrap";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const EXISTS_MESSAGE =
  "An account with this email already exists. Sign in instead.";

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status });
}

/**
 * Email/password account creation. Creates a brand-new active user, bootstraps
 * their Person, mints the session cookie, and points the client at onboarding.
 *
 * Existing emails (active OR pre-seeded "shadow" CRM profiles) are rejected with
 * a 409 — claiming a shadow profile stays a Google-only flow, since we have no
 * email-verification to prove ownership of a password signup.
 */
export async function POST(req: NextRequest) {
  let body: { name?: unknown; email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const valid = validateSignup(body);
  if (!valid.ok) return json({ error: valid.error }, 400);

  const name = (body.name as string).trim();
  const email = (body.email as string).trim().toLowerCase();
  const password = body.password as string;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return json({ error: EXISTS_MESSAGE, code: "exists" }, 409);

  let user;
  try {
    user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash: hashPassword(password),
        emailVerified: false,
        isActive: true,
      },
    });
  } catch (e) {
    // Race: another request inserted the same email between our check and create.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return json({ error: EXISTS_MESSAGE, code: "exists" }, 409);
    }
    throw e;
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

  // Brand-new users have never onboarded, so always start there.
  return setSessionCookie(json({ redirectTo: "/onboarding" }, 200), token);
}
