/**
 * Event data persistence layer
 * All entities (people, orgs, events) are now stored in the nodes table.
 */

import prisma from './prisma';
import { Prisma } from '@prisma/client';
import { revalidateTag, unstable_cache } from 'next/cache';
import type { EventsData, NBEvent, NBAttendee, GraphData, NBNode, NBLink, RSVPStatus, RSVPResponse } from './types';
import { normalizeImageUrl } from './mediaUrl';
import { findMatchingPerson } from './personDedupe';
import { generateAttendeeId, normalizeStatus, occupiedSpots, decideRsvpStatus } from './eventUtils';
import { logger } from './logger';

/** Thrown by submitRsvp when an event is full and its waitlist is disabled. */
export class EventFullError extends Error {
  constructor(message = 'This event is full.') {
    super(message);
    this.name = 'EventFullError';
  }
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
  imageUrl?: string | null; alias?: string | null;
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
    // rebuild fields (Node.imageUrl/alias are authoritative; fall back to metadata)
    coverImageUrl: normalizeImageUrl(row.imageUrl ?? (meta.coverImageUrl as string) ?? null) ?? undefined,
    theme: (meta.theme as NBEvent['theme']) ?? undefined,
    status: (meta.status as NBEvent['status']) ?? 'published',
    slug: (row.alias ?? (meta.slug as string)) ?? undefined,
    waitlistEnabled: (meta.waitlistEnabled as boolean) ?? undefined,
    guestListVisible: (meta.guestListVisible as boolean) ?? undefined,
    allowPlusOnes: (meta.allowPlusOnes as number) ?? undefined,
    allowedResponses: (meta.allowedResponses as NBEvent['allowedResponses']) ?? undefined,
    form: (meta.form_schema as NBEvent['form']) ?? (meta.form as NBEvent['form']) ?? { enabled: false, slug: '', schema: [] },
    analytics: (meta.analytics as NBEvent['analytics']) ?? {
      views: 0, rsvpCount: 0, checkinCount: 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    metadata: meta,
  };
}

function attendeeRowToNBAttendee(a: {
  id: string; eventId: string; personId: string | null; name: string | null;
  email: string | null; linkedinUrl: string | null; companyName: string | null; roleTitle: string | null;
  answers: unknown; status: string; response: string | null; plusOnes: number;
  plusOneNames: string[]; invitedBy: string | null;
  createdAt: Date; updatedAt: Date; checkinAt: Date | null;
}): NBAttendee {
  return {
    id: a.id as `attendee:${string}`,
    eventId: a.eventId as `event:${string}`,
    personId: a.personId ?? '',
    name: a.name ?? undefined,
    email: a.email ?? undefined,
    linkedinUrl: a.linkedinUrl ?? undefined,
    companyName: a.companyName ?? undefined,
    roleTitle: a.roleTitle ?? undefined,
    answers: (a.answers as Record<string, string | boolean>) || {},
    status: a.status as RSVPStatus,
    response: (a.response as NBAttendee['response']) ?? undefined,
    plusOnes: a.plusOnes ?? 0,
    plusOneNames: a.plusOneNames ?? [],
    invitedBy: a.invitedBy ?? undefined,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    checkinAt: a.checkinAt?.toISOString(),
  };
}

// ─── Graph data ───────────────────────────────────────────────────────────────

/**
 * Fetch a community's nodes (with person-profile enrichment) — WITHOUT links.
 *
 * This is the payload the directory grid/table views actually render. Keeping it
 * separate from links means those views never pay to load (or serialize) the edge
 * set. The graph view composes this with links via {@link getCommunityGraphData}.
 */
async function fetchCommunityNodes(communityId: string): Promise<NBNode[]> {
  const allRows = await prisma.node.findMany({
    where: { communityId },
    select: { id: true, type: true, name: true, alias: true, subtitle: true, location: true, url: true, imageUrl: true, tags: true, metadata: true, communityId: true },
  });

  // Keep draft and unlisted (private) events out of the directory/graph — they're
  // reached only via their own page / share link, never the community listing.
  const nodeRows = allRows.filter((n) => {
    if (n.type !== 'event') return true;
    const meta = (n.metadata as Record<string, unknown>) ?? {};
    return meta.status !== 'draft' && meta.visibility !== 'private';
  });

  // Person.imageUrl is authoritative for profile photos (stays in sync with GCS uploads).
  // Node.imageUrl can be stale if old local-path images were never migrated to GCS.
  // Fetch person-type nodes to overlay profile data (image, bio, links).
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
  }>();
  if (personNodeIds.length > 0) {
    const personRows = await prisma.person.findMany({
      where: { id: { in: personNodeIds } },
      select: {
        id: true, imageUrl: true, bio: true, website: true,
        linkedinUrl: true, twitterUrl: true, phone: true,
        pronouns: true, openToWork: true,
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
      });
    }
  }

  return nodeRows.map(row => {
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
      };
    }
    return base;
  });
}

async function fetchCommunityLinks(communityId: string): Promise<NBLink[]> {
  const linkRows = await prisma.link.findMany({
    where: { communityId },
    select: { sourceId: true, targetId: true, relationship: true, since: true, metadata: true, communityId: true },
  });
  return linkRows.map(l => ({
    source: l.sourceId,
    target: l.targetId,
    relationship: l.relationship,
    since: l.since ?? undefined,
    metadata: (l.metadata as Record<string, unknown>) ?? {},
    community_id: l.communityId ?? undefined,
  }));
}

/**
 * Nodes-only data source for the directory grid/table. Cached under the shared
 * `graph-data-v2` tag, which every node/profile write already revalidates.
 */
export async function getCommunityNodes(communityId: string): Promise<NBNode[]> {
  try {
    return await unstable_cache(
      () => fetchCommunityNodes(communityId),
      ['community-nodes', communityId],
      { tags: ['graph-data-v2'] },
    )();
  } catch (err) {
    logger.error('eventRepo.getCommunityNodes.failed', { err });
    return [];
  }
}

export async function getCommunityLinks(communityId: string): Promise<NBLink[]> {
  try {
    return await unstable_cache(
      () => fetchCommunityLinks(communityId),
      ['community-links', communityId],
      { tags: ['graph-data-v2'] },
    )();
  } catch (err) {
    logger.error('eventRepo.getCommunityLinks.failed', { err });
    return [];
  }
}

export async function getCommunityGraphData(communityId: string): Promise<GraphData> {
  try {
    const [nodes, links] = await Promise.all([
      getCommunityNodes(communityId),
      getCommunityLinks(communityId),
    ]);
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
    const attendees: NBAttendee[] = attendeeRows.map(attendeeRowToNBAttendee);

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

/**
 * Resolve an event from a public URL slug (Node.alias, or the id minus the
 * `event:` prefix). Global lookup — no community scope needed for the public page.
 */
export async function getEventBySlug(slug: string): Promise<NBEvent | null> {
  try {
    const row = await prisma.node.findFirst({
      where: { type: 'event', OR: [{ alias: slug }, { id: `event:${slug}` }] },
    });
    return row ? nodeRowToNBEvent(row) : null;
  } catch (err) {
    logger.error('eventRepo.getEventBySlug.failed', { err });
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
    // rebuild fields
    coverImageUrl: event.coverImageUrl,
    theme: event.theme,
    status: event.status ?? 'published',
    slug: event.slug,
    waitlistEnabled: event.waitlistEnabled,
    guestListVisible: event.guestListVisible,
    allowPlusOnes: event.allowPlusOnes,
    allowedResponses: event.allowedResponses,
  };

  // Node.imageUrl powers the graph/directory poster; Node.alias powers /e/<slug>.
  const imageUrl = event.coverImageUrl ?? null;
  const alias = event.slug ?? null;

  await prisma.node.upsert({
    where: { id: event.id },
    create: {
      id: event.id,
      type: 'event',
      name: event.title,
      subtitle: event.description ?? null,
      location: event.location?.label ?? null,
      imageUrl,
      alias,
      communityId,
      tags: [],
      metadata: meta as object,
    },
    update: {
      name: event.title,
      subtitle: event.description ?? null,
      location: event.location?.label ?? null,
      imageUrl,
      alias,
      metadata: meta as object,
    },
  });
  revalidateTag('graph-data-v2');
}

export async function deleteEvent(communityId: string, eventId: string): Promise<void> {
  await prisma.node.deleteMany({ where: { id: eventId, communityId, type: 'event' } });
  revalidateTag('graph-data-v2');
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
    return rows.map(attendeeRowToNBAttendee);
  } catch (err) {
    logger.error('eventRepo.getAttendees.failed', { err });
    return [];
  }
}

export async function upsertAttendee(communityId: string, attendee: NBAttendee): Promise<void> {
  const writable = {
    personId: attendee.personId || null,
    name: attendee.name ?? null,
    email: attendee.email ?? null,
    linkedinUrl: attendee.linkedinUrl ?? null,
    companyName: attendee.companyName ?? null,
    roleTitle: attendee.roleTitle ?? null,
    answers: (attendee.answers as object) || {},
    status: attendee.status,
    response: attendee.response ?? null,
    plusOnes: attendee.plusOnes ?? 0,
    plusOneNames: attendee.plusOneNames ?? [],
    invitedBy: attendee.invitedBy ?? null,
    checkinAt: attendee.checkinAt ? new Date(attendee.checkinAt) : null,
  };
  await prisma.attendee.upsert({
    where: { id: attendee.id },
    create: { id: attendee.id, eventId: attendee.eventId, ...writable },
    update: writable,
  });
}

/**
 * Best-effort 'attended' graph link person -> event (so the directory can answer
 * "what did person Y attend"). Never throws into the RSVP path.
 */
async function ensureAttendedLink(
  communityId: string, personId: string, eventId: string, status: RSVPStatus, since?: string,
): Promise<void> {
  try {
    const existing = await prisma.link.findFirst({
      where: { sourceId: personId, targetId: eventId, relationship: 'attended' },
      select: { id: true },
    });
    if (existing) {
      await prisma.link.update({ where: { id: existing.id }, data: { metadata: { status } } });
    } else {
      await prisma.link.create({
        data: { sourceId: personId, targetId: eventId, relationship: 'attended', since: since ?? null, metadata: { status }, communityId },
      });
    }
    revalidateTag('graph-data-v2');
  } catch (err) {
    logger.error('eventRepo.ensureAttendedLink.failed', { err });
  }
}

export interface RsvpInput {
  name: string;
  email?: string;
  linkedinUrl?: string;
  companyName?: string;
  roleTitle?: string;
  response: RSVPResponse;
  plusOnes?: number;
  plusOneNames?: string[];
  answers?: Record<string, string | boolean>;
  invitedBy?: string;
}

/**
 * Create or update an RSVP for an event. Single source of truth shared by the
 * authenticated and public RSVP endpoints.
 *
 *  - Matches an existing community member (so the graph links up) but NEVER
 *    auto-creates a Person node for an unknown public guest — name/email live on
 *    the Attendee row. This keeps the directory clean and the RSVP path fast.
 *  - Computes going / waitlisted / pending from capacity + approval settings.
 *  - Idempotent per (event, email|name): re-RSVP updates the same row.
 */
export async function submitRsvp(
  communityId: string,
  event: NBEvent,
  submission: RsvpInput,
): Promise<{ attendee: NBAttendee; status: RSVPStatus; created: boolean }> {
  const eventId = event.id;

  // Person match is read-only — safe to resolve outside the capacity lock.
  const nodes = await getCommunityNodes(communityId);
  const matched = findMatchingPerson(nodes, {
    name: submission.name,
    email: submission.email,
    linkedinUrl: submission.linkedinUrl,
    companyName: submission.companyName,
  });
  const personId = matched?.id ?? '';
  const emailLc = submission.email?.toLowerCase();

  // Serialize the capacity-sensitive read → decide → write per event with a
  // transaction-scoped advisory lock, so two concurrent RSVPs can't both read the
  // same occupancy and overshoot capacity. The lock auto-releases at commit.
  const { attendee, created } = await prisma.$transaction(async (tx) => {
    // ::text cast — pg_advisory_xact_lock returns `void`, which Prisma's
    // $queryRaw cannot deserialize ("Failed to deserialize column of type 'void'").
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${eventId})::bigint)::text`;

    const existing = (await tx.attendee.findMany({ where: { eventId } })).map(attendeeRowToNBAttendee);

    // Prefer an email-keyed row over a person-keyed one: writing a submission's
    // email onto a *different* row that already holds it would violate
    // @@unique([eventId, email]). When no existing row holds this email, no
    // collision is possible, so falling back to the person match is safe.
    const byEmail = emailLc ? existing.find((a) => a.email?.toLowerCase() === emailLc) : undefined;
    const byPerson = personId ? existing.find((a) => a.personId === personId) : undefined;
    const existingAttendee = byEmail ?? byPerson;

    const party = 1 + (submission.plusOnes ?? 0);
    const occupied = occupiedSpots(existing.filter((a) => a.id !== existingAttendee?.id));
    const isExistingConfirmed = existingAttendee
      ? ['going', 'checked_in'].includes(normalizeStatus(existingAttendee.status))
      : false;
    const status = decideRsvpStatus(submission.response, party, {
      capacity: event.capacity,
      requireApproval: event.form.requireApproval,
      waitlistEnabled: event.waitlistEnabled,
      occupied,
      isExistingConfirmed,
    });
    if (status === 'full') throw new EventFullError();

    const now = new Date().toISOString();
    const next: NBAttendee = {
      id: existingAttendee?.id ?? generateAttendeeId(eventId, submission.email || submission.name),
      eventId,
      personId,
      name: submission.name,
      email: submission.email,
      linkedinUrl: submission.linkedinUrl,
      companyName: submission.companyName,
      roleTitle: submission.roleTitle,
      answers: { ...(existingAttendee?.answers ?? {}), ...(submission.answers ?? {}) },
      status,
      response: submission.response,
      plusOnes: submission.plusOnes ?? 0,
      plusOneNames: submission.plusOneNames ?? [],
      invitedBy: existingAttendee?.invitedBy ?? submission.invitedBy,
      createdAt: existingAttendee?.createdAt ?? now,
      updatedAt: now,
      checkinAt: existingAttendee?.checkinAt,
    };

    // Same field mapping as upsertAttendee, but bound to the locked transaction.
    const writable = {
      personId: next.personId || null,
      name: next.name ?? null,
      email: next.email ?? null,
      linkedinUrl: next.linkedinUrl ?? null,
      companyName: next.companyName ?? null,
      roleTitle: next.roleTitle ?? null,
      answers: (next.answers as object) || {},
      status: next.status,
      response: next.response ?? null,
      plusOnes: next.plusOnes ?? 0,
      plusOneNames: next.plusOneNames ?? [],
      invitedBy: next.invitedBy ?? null,
      checkinAt: next.checkinAt ? new Date(next.checkinAt) : null,
    };
    await tx.attendee.upsert({
      where: { id: next.id },
      create: { id: next.id, eventId: next.eventId, ...writable },
      update: writable,
    });

    return { attendee: next, created: !existingAttendee };
  });

  // Best-effort side effects, outside the lock.
  if (personId) {
    await ensureAttendedLink(communityId, personId, eventId, attendee.status, event.startAt);
  }
  if (created) {
    await updateEventAnalytics(communityId, eventId, { rsvpCount: event.analytics.rsvpCount + 1 });
  }

  return { attendee, status: attendee.status, created };
}

/**
 * Host action: change an attendee's operational status (approve, decline,
 * promote from waitlist, check in, mark no-show). Returns the updated attendee
 * or null if not found.
 */
export async function setAttendeeStatus(
  communityId: string,
  eventId: string,
  attendeeId: string,
  status: RSVPStatus,
): Promise<NBAttendee | null> {
  const attendees = await getAttendees(communityId, eventId);
  const attendee = attendees.find((a) => a.id === attendeeId);
  if (!attendee) return null;

  const next: NBAttendee = {
    ...attendee,
    status,
    checkinAt: status === 'checked_in' ? (attendee.checkinAt ?? new Date().toISOString()) : attendee.checkinAt,
    updatedAt: new Date().toISOString(),
  };
  await upsertAttendee(communityId, next);

  if (status === 'checked_in') {
    const event = await getEvent(communityId, eventId);
    if (event) {
      await updateEventAnalytics(communityId, eventId, {
        checkinCount: (event.analytics.checkinCount ?? 0) + (attendee.status === 'checked_in' ? 0 : 1),
      });
    }
  }
  if (next.personId) {
    await ensureAttendedLink(communityId, next.personId, eventId, status, undefined);
  }
  return next;
}

/** Permanently remove an attendee (and any 'attended' graph link). */
export async function removeAttendee(communityId: string, eventId: string, attendeeId: string): Promise<boolean> {
  const attendees = await getAttendees(communityId, eventId);
  const attendee = attendees.find((a) => a.id === attendeeId);
  if (!attendee) return false;
  await prisma.attendee.deleteMany({ where: { id: attendeeId, eventId } });
  if (attendee.personId) {
    try {
      await prisma.link.deleteMany({ where: { sourceId: attendee.personId, targetId: eventId, relationship: 'attended' } });
      revalidateTag('graph-data-v2');
    } catch (err) {
      logger.error('eventRepo.removeAttendee.linkCleanup.failed', { err });
    }
  }
  return true;
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
          ${n.id}, ${n.type.toLowerCase()}, ${n.name}, ${communityId},
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

