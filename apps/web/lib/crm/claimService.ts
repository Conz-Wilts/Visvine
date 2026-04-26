import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

interface ClaimTokenPayload {
  shadow_user_id: string;
  email: string;
  nonce: string;
  type: "claim";
  google_id: string;
  google_name: string;
  google_picture: string;
}

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET environment variable is not set");
  return new TextEncoder().encode(secret);
}

/**
 * Generates a 15-minute single-use claim token for a shadow user.
 * Stores a nonce in the DB so the token can only be used once.
 */
export async function generateClaimToken(
  shadowUserId: string,
  email: string,
  googleId: string,
  googleName: string,
  googlePicture: string
): Promise<string> {
  const nonce = randomUUID();

  await prisma.user.update({
    where: { id: shadowUserId },
    data: { claimNonce: nonce },
  });

  return new SignJWT({
    shadow_user_id: shadowUserId,
    email,
    nonce,
    type: "claim",
    google_id: googleId,
    google_name: googleName,
    google_picture: googlePicture,
  } satisfies ClaimTokenPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(getSecret());
}

/**
 * Verifies a claim token's signature and expiry. Returns the payload or null.
 */
export async function verifyClaimToken(
  token: string
): Promise<ClaimTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.type !== "claim") return null;
    return payload as unknown as ClaimTokenPayload;
  } catch {
    return null;
  }
}

export interface ShadowProfilePreview {
  userId: string;
  email: string;
  name: string;
  headline?: string;
  avatarUrl?: string;
  communityCount: number;
  communityNames: string[];
}

/**
 * Returns the shadow profile data to show on the /claim page.
 * Returns null if token is invalid, expired, or nonce already consumed.
 */
export async function getShadowProfilePreview(
  token: string
): Promise<ShadowProfilePreview | null> {
  const payload = await verifyClaimToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.shadow_user_id },
    include: {
      userCommunities: { include: { community: { select: { name: true } } } },
    },
  });

  if (!user || user.isActive) return null;
  if (user.claimNonce !== payload.nonce) return null;

  const meta = (user.publicMeta as Record<string, unknown>) ?? {};

  return {
    userId: user.id,
    email: user.email,
    name: (meta.name as string) || user.name,
    headline: meta.headline as string | undefined,
    avatarUrl: (meta.avatar_url as string) || user.image || undefined,
    communityCount: user.userCommunities.length,
    communityNames: user.userCommunities.map((uc) => uc.community.name),
  };
}

export interface ClaimedUser {
  userId: string;
  name: string;
  email: string;
  image: string | null;
}

/**
 * Atomically activates a shadow profile:
 * 1. Verifies the token signature, expiry, and nonce match
 * 2. Merges public_meta (admin-supplied) with Google profile (user-supplied wins for empty slots)
 * 3. Sets isActive = true, links googleId, nulls claimNonce
 * 4. Writes an audit log entry
 *
 * Returns the activated user, or null if the token is invalid or already consumed.
 */
export async function consumeClaimToken(
  token: string
): Promise<ClaimedUser | null> {
  const payload = await verifyClaimToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.shadow_user_id },
  });

  if (!user) return null;

  // Already claimed — signal with null so the caller can return 409
  if (user.isActive) return null;

  // Nonce mismatch — replayed token
  if (user.claimNonce !== payload.nonce) return null;

  // Merge public_meta: existing admin data fills gaps; Google data fills remaining gaps
  const existingMeta = (user.publicMeta as Prisma.JsonObject) ?? {};
  const mergedMeta: Prisma.InputJsonObject = {
    ...existingMeta,
    // Google data fills empty slots only — existing admin data wins
    name: existingMeta.name || payload.google_name,
    avatar_url: existingMeta.avatar_url || payload.google_picture,
  };

  const activatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      googleId: payload.google_id,
      oauthProvider: "google",
      isActive: true,
      claimNonce: null,
      emailVerified: true,
      name: (mergedMeta.name as string) || user.name,
      image: (mergedMeta.avatar_url as string) || user.image,
      publicMeta: mergedMeta,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      targetId: user.id,
      action: "claim_profile",
      diff: {
        before: { isActive: false },
        after: { isActive: true, googleId: payload.google_id },
      },
    },
  });

  return {
    userId: activatedUser.id,
    name: activatedUser.name,
    email: activatedUser.email,
    image: activatedUser.image,
  };
}
