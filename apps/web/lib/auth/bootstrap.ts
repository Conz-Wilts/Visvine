import { NextResponse } from "next/server";
import { Prisma, type Person } from "@prisma/client";
import prisma from "@/lib/prisma";
import { COOKIE_NAME, MAX_AGE } from "@/lib/session";

/**
 * Shared post-authentication plumbing for every sign-in entry point
 * (Google OAuth callback, email/password signup + login). Keeps Person
 * creation and the session cookie identical across all of them.
 */

export type SessionableUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

/**
 * Returns the user's Person row, creating one if it doesn't exist yet.
 * Person IDs are `person:<emailPrefix>`; on a unique collision we either
 * adopt the row a concurrent request just created for this user, or fall
 * back to a numbered suffix.
 */
export async function ensurePerson(user: SessionableUser): Promise<Person> {
  const existing = await prisma.person.findUnique({ where: { userId: user.id } });
  if (existing) return existing;

  const emailPrefix = user.email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  const baseId = `person:${emailPrefix || "user"}`;
  let candidate = baseId;
  let suffix = 0;

  // Bounded retry to avoid any pathological infinite loop.
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      return await prisma.person.create({
        data: {
          id: candidate,
          userId: user.id,
          name: user.name,
          imageUrl: user.image,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        // A concurrent request may have created this user's Person (unique userId).
        const raced = await prisma.person.findUnique({ where: { userId: user.id } });
        if (raced) return raced;
        // Otherwise the `id` is taken by a different user — try a new suffix.
        suffix++;
        candidate = `${baseId}-${suffix}`;
        continue;
      }
      throw e;
    }
  }
  throw new Error("ensurePerson: exhausted unique-id attempts");
}

/** Sets the auth session cookie on a response using the shared cookie options. */
export function setSessionCookie(res: NextResponse, token: string): NextResponse {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
  return res;
}
