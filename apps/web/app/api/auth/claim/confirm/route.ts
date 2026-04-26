import { NextRequest, NextResponse } from "next/server";
import { createSession, COOKIE_NAME, MAX_AGE } from "@/lib/session";
import { consumeClaimToken } from "@/lib/crm/claimService";
import { z } from "zod";

const BodySchema = z.object({
  token: z.string().min(1),
  callbackUrl: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;

  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const claimed = await consumeClaimToken(body.token);

  if (!claimed) {
    // Token expired, already consumed, or nonce mismatch
    // Check whether it's an already-claimed case vs truly invalid
    return NextResponse.json(
      { error: "claim_token_invalid" },
      { status: 401 }
    );
  }

  const destination = "/onboarding";

  const sessionToken = await createSession({
    userId: claimed.userId,
    name: claimed.name,
    email: claimed.email,
    image: claimed.image,
  });

  const response = NextResponse.json(
    { ok: true, redirectUrl: destination },
    { status: 200 }
  );

  response.cookies.set(COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });

  return response;
}
