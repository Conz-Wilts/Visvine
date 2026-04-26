/**
 * Event data persistence layer
 * All entities (people, orgs, events) are now stored in the nodes table.
 */

import prisma from './prisma';
import { Prisma } from '@prisma/client';
import { revalidateTag } from 'next/cache';
import type { EventsData, NBEvent, NBAttendee, GraphData, NBNode, NBLink, RSVPStatus } from './types';
import { normalizeImageUrl } from './mediaUrl';
import { logger } from './logger';

// ─── Type helpers ────────────────────────────────────────────────────────────

export function entityTypeFromNodeType(_nodeType: string): string {
  return 'nodes';
}

// ─── Node converter ──────────────────────────────────────────────────────────

function nodeRowToNBNode(row: {
  id: string; type: string; name: string; alias: string | null; subtitle: string | null;
  location: string | null; url: string | null; imageUrl: string | null;
  tags: string[]; metadata: unknown; communityId: string | null;
}): NBNode {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    alias: row.alias ?? undefined,
    subtitle: row.subtitle ?? undefined,
    location: row.location ?? undefined,
    url: row.url ?? undefined,
    image_url: normalizeImageUrl(row.imageUrl) ?? undefined,
    tags: row.tags,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    community_id: row.communityId ?? undefined,
  };
}

function nodeRowToNBEvent(row: {
  id: string; communityId: string | null; name: string; subtitle: string | null;
  metadata: unknown; createdAt: Date; updatedAt: Date;
}): NBEvent {
  const meta = (row.metadata as Record<string, unknown>) ?? {};
  const locationData = meta.locationData as NBEvent['location'] | undefined;
  return {
    id: row.id as `event:${string}`,
    communityId: row.communityId ?? '',
    title: row.name,
    description: (meta.description as string) ?? row.subtitle ?? undefined,
    startAt: (meta.start_at as string) ?? '',
    endAt: (meta.end_at as string) ?? undefined,
    timezone: (meta.timezone as string) ?? undefined,
    location: locationData ?? undefined,
    hosts: (meta.hosts as string[]) ?? [],
    organizerEmail: (meta.organizerEmail as string) ?? undefined,
    capacity: (meta.capacity as number) ?? undefined,
    visibility: ((meta.visibility as string) ?? 'community') as NBEvent['visibility'],
    form: (meta.form_schema as NBEvent['form']) ?? (meta.form as NBEvent['form']) ?? { enabled: false, slug: '', schema: [] },
    analytics: (meta.analytics as NBEvent['analytics']) ?? {
      views: 0, rsvpCount: 0, checkinCount: 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    metadata: meta,
  };
}

// ─── Graph data ───────────────────────────────────────────────────────────────

export async function getCommunityGraphData(communityId: string): Promise<GraphData> {
  try {
    const [nodeRows, linkRows] = await Promise.all([
      prisma.node.findMany({
        where: { communityId },
        select: { id: true, type: true, name: true, alias: true, subtitle: true, location: true, url: true, imageUrl: true, tags: true, metadata: true, communityId: true },
      }),
      prisma.link.findMany({
        where: { communityId },
        select: { sourceId: true, targetId: true, relationship: true, since: true, metadata: true, communityId: true },
      }),
    ]);

    // Person.imageUrl is authoritative for profile photos (stays in sync with GCS uploads).
    // Node.imageUrl can be stale if old local-path images were never migrated to GCS.
    // Fetch person-type nodes to overlay profile data (image, bio, links, experience, etc.)
    const personNodeIds = nodeRows.filter(n => n.id.startsWith('person:')).map(n => n.id);
    const personDataMap = new Map<string, {
      imageUrl: string | null;
      bio: string | null;
      website: string | null;
      linkedinUrl: string | null;
      twitterUrl: string | null;
      phone: string | null;
      pronouns: string | null;
      openToWork: boolean;
      experience: string | null;
      education: string | null;
      certifications: string | null;
      languages: string | null;
    }>();
    if (personNodeIds.length > 0) {
      const personRows = await prisma.person.findMany({
        where: { id: { in: personNodeIds } },
        select: {
          id: true, imageUrl: true, bio: true, website: true,
          linkedinUrl: true, twitterUrl: true, phone: true,
          pronouns: true, openToWork: true,
          workExperience: { select: { title: true, company: true }, orderBy: { sortOrder: 'asc' } },
          education: { select: { school: true, degree: true, fieldOfStudy: true }, orderBy: { sortOrder: 'asc' } },
          certifications: { select: { name: true, issuingOrg: true }, orderBy: { sortOrder: 'asc' } },
          languages: { select: { language: true, proficiency: true }, orderBy: { sortOrder: 'asc' } },
        },
      });
      for (const p of personRows) {
        personDataMap.set(p.id, {
          imageUrl: p.imageUrl,
          bio: p.bio,
          website: p.website,
          linkedinUrl: p.linkedinUrl,
          twitterUrl: p.twitterUrl,
          phone: p.phone,
          pronouns: p.pronouns,
          openToWork: p.openToWork,
          experience: p.workExperience.length > 0
            ? p.workExperience.map(w => `${w.title} at ${w.company}`).join(', ')
            : null,
          education: p.education.length > 0
            ? p.education.map(e => [e.degree, e.fieldOfStudy, e.school].filter(Boolean).join(', ')).join('; ')
            : null,
          certifications: p.certifications.length > 0
            ? p.certifications.map(c => `${c.name} (${c.issuingOrg})`).join(', ')
            : null,
          languages: p.languages.length > 0
            ? p.languages.map(l => l.language).join(', ')
            : null,
        });
      }
    }

    const nodes: NBNode[] = nodeRows.map(row => {
      const base = nodeRowToNBNode(row);
      const personData = personDataMap.get(row.id);
      if (personData) {
        base.image_url = normalizeImageUrl(personData.imageUrl) ?? undefined;
        base.metadata = {
          ...base.metadata,
          bio: personData.bio,
          website: personData.website,
          linkedinUrl: personData.linkedinUrl,
          twitterUrl: personData.twitterUrl,
          phone: personData.phone,
          pronouns: personData.pronouns,
          openToWork: personData.openToWork,
          experience: personData.experience,
          education: personData.education,
          certifications: personData.certifications,
          languages: personData.languages,
        };
      }
      return base;
    });

    const links: NBLink[] = linkRows.map(l => ({
      source: l.sourceId,
      target: l.targetId,
      relationship: l.relationship,
      since: l.since ?? undefined,
      metadata: (l.metadata as Record<string, unknown>) ?? {},
      community_id: l.communityId ?? undefined,
    }));

    return { nodes, links };
  } catch (err) {
    logger.error('eventRepo.getCommunityGraphData.failed', { err });
    return { nodes: [], links: [] };
  }
}

// ─── Events ──────────────────────────────────────────────────────────────────

export async function getEventsData(communityId: string): Promise<EventsData> {
  try {
    const eventRows = await prisma.node.findMany({
      where: { communityId, type: 'event' },
    });
    const eventIds = eventRows.map(e => e.id);
    const attendeeRows = eventIds.length > 0
      ? await prisma.attendee.findMany({ where: { eventId: { in: eventIds } } })
      : [];

    const events = eventRows.map(nodeRowToNBEvent);
    const attendees: NBAttendee[] = attendeeRows.map(a => ({
      id: a.id as `attendee:${string}`,
      eventId: a.eventId as `event:${string}`,
      personId: (a.personId ?? '') as `person:${string}`,
      email: a.email ?? undefined,
      linkedinUrl: a.linkedinUrl ?? undefined,
      companyName: a.companyName ?? undefined,
      roleTitle: a.roleTitle ?? undefined,
      answers: (a.answers as Record<string, string | boolean>) || {},
      status: a.status as RSVPStatus,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      checkinAt: a.checkinAt?.toISOString(),
    }));

    return { events, attendees };
  } catch (err) {
    logger.error('eventRepo.getEventsData.failed', { err });
    return { events: [], attendees: [] };
  }
}

export async function getEvent(communityId: string, eventId: string): Promise<NBEvent | null> {
  try {
    const row = await prisma.node.findFirst({ where: { id: eventId, communityId, type: 'event' } });
    return row ? nodeRowToNBEvent(row) : null;
  } catch (err) {
    logger.error('eventRepo.getEvent.failed', { err });
    return null;
  }
}

export async function upsertEvent(communityId: string, event: NBEvent): Promise<void> {
  const meta = {
    ...(event.metadata ?? {}),
    description: event.description,
    start_at: event.startAt,
    end_at: event.endAt,
    timezone: event.timezone,
    locationData: event.location,
    capacity: event.capacity,
    visibility: event.visibility,
    form_schema: event.form,
    hosts: event.hosts,
    organizerEmail: event.organizerEmail,
    analytics: event.analytics,
  };

  await prisma.node.upsert({
    where: { id: event.id },
    create: {
      id: event.id,
      type: 'event',
      name: event.title,
      subtitle: event.description ?? null,
      location: event.location?.label ?? null,
      communityId,
      tags: [],
      metadata: meta as object,
    },
    update: {
      name: event.title,
      subtitle: event.description ?? null,
      location: event.location?.label ?? null,
      metadata: meta as object,
    },
  });
}

export async function deleteEvent(communityId: string, eventId: string): Promise<void> {
  await prisma.node.delete({ where: { id: eventId } });
}

export async function updateEventAnalytics(communityId: string, eventId: string, updates: Partial<NBEvent['analytics']>): Promise<void> {
  const event = await getEvent(communityId, eventId);
  if (event) {
    event.analytics = { ...event.analytics, ...updates, updatedAt: new Date().toISOString() };
    await upsertEvent(communityId, event);
  }
}

// ─── Attendees ────────────────────────────────────────────────────────────────

export async function getAttendees(communityId: string, eventId: string): Promise<NBAttendee[]> {
  try {
    const rows = await prisma.attendee.findMany({ where: { eventId } });
    return rows.map(a => ({
      id: a.id as `attendee:${string}`,
      eventId: a.eventId as `event:${string}`,
      personId: (a.personId ?? '') as `person:${string}`,
      email: a.email ?? undefined,
      linkedinUrl: a.linkedinUrl ?? undefined,
      companyName: a.companyName ?? undefined,
      roleTitle: a.roleTitle ?? undefined,
      answers: (a.answers as Record<string, string | boolean>) || {},
      status: a.status as RSVPStatus,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      checkinAt: a.checkinAt?.toISOString(),
    }));
  } catch (err) {
    logger.error('eventRepo.getAttendees.failed', { err });
    return [];
  }
}

export async function upsertAttendee(communityId: string, attendee: NBAttendee): Promise<void> {
  await prisma.attendee.upsert({
    where: { id: attendee.id },
    create: {
      id: attendee.id,
      eventId: attendee.eventId,
      personId: attendee.personId || null,
      email: attendee.email ?? null,
      linkedinUrl: attendee.linkedinUrl ?? null,
      companyName: attendee.companyName ?? null,
      roleTitle: attendee.roleTitle ?? null,
      answers: (attendee.answers as object) || {},
      status: attendee.status,
      checkinAt: attendee.checkinAt ? new Date(attendee.checkinAt) : null,
    },
    update: {
      personId: attendee.personId || null,
      email: attendee.email ?? null,
      linkedinUrl: attendee.linkedinUrl ?? null,
      companyName: attendee.companyName ?? null,
      roleTitle: attendee.roleTitle ?? null,
      answers: (attendee.answers as object) || {},
      status: attendee.status,
      checkinAt: attendee.checkinAt ? new Date(attendee.checkinAt) : null,
    },
  });
}

// ─── updateCommunityGraphData ─────────────────────────────────────────────────

export async function updateCommunityGraphData(communityId: string, graphData: GraphData): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      // Batch upsert nodes in chunks of 50
      const CHUNK_SIZE = 50;
      for (let i = 0; i < graphData.nodes.length; i += CHUNK_SIZE) {
        const batch = graphData.nodes.slice(i, i + CHUNK_SIZE);
        const values = batch.map((n) => Prisma.sql`(
          ${n.id}, ${n.type}, ${n.name}, ${communityId},
          ${n.subtitle ?? null}, ${n.location ?? null}, ${n.url ?? null},
          ${n.image_url ?? null}, ${n.tags ?? []}::text[], ${JSON.stringify(n.metadata ?? {})}::jsonb
        )`);
        await tx.$executeRaw`
          INSERT INTO nodes (id, type, name, community_id, subtitle, location, url, image_url, tags, metadata)
          VALUES ${Prisma.join(values)}
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            subtitle = EXCLUDED.subtitle,
            location = EXCLUDED.location,
            url = EXCLUDED.url,
            image_url = EXCLUDED.image_url,
            tags = EXCLUDED.tags,
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
        `;
      }

      // Batch upsert links in chunks of 50
      for (let i = 0; i < graphData.links.length; i += CHUNK_SIZE) {
        const batch = graphData.links.slice(i, i + CHUNK_SIZE);
        const values = batch.map((l) => {
          const sourceId = typeof l.source === 'string' ? l.source : l.source.id;
          const targetId = typeof l.target === 'string' ? l.target : l.target.id;
          return Prisma.sql`(
            ${sourceId}, ${targetId}, ${communityId},
            ${l.relationship}, ${l.since ?? null}, ${JSON.stringify(l.metadata ?? {})}::jsonb
          )`;
        });
        await tx.$executeRaw`
          INSERT INTO links (source_id, target_id, community_id, relationship, since, metadata)
          VALUES ${Prisma.join(values)}
          ON CONFLICT (source_id, target_id, community_id) DO UPDATE SET
            relationship = EXCLUDED.relationship,
            since = EXCLUDED.since,
            metadata = EXCLUDED.metadata
        `;
      }
    });
    revalidateTag('graph-data-v2');
  } catch (err) {
    logger.error('eventRepo.updateCommunityGraphData.failed', { err });
    throw err;
  }
}

