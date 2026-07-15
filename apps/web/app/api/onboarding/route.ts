/**
 * Onboarding API
 * GET   /api/onboarding  → fetch current user's person data for pre-filling
 * PATCH /api/onboarding  → save partial profile data per step
 * POST  /api/onboarding  → mark onboarding complete (hasOnboarded = true)
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getSession } from '@/lib/session';
import { parseBody, requireApiSession } from '@/lib/api/route';
import { provisionPersonalCommunity } from '@/lib/onboarding/personalCommunity';
import { z } from 'zod';

// Bare domains ("visvine.com", "linkedin.com/in/me") are the common way people
// type a link — prepend https:// so they validate instead of being dropped.
const urlField = z
  .preprocess((v) => {
    if (typeof v !== 'string') return v; // null / undefined pass through
    const t = v.trim();
    if (t === '') return '';
    return /^https?:\/\//i.test(t) ? t : `https://${t}`;
  }, z.string().url().or(z.literal('')).nullable())
  .optional();

// Empty inputs from the wizard arrive as `null` (the client sends `value || null`),
// so every nullable string field must accept `null` as well as `undefined`.
const OnboardingPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  subtitle: z.string().max(200).nullable().optional(),
  bio: z.string().max(2000).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  website: urlField,
  linkedinUrl: urlField,
  twitterUrl: urlField,
  phone: z.string().max(30).nullable().optional(),
  pronouns: z.string().max(30).nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  imageUrl: z.string().nullable().optional(),
});

async function getPersonForSession() {
  const session = await getSession();
  if (!session) return null;

  return prisma.person.findUnique({
    where: { userId: session.userId },
  });
}

export async function GET() {
  const person = await getPersonForSession();
  if (!person) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(person);
}

export async function PATCH(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const person = await prisma.person.findUnique({
    where: { userId: session.userId },
    select: { id: true },
  });
  if (!person) return NextResponse.json({ error: 'Person not found' }, { status: 404 });

  const body = await parseBody(req, OnboardingPatchSchema);
  if (body instanceof NextResponse) return body;

  const {
    name, subtitle, bio, location, website, linkedinUrl, twitterUrl,
    phone, pronouns, tags, imageUrl,
  } = body;

  const updated = await prisma.person.update({
    where: { id: person.id },
    data: {
      ...(name !== undefined && { name }),
      ...(subtitle !== undefined && { subtitle }),
      ...(bio !== undefined && { bio }),
      ...(location !== undefined && { location }),
      ...(website !== undefined && { website }),
      ...(linkedinUrl !== undefined && { linkedinUrl }),
      ...(twitterUrl !== undefined && { twitterUrl }),
      ...(phone !== undefined && { phone }),
      ...(pronouns !== undefined && { pronouns }),
      ...(tags !== undefined && { tags }),
      ...(imageUrl !== undefined && { imageUrl }),
    },
  });

  logger.info('api.onboarding.person.updated', { id: person.id, imageUrl });

  const nodeUpdate: Record<string, unknown> = {};
  if (name !== undefined) nodeUpdate.name = name;
  if (subtitle !== undefined) nodeUpdate.subtitle = subtitle;
  if (location !== undefined) nodeUpdate.location = location;
  if (imageUrl !== undefined) nodeUpdate.imageUrl = imageUrl;
  if (tags !== undefined) nodeUpdate.tags = tags;

  if (Object.keys(nodeUpdate).length > 0) {
    await prisma.node.upsert({
      where: { id: person.id },
      update: nodeUpdate,
      create: {
        id: person.id,
        type: 'person',
        name: updated.name,
        subtitle: updated.subtitle,
        location: updated.location,
        url: updated.website,
        tags: updated.tags,
        imageUrl: updated.imageUrl,
        metadata: updated.metadata ?? undefined,
        communityId: null,
      },
    });
    logger.info('api.onboarding.node.upserted', { id: person.id, imageUrl: nodeUpdate.imageUrl });
    revalidateTag('graph-data-v2');
  }

  return NextResponse.json(updated);
}

export async function POST() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  await prisma.person.update({
    where: { userId: session.userId },
    data: { hasOnboarded: true },
  });

  // Give the new user their private "personal space" — a community named after
  // them that hosts their personal context notes. Idempotent, so a re-POST (e.g.
  // skip then finish) is harmless. Returns the id so the client can make it the
  // active community before redirecting into the app.
  const { communityId } = await provisionPersonalCommunity({
    userId: session.userId,
    name: session.name,
    email: session.email,
  });

  // The user's person node was just placed in their space — bust the graph cache
  // so their directory isn't empty on first load.
  revalidateTag('graph-data-v2');

  return NextResponse.json({ ok: true, communityId });
}
