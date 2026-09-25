import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { googleDisplayName } from "@/lib/auth/googleName";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { createHandoff } from "@/lib/auth/handoff";
import {
  mobileErrorUrl,
  mobileHandoffUrl,
  parseMobileState,
  type MobileSignInState,
} from "@/lib/auth/mobileState";

/**
 * Google's return for a phone app's sign-in. The app started it with a PKCE
 * challenge in `state`; this answers over the app's own scheme with a handoff
 * the app redeems, together with its verifier, at `/api/auth/mobile/token`
 * (lib/auth/handoff.ts). No session ever travels over the link, and the link
 * always goes to `visvine://auth/callback` — `state` is the caller's to write,
 * so it names nothing about where a credential goes.
 */

function fail(state: MobileSignInState, error: string, message?: string) {
  return NextResponse.redirect(mobileErrorUrl(error, state, message));
}

async function signedIn(userId: string, state: MobileSignInState & { challenge: string }) {
  const handoff = await createHandoff({ userId, challenge: state.challenge }, "mobile");
  return NextResponse.redirect(mobileHandoffUrl(handoff, state));
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = parseMobileState(searchParams.get("state"));
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  // Must exactly match the redirect registered in Google Cloud Console and the
  // one the app sent in its authorize request.
  const tokenExchangeRedirectUri = `${appUrl}/api/auth/callback/google-mobile`;

  if (state.foreignRedirect) {
    logger.warn("api.auth.callback.mobile.foreign_redirect");
    return fail(state, "invalid_request");
  }
  const challenge = state.challenge;
  if (!challenge) {
    return fail(state, "update_required", "Update Visvine to sign in");
  }
  const withChallenge = { ...state, challenge };

  if (!code) return fail(state, "no_code");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: tokenExchangeRedirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return fail(state, "token_exchange");

  const tokens = await tokenRes.json();
  if (!tokens.access_token) return fail(state, "token_exchange");

  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) return fail(state, "userinfo");

  const googleUser = await userRes.json();
  if (!googleUser.email) return fail(state, "no_email");

  const googleId: string = googleUser.id;
  const googleName = googleDisplayName(googleUser);
  const googlePicture: string = googleUser.picture ?? "";

  // A returning user, found by their Google id.
  const known = await prisma.user.findUnique({ where: { googleId } });
  if (known?.isActive) {
    await prisma.user.update({
      where: { id: known.id },
      data: { name: googleName, image: googlePicture || known.image },
    });
    return signedIn(known.id, withChallenge);
  }

  const userByEmail = await prisma.user.findUnique({
    where: { email: googleUser.email },
  });

  if (!userByEmail) {
    let newUserId: string;
    try {
      const created = await prisma.user.create({
        data: {
          email: googleUser.email,
          name: googleName,
          image: googlePicture,
          googleId,
          isActive: true,
        },
        select: { id: true },
      });
      newUserId = created.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const existing = await prisma.user.findUniqueOrThrow({
          where: { email: googleUser.email },
          select: { id: true },
        });
        newUserId = existing.id;
      } else {
        throw e;
      }
    }
    return signedIn(newUserId, withChallenge);
  }

  // A shadow profile is claimed on the web, where the email is verified.
  if (!userByEmail.isActive) {
    return fail(state, "account_claim_required", "Please sign in on web first to claim your account");
  }

  if (!userByEmail.googleId) {
    await prisma.user.update({
      where: { id: userByEmail.id },
      data: {
        googleId,
        name: userByEmail.name || googleName,
        image: userByEmail.image || googlePicture,
      },
    });
  }

  return signedIn(userByEmail.id, withChallenge);
}
