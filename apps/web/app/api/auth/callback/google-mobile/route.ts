import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/session";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";

type SessionableUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

async function buildSessionData(user: SessionableUser) {
  // Fetch associated Person record if it exists
  let person = await prisma.person.findUnique({
    where: { userId: user.id },
  });

  // If no Person record exists, create one automatically
  if (!person) {
    const emailPrefix = user.email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
    const personId = `person:${emailPrefix}`;

    try {
      person = await prisma.person.create({
        data: {
          id: personId,
          userId: user.id,
          name: user.name,
          imageUrl: user.image,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        let suffix = 1;
        let uniqueId = `person:${emailPrefix}-${suffix}`;
        while (true) {
          try {
            person = await prisma.person.create({
              data: {
                id: uniqueId,
                userId: user.id,
                name: user.name,
                imageUrl: user.image,
              },
            });
            break;
          } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
              suffix++;
              uniqueId = `person:${emailPrefix}-${suffix}`;
            } else {
              throw err;
            }
          }
        }
      } else {
        throw e;
      }
    }
  }

  const token = await createSession({
    userId: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    personId: person.id,
  });

  return { token, person };
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  // This URI must exactly match what was registered in Google Cloud Console
  // and what the mobile client sent in the initial auth request
  const tokenExchangeRedirectUri = `${appUrl}/api/auth/callback/google-mobile`;

  // Parse state to get mobile deep-link redirect info
  let mobileRedirectUri: string | undefined;
  let callbackUrl = "/directory";

  if (stateParam) {
    try {
      const state = JSON.parse(decodeURIComponent(stateParam));
      mobileRedirectUri = state.redirectUri;
      callbackUrl = state.callbackUrl || "/directory";
    } catch (e) {
      logger.error('api.auth.callback.mobile.parse_state.failed', { err: e });
    }
  }

  if (!code) {
    // For mobile, redirect back with error in URL
    const errorUrl = new URL('visvine://auth/error');
    errorUrl.searchParams.set('error', 'no_code');
    return NextResponse.redirect(errorUrl.toString());
  }

  // Step 1: Exchange code for tokens
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

  if (!tokenRes.ok) {
    const errorUrl = new URL('visvine://auth/error');
    errorUrl.searchParams.set('error', 'token_exchange');
    return NextResponse.redirect(errorUrl.toString());
  }

  const tokens = await tokenRes.json();
  if (!tokens.access_token) {
    const errorUrl = new URL('visvine://auth/error');
    errorUrl.searchParams.set('error', 'token_exchange');
    return NextResponse.redirect(errorUrl.toString());
  }

  // Step 2: Get Google profile
  const userRes = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    { headers: { Authorization: `Bearer ${tokens.access_token}` } }
  );

  if (!userRes.ok) {
    const errorUrl = new URL('visvine://auth/error');
    errorUrl.searchParams.set('error', 'userinfo');
    return NextResponse.redirect(errorUrl.toString());
  }

  const googleUser = await userRes.json();
  if (!googleUser.email) {
    const errorUrl = new URL('visvine://auth/error');
    errorUrl.searchParams.set('error', 'no_email');
    return NextResponse.redirect(errorUrl.toString());
  }

  const googleId: string = googleUser.id;
  const googleName: string = googleUser.name ?? googleUser.email;
  const googlePicture: string = googleUser.picture ?? "";

  // Step 3: Look up by Google ID first (fastest path — handles returning users)
  let user = await prisma.user.findUnique({ where: { googleId } });

  if (user) {
    if (user.isActive) {
      // Returning active user — refresh name/picture and sign in
      user = await prisma.user.update({
        where: { id: user.id },
        data: { name: googleName, image: googlePicture || user.image },
      });
      const { token, person } = await buildSessionData(user);

      // Redirect back to mobile app with token
      const successUrl = new URL(mobileRedirectUri || 'visvine://auth/callback');
      successUrl.searchParams.set('token', token);
      successUrl.searchParams.set('hasOnboarded', person.hasOnboarded ? 'true' : 'false');
      successUrl.searchParams.set('callbackUrl', callbackUrl);
      return NextResponse.redirect(successUrl.toString());
    }
  }

  // Step 4: Look up by email
  const userByEmail = await prisma.user.findUnique({
    where: { email: googleUser.email },
  });

  if (!userByEmail) {
    // Brand new user — create active account
    let newUser: SessionableUser;
    try {
      newUser = await prisma.user.create({
        data: {
          email: googleUser.email,
          name: googleName,
          image: googlePicture,
          googleId,
          oauthProvider: "google",
          emailVerified: true,
          isActive: true,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        newUser = (await prisma.user.findUniqueOrThrow({
          where: { email: googleUser.email },
        })) as SessionableUser;
      } else {
        throw e;
      }
    }
    const { token, person } = await buildSessionData(newUser);

    const successUrl = new URL(mobileRedirectUri || 'visvine://auth/callback');
    successUrl.searchParams.set('token', token);
    successUrl.searchParams.set('hasOnboarded', person.hasOnboarded ? 'true' : 'false');
    successUrl.searchParams.set('callbackUrl', callbackUrl);
    return NextResponse.redirect(successUrl.toString());
  }

  // Email matched a shadow profile — not supported for mobile OAuth
  // (claim flow requires email verification which is web-only)
  if (!userByEmail.isActive) {
    const errorUrl = new URL('visvine://auth/error');
    errorUrl.searchParams.set('error', 'account_claim_required');
    errorUrl.searchParams.set('message', 'Please sign in on web first to claim your account');
    return NextResponse.redirect(errorUrl.toString());
  }

  // Active user found by email — link Google ID if not yet linked
  if (!userByEmail.googleId) {
    await prisma.user.update({
      where: { id: userByEmail.id },
      data: {
        googleId,
        oauthProvider: "google",
        name: googleName,
        image: googlePicture || userByEmail.image,
      },
    });
  }

  const { token, person } = await buildSessionData(userByEmail);

  const successUrl = new URL(mobileRedirectUri || 'visvine://auth/callback');
  successUrl.searchParams.set('token', token);
  successUrl.searchParams.set('hasOnboarded', person.hasOnboarded ? 'true' : 'false');
  successUrl.searchParams.set('callbackUrl', callbackUrl);
  return NextResponse.redirect(successUrl.toString());
}
