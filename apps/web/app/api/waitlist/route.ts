import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireSession, isSuperAdmin } from "@/lib/session";
import { sendWaitlistConfirmation } from "@/lib/email/waitlist";
import { takeToken } from "@/lib/messages/rateLimit";

export async function POST(request: Request) {
  let body: {
    firstName?: string;
    lastName?: string;
    email?: string;
    linkedin?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Public, unauthenticated endpoint that sends real email — throttle by client
  // IP before any DB write or mail send so abuse is rejected early.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const rl = takeToken(`waitlist:${ip}`, { capacity: 5, refillPerSec: 0.05 });
  if (!rl.ok) {
    return Response.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const firstName = body.firstName?.trim();
  const lastName = body.lastName?.trim();
  const email = body.email?.trim().toLowerCase();
  const linkedin = body.linkedin?.trim() || null;

  if (!firstName) {
    return Response.json({ error: "First name required" }, { status: 400 });
  }
  if (!lastName) {
    return Response.json({ error: "Last name required" }, { status: 400 });
  }
  if (firstName.length > 100 || lastName.length > 100) {
    return Response.json({ error: "Name too long" }, { status: 400 });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Invalid email" }, { status: 400 });
  }
  if (linkedin && linkedin.length > 200) {
    return Response.json({ error: "LinkedIn URL too long" }, { status: 400 });
  }
  if (linkedin && !/^https?:\/\/([a-z]{2,3}\.)?linkedin\.com(\/.*)?$/i.test(linkedin)) {
    return Response.json({ error: "Invalid LinkedIn URL" }, { status: 400 });
  }

  try {
    await prisma.waitlistEntry.create({
      data: { firstName, lastName, email, linkedin },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return Response.json({ ok: true, alreadyOnList: true });
    }
    throw err;
  }

  // Fire-and-forget: the signup is already persisted, so a mail failure must
  // never fail the request. sendWaitlistConfirmation no-ops without
  // RESEND_API_KEY and swallows its own errors — see lib/email/waitlist.ts.
  void sendWaitlistConfirmation(email, firstName);

  return Response.json({ ok: true });
}

export async function GET() {
  const session = await requireSession();
  if (session instanceof Response) return session;
  if (!isSuperAdmin(session.email)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const entries = await prisma.waitlistEntry.findMany({
    orderBy: { createdAt: "asc" },
  });
  return Response.json({ count: entries.length, entries });
}
