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

const OnboardingPatchSchema = z.object({
  subtitle: z.string().max(200).optional(),
  bio: z.string().max(2000).optional(),
  location: z.string().max(200).optional(),
  website: z.string().url().or(z.literal('')).optional(),
  linkedinUrl: z.string().url().or(z.literal('')).optional(),
  twitterUrl: z.string().url().or(z.literal('')).optional(),
  phone: z.string().max(30).optional(),
  pronouns: z.string().max(30).optional(),
  openToWork: z.boolean().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  imageUrl: z.string().optional(),
  newExperience: z.array(z.object({
    title: z.string().min(1),
    company: z.string().min(1),
    location: z.string().optional(),
    startDate: z.string().min(1),
    endDate: z.string().optional(),
    current: z.boolean().optional(),
    description: z.string().optional(),
  })).optional(),
  newEducation: z.array(z.object({
    school: z.string().min(1),
    degree: z.string().optional(),
    fieldOfStudy: z.string().optional(),
    startYear: z.string().optional(),
    endYear: z.string().optional(),
    description: z.string().optional(),
  })).optional(),
});

async function getPersonForSession() {
  const session = await getSession();
  if (!session) return null;

  const person = await prisma.person.findUnique({
    where: { userId: session.userId },
    include: {
      workExperience: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] },
      education: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] },
    },
  });

  return person;
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
    newExperience, newEducation,
  } = parsed.data;

  // Update person fields
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

  // Sync shared fields to Node record (create if doesn't exist)
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

  // Create new experience entries
  if (newExperience && Array.isArray(newExperience)) {
    for (const exp of newExperience) {
      if (exp.title && exp.company && exp.startDate) {
        await prisma.workExperience.create({
          data: {
            personId: person.id,
            title: exp.title,
            company: exp.company,
            location: exp.location,
            startDate: exp.startDate,
            endDate: exp.endDate,
            current: !!exp.current,
            description: exp.description,
          },
        });
      }
    }
  }

  // Create new education entries
  if (newEducation && Array.isArray(newEducation)) {
    for (const edu of newEducation) {
      if (edu.school) {
        await prisma.education.create({
          data: {
            personId: person.id,
            school: edu.school,
            degree: edu.degree,
            fieldOfStudy: edu.fieldOfStudy,
            startYear: edu.startYear ? parseInt(edu.startYear) : null,
            endYear: edu.endYear ? parseInt(edu.endYear) : null,
            description: edu.description,
          },
        });
      }
    }
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
