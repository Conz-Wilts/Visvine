/**
 * A member's profile sections, read and written as a whole.
 *
 * The rows are `profile_sections` + `profile_section_entries`; what a kind
 * holds is `shared/sections.ts`. Every write answers with the whole list, so a
 * client never computes what the server already knows, and the order a section
 * is drawn in is the `position` column, never an accident of insertion.
 */

import prisma from '@/lib/prisma';
import { normalizeImageUrl } from '@/lib/mediaUrl';
import { applyOrder, sortEntries, type SectionKind } from './shared/sections';

export interface ProfileSectionEntryView {
  id: string;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  url: string | null;
  startYear: string | null;
  endYear: string | null;
  imageUrl: string | null;
  position: number;
  /** The space this row points at, drawn in place of a picture. */
  space: { id: string; name: string; imageUrl: string | null } | null;
}

export interface ProfileSectionView {
  id: string;
  title: string;
  kind: SectionKind | string;
  body: string | null;
  position: number;
  entries: ProfileSectionEntryView[];
}

const ENTRY_SELECT = {
  id: true, title: true, subtitle: true, description: true, url: true,
  startYear: true, endYear: true, imageUrl: true, position: true,
  space: { select: { id: true, name: true, imageUrl: true } },
} as const;

/** Every section a member holds, in order, each with its rows in theirs. */
export async function listSections(userId: string): Promise<ProfileSectionView[]> {
  const rows = await prisma.profileSection.findMany({
    where: { userId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true, title: true, kind: true, body: true, position: true,
      entries: { select: ENTRY_SELECT },
    },
  });
  return rows.map((section) => ({
    ...section,
    entries: sortEntries(section.kind, section.entries).map((entry) => ({
      ...entry,
      imageUrl: normalizeImageUrl(entry.imageUrl) ?? entry.imageUrl,
      space: entry.space
        ? { ...entry.space, imageUrl: normalizeImageUrl(entry.space.imageUrl) ?? entry.space.imageUrl }
        : null,
    })),
  }));
}

/** The place a new section or row lands: the end. */
export async function nextSectionPosition(userId: string): Promise<number> {
  const last = await prisma.profileSection.findFirst({
    where: { userId }, orderBy: { position: 'desc' }, select: { position: true },
  });
  return (last?.position ?? -1) + 1;
}

export async function nextEntryPosition(sectionId: string): Promise<number> {
  const last = await prisma.profileSectionEntry.findFirst({
    where: { sectionId }, orderBy: { position: 'desc' }, select: { position: true },
  });
  return (last?.position ?? -1) + 1;
}

/**
 * A profile points only at spaces its owner is actually in — the link draws
 * that space's name and logo, so it may not name one they never joined.
 * Returns the id to store: the space, or null.
 */
export async function ownedSpaceId(userId: string, spaceId: string | null | undefined): Promise<string | null> {
  if (!spaceId) return null;
  const membership = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId, spaceId } },
    select: { status: true },
  });
  return membership?.status === 'active' ? spaceId : null;
}

/** Write the arrangement the member made, one row per position. */
export async function reorderSections(userId: string, order: readonly string[]): Promise<void> {
  const existing = await prisma.profileSection.findMany({
    where: { userId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true },
  });
  const ids = applyOrder(order, existing.map((row) => row.id));
  await prisma.$transaction(ids.map((id, position) =>
    prisma.profileSection.update({ where: { id }, data: { position } }),
  ));
}

export async function reorderEntries(sectionId: string, order: readonly string[]): Promise<void> {
  const existing = await prisma.profileSectionEntry.findMany({
    where: { sectionId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true },
  });
  const ids = applyOrder(order, existing.map((row) => row.id));
  await prisma.$transaction(ids.map((id, position) =>
    prisma.profileSectionEntry.update({ where: { id }, data: { position } }),
  ));
}
