import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * GET /api/auth/profile?personId=...
 * Fetch user's profile (Person record) by ID
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const personId = searchParams.get("personId");

    if (!personId) {
      return NextResponse.json(
        { error: "personId is required" },
        { status: 400 }
      );
    }

    const person = await prisma.person.findUnique({
      where: { id: personId },
      select: {
        id: true,
        name: true,
        subtitle: true,
        bio: true,
        location: true,
        imageUrl: true,
        website: true,
        linkedinUrl: true,
        twitterUrl: true,
        pronouns: true,
      },
    });

    if (!person) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(person);
  } catch (error) {
    logger.error('api.auth.profile.get.failed', { err: error });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/auth/profile
 * Update authenticated user's profile
 */
export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { personId, name, bio, subtitle, location, website } = body;

    if (!personId) {
      return NextResponse.json(
        { error: "personId is required" },
        { status: 400 }
      );
    }

    // Verify the person belongs to the current user
    const person = await prisma.person.findUnique({
      where: { id: personId },
    });

    if (!person || person.userId !== session.userId) {
      return NextResponse.json(
        { error: "Unauthorized to update this profile" },
        { status: 403 }
      );
    }

    // Update the profile
    const updated = await prisma.person.update({
      where: { id: personId },
      data: {
        ...(name && { name }),
        ...(bio !== undefined && { bio }),
        ...(subtitle !== undefined && { subtitle }),
        ...(location !== undefined && { location }),
        ...(website !== undefined && { website }),
      },
      select: {
        id: true,
        name: true,
        subtitle: true,
        bio: true,
        location: true,
        imageUrl: true,
        website: true,
        linkedinUrl: true,
        twitterUrl: true,
        pronouns: true,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    logger.error('api.auth.profile.put.failed', { err: error });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
