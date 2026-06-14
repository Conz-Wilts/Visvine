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
  subtitle: z.string().max(200).nullable().optional(),
  bio: z.string().max(2000).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  website: urlField,
  linkedinUrl: urlField,
  twitterUrl: urlField,
  phone: z.string().max(30).nullable().optional(),
  pronouns: z.string().max(30).nullable().optional(),
  openToWork: z.boolean().optional(),
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
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const person = await prisma.person.findUnique({
    where: { userId: session.userId },
    select: { id: true },
  });
  if (!person) return NextResponse.json({ error: 'Person not found' }, { status: 404 });

  const parsed = OnboardingPatchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const {
    subtitle, bio, location, website, linkedinUrl, twitterUrl,
    phone, pronouns, openToWork, tags, imageUrl,
  } = parsed.data;

  const updated = await prisma.person.update({
    where: { id: person.id },
    data: {
      ...(subtitle !== undefined && { subtitle }),
      ...(bio !== undefined && { bio }),
      ...(location !== undefined && { location }),
      ...(website !== undefined && { website }),
      ...(linkedinUrl !== undefined && { linkedinUrl }),
      ...(twitterUrl !== undefined && { twitterUrl }),
      ...(phone !== undefined && { phone }),
      ...(pronouns !== undefined && { pronouns }),
      ...(openToWork !== undefined && { openToWork }),
      ...(tags !== undefined && { tags }),
      ...(imageUrl !== undefined && { imageUrl }),
    },
  });

  logger.info('api.onboarding.person.updated', { id: person.id, imageUrl });

  const nodeUpdate: Record<string, unknown> = {};
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
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await prisma.person.update({
    where: { userId: session.userId },
    data: { hasOnboarded: true },
  });

  return NextResponse.json({ ok: true });
}
