import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/session";
import { generateClaimToken } from "@/lib/crm/claimService";
import { safeRelativePath } from "@/lib/redirects";
import {
  ensurePerson,
  setSessionCookie,
  type SessionableUser,
} from "@/lib/auth/bootstrap";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

async function buildSessionResponse(
  user: SessionableUser,
  callbackUrl: string,
  appUrl: string
) {
  const person = await ensurePerson(user);

  const token = await createSession({
    userId: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    personId: person.id,
  });

  const response = NextResponse.redirect(new URL(callbackUrl, appUrl));
  return setSessionCookie(response, token);
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  // `state` is reflected back from the OAuth request, so guard it as a
  // relative path before using it as a redirect target (avoids open redirect).
  const callbackUrl = state ? safeRelativePath(decodeURIComponent(state)) : "/home";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const redirectUri = `${appUrl}/api/auth/callback/google`;

  if (!code) {
    return NextResponse.redirect(new URL("/signin?error=no_code", req.url));
  }

  // Step 1: Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(
      new URL("/signin?error=token_exchange", req.url)
    );
  }

  const tokens = await tokenRes.json();
  if (!tokens.access_token) {
    return NextResponse.redirect(
      new URL("/signin?error=token_exchange", req.url)
    );
  }

  // Step 2: Get Google profile
  const userRes = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    { headers: { Authorization: `Bearer ${tokens.access_token}` } }
  );

  if (!userRes.ok) {
    return NextResponse.redirect(new URL("/signin?error=userinfo", req.url));
  }

  const googleUser = await userRes.json();
  if (!googleUser.email) {
    return NextResponse.redirect(new URL("/signin?error=no_email", req.url));
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
      return await buildSessionResponse(user, callbackUrl, appUrl);
    }
    // googleId is linked to a shadow — unusual state; fall through to claim flow
  }

  // Step 4: Look up by email
  const userByEmail = await prisma.user.findUnique({
    where: { email: googleUser.email },
  });

  if (!userByEmail) {
    // Step 5: Brand new user — create active account
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
      // Race condition: another request created the same email between our lookup and create
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        newUser = (await prisma.user.findUniqueOrThrow({
          where: { email: googleUser.email },
        })) as SessionableUser;
      } else {
        throw e;
      }
    }
    return await buildSessionResponse(newUser, callbackUrl, appUrl);
  }

  // Step 6: Email matched a shadow profile — initiate claim flow
  if (!userByEmail.isActive) {
    const claimToken = await generateClaimToken(
      userByEmail.id,
      userByEmail.email,
      googleId,
      googleName,
      googlePicture
    );
    const claimUrl = new URL("/claim", appUrl);
    claimUrl.searchParams.set("token", claimToken);
    claimUrl.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(claimUrl);
  }

  // Step 7: Active user found by email — link Google to it. Google has just
  // proven the person signing in controls this inbox, so the email is verified
  // from here on.
  if (!userByEmail.googleId) {
    await prisma.user.update({
      where: { id: userByEmail.id },
      data: {
        googleId,
        oauthProvider: "google",
        name: googleName,
        image: googlePicture || userByEmail.image,
        emailVerified: true,
      },
    });
  }

  return await buildSessionResponse(userByEmail, callbackUrl, appUrl);
}
