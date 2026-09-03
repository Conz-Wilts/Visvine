import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { COOKIE_NAME, MAX_AGE } from "@/lib/session";

/**
 * Shared post-authentication plumbing for every sign-in entry point (the
 * Google OAuth callback, the claim flow, dev login). Keeps the home-node mint
 * and the session cookie identical across all of them.
 */

export type SessionableUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

/**
 * The id of the user's own person node (User.nodeId), minted on first sign-in.
 * Ids are `person:<emailPrefix>`; on a collision with another user's node we
 * fall back to a numbered suffix. The node itself is placed in their personal
 * space by lib/spaces/personalSpace.ts.
 */
export async function ensureHomeNodeId(user: SessionableUser): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { id: user.id }, select: { nodeId: true } });
  if (existing?.nodeId) return existing.nodeId;

  const emailPrefix = user.email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  const baseId = `person:${emailPrefix || "user"}`;

  // Bounded retry to avoid any pathological infinite loop.
  for (let suffix = 0; suffix < 50; suffix++) {
    const candidate = suffix === 0 ? baseId : `${baseId}-${suffix}`;
    try {
      await prisma.user.update({ where: { id: user.id }, data: { nodeId: candidate } });
      return candidate;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        // Taken by another user — try the next suffix.
        continue;
      }
      throw e;
    }
  }
  throw new Error("ensureHomeNodeId: exhausted unique-id attempts");
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
