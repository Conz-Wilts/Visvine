/**
 * The tools beside the directory, each filled the way its own surface fills it:
 *
 *  - Events — the event record, its `events/<slug>.md` note with the schedule
 *    mirrored into frontmatter (lib/eventRepo.ts#upsertEvent), attendees, and
 *    the attended/hosting edges.
 *  - Channels — sections and channels, each with its node and its
 *    `sections/` / `channels/` note (lib/messages/conversationService.ts), and
 *    the messages in them.
 *  - The Drive — folders, files, and each text-bearing file's contents indexed
 *    under `resources/` so it ranks in search beside notes
 *    (lib/resources/service.ts#uploadResource). A seeded file has never been
 *    uploaded, so it has no object in storage and no `gcsPath` (a server-minted
 *    column); what it does have is real extracted text and chunks.
 */

import prisma from '../../../lib/prisma'
import {
  ensureEntityNote,
  syncEntityNode,
  syncEntityNoteFrontmatter,
  spaceNodeId,
} from '../../../lib/notes/context/entityNodes'
import { upsertLink } from '../../../lib/notes/context/links'
import { ingestSource } from '../../../lib/notes/sources/ingest'
import { normalizeSourcePath, sourceKindOf } from '../../../lib/notes/shared/sourceTypes'
import { SHARED_OWNER_KEY } from '../../../lib/notes/store'
import {
  CHANNELS,
  CHANNEL_SECTIONS,
  EVENTS,
  FILE_RESOURCES,
  MESSAGES,
  RESOURCE_NODE,
  type SeedEvent,
} from '../dataset'
import { buildModel } from '../model'
import { ADMIN_NODE, ADMIN_USER, MEMBER_USER, SPACE_ID, SPACE_TIMEZONE } from '../space'
import { anchorActor } from './base'
import { daysAgo, hoursAgo } from '../write'

const ANCHOR_USERS = [ADMIN_USER, MEMBER_USER]
const userIdFor = (who: 'admin' | 'member') => (who === 'admin' ? ADMIN_USER : MEMBER_USER)

/**
 * ISO timestamp `d` days from now at `hh:mm`, stamped +12:00 (Pacific/Auckland
 * standard time) — close enough that "tomorrow at 2pm" reads right.
 */
function inDays(d: number, hh: number, mm = 0): string {
  const t = new Date(Date.now() + d * 24 * 3600_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(hh)}:${pad(mm)}:00+12:00`
}

// ---- events -------------------------------------------------------------------

export async function seedEvents(): Promise<{ events: number; attendees: number }> {
  const model = buildModel()
  const actor = anchorActor(ADMIN_USER)
  const personNodeByName = new Map(model.people.map((p) => [p.name.toLowerCase(), p.nodeId]))
  let attendees = 0

  for (const e of EVENTS as SeedEvent[]) {
    const eventId = `event:${e.slug}`
    const start = inDays(e.startInDays, e.startHour)
    const end = inDays(e.startInDays, e.endHour)
    const rows = (e.attendees ?? []).map((a) => ({
      ...a,
      person: a.person ?? (a.name ? personNodeByName.get(a.name.toLowerCase()) : undefined),
    }))
    const created = new Date(new Date(start).getTime() - 30 * 24 * 3600_000)
    const metadata = {
      seeded: true,
      description: e.description,
      start_at: start,
      end_at: end,
      timezone: SPACE_TIMEZONE,
      locationData: { label: e.locationLabel, address: e.locationAddress, lat: e.lat, lon: e.lon },
      hosts: [ADMIN_NODE],
      organizerEmail: 'admin@local.dev',
      capacity: e.capacity,
      visibility: e.visibility,
      status: 'published',
      slug: e.slug,
      waitlistEnabled: e.waitlistEnabled ?? false,
      guestListVisible: e.guestListVisible ?? true,
      allowPlusOnes: e.allowPlusOnes ?? 0,
      form: e.form ?? { enabled: false, slug: '', schema: [] },
      analytics: {
        views: e.views,
        rsvpCount: rows.filter((a) => ['going', 'checked_in'].includes(a.status)).length,
        checkinCount: rows.filter((a) => a.status === 'checked_in').length,
        createdAt: created.toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }
    // Node.alias is the public /e/<slug> route for an event.
    await prisma.node.create({
      data: {
        id: eventId,
        type: 'event',
        name: e.name,
        subtitle: e.description,
        location: e.locationLabel,
        alias: e.slug,
        tags: ['event'],
        metadata: metadata as object,
        spaceId: SPACE_ID,
        createdAt: created,
      },
    })
    const note = await ensureEntityNote(
      SPACE_ID,
      // The description rides in as the note's subtitle line; the body is left
      // for what people write about the event.
      { id: eventId, type: 'event', name: e.name, subtitle: e.description },
      { actor },
    )
    if (note.noteError) throw new Error(`seed: event note for ${eventId}: ${note.noteError}`)
    await syncEntityNoteFrontmatter(
      { id: eventId, type: 'event', spaceId: SPACE_ID, name: e.name, location: e.locationLabel, metadata },
      actor,
    )

    for (const a of rows) {
      const attendeeId = `attendee:${e.slug}-${a.n}`
      await prisma.eventAttendee.create({
        data: {
          id: attendeeId,
          eventId,
          personId: a.person ?? null,
          name: a.name ?? null,
          email: a.email,
          companyName: a.company ?? null,
          roleTitle: a.role ?? null,
          answers: (a.answers ?? {}) as object,
          status: a.status,
          response: a.response ?? null,
          plusOnes: a.plusOnes ?? 0,
          plusOneNames: a.plusOneNames ?? [],
          checkinAt: a.status === 'checked_in' ? new Date(start) : null,
          createdAt: new Date(created.getTime() + a.n * 36 * 3600_000),
        },
      })
      attendees++
      if (a.person && !['cancelled', 'invited'].includes(a.status)) {
        await upsertLink({
          spaceId: SPACE_ID,
          sourceId: a.person,
          targetId: eventId,
          relationship: 'attended',
          origin: 'event_attendance',
          originRef: attendeeId,
          since: start,
          metadata: { status: a.status },
          revalidate: false,
        })
      }
    }
    await upsertLink({
      spaceId: SPACE_ID,
      sourceId: ADMIN_NODE,
      targetId: eventId,
      relationship: 'hosting',
      origin: 'event_hosting',
      originRef: eventId,
      since: created.toISOString(),
      revalidate: false,
    })
  }
  return { events: EVENTS.length, attendees }
}

// ---- channels -----------------------------------------------------------------

export async function seedChannels(): Promise<{ sections: number; channels: number; messages: number }> {
  const actor = anchorActor(ADMIN_USER)
  const sectionNode = new Map<string, string>()

  for (const s of CHANNEL_SECTIONS) {
    await prisma.channelSection.create({
      data: { id: s.id, spaceId: SPACE_ID, name: s.name, icon: s.icon, position: s.position },
    })
    const sync = await syncEntityNode({
      spaceId: SPACE_ID,
      type: 'section',
      name: s.name,
      recordId: s.id,
      metadata: { icon: s.icon },
      parentNodeId: spaceNodeId(SPACE_ID),
      actor,
      revalidate: false,
    })
    if (sync.noteError) throw new Error(`seed: section note for ${s.name}: ${sync.noteError}`)
    sectionNode.set(s.id, sync.nodeId)
  }

  for (const ch of CHANNELS) {
    const conversation = await prisma.conversation.create({
      data: {
        id: ch.id,
        type: 'CHANNEL',
        name: ch.name,
        description: ch.description,
        icon: ch.icon,
        spaceId: SPACE_ID,
        sectionId: ch.section,
        createdById: ADMIN_USER,
        createdAt: daysAgo(60),
        members: {
          create: ANCHOR_USERS.map((userId) => ({
            userId,
            role: userId === ADMIN_USER ? 'ADMIN' : 'MEMBER',
            joinedAt: daysAgo(60),
          })),
        },
      },
    })
    const sync = await syncEntityNode({
      spaceId: SPACE_ID,
      type: 'channel',
      name: ch.name,
      recordId: conversation.id,
      subtitle: ch.description,
      metadata: { viewMode: conversation.viewMode, icon: ch.icon },
      parentNodeId: sectionNode.get(ch.section) ?? spaceNodeId(SPACE_ID),
      actor,
      revalidate: false,
    })
    if (sync.noteError) throw new Error(`seed: channel note for #${ch.name}: ${sync.noteError}`)
  }

  for (const m of MESSAGES) {
    await prisma.message.create({
      data: {
        id: m.id,
        conversationId: m.chan,
        senderId: userIdFor(m.from),
        text: m.text,
        replyToId: m.replyTo ?? null,
        pinnedAt: m.pinned ? hoursAgo(m.hoursAgo - 1) : null,
        createdAt: hoursAgo(m.hoursAgo),
        reactions: {
          create: (m.reactions ?? []).map((r) => ({ userId: userIdFor(r.from), emoji: r.emoji })),
        },
      },
    })
  }
  return { sections: CHANNEL_SECTIONS.length, channels: CHANNELS.length, messages: MESSAGES.length }
}

// ---- the Drive ----------------------------------------------------------------

const DRIVE_FOLDERS = [
  { id: 'rfold_hq_revenue', name: 'Revenue', parentId: null as string | null },
  { id: 'rfold_hq_deals', name: 'Deal room', parentId: null },
  { id: 'rfold_hq_board', name: 'Board reporting', parentId: null },
  { id: 'rfold_hq_revenue_q3', name: 'Q3 2026', parentId: 'rfold_hq_revenue' },
  { id: 'rfold_hq_deals_quarterdeck', name: 'Quarterdeck', parentId: 'rfold_hq_deals' },
]

/** Which folder each seeded file is filed in; unlisted files sit at the root. */
const FILING: Record<string, string> = {
  'revenue-roll-up.csv': 'rfold_hq_revenue_q3',
  'segment-pricing.csv': 'rfold_hq_board',
  'onboarding-checklist.md': 'rfold_hq_deals',
}

const MIME: Record<string, string> = { csv: 'text/csv', md: 'text/markdown' }

export async function seedDrive(): Promise<{ files: number; indexed: number }> {
  const context = { spaceId: SPACE_ID, ownerKey: SHARED_OWNER_KEY }
  for (const folder of DRIVE_FOLDERS) {
    await prisma.resourceFolder.create({
      data: { ...folder, spaceId: SPACE_ID, createdBy: ADMIN_USER, createdAt: daysAgo(14) },
    })
  }

  let indexed = 0
  for (const r of FILE_RESOURCES) {
    const buffer = Buffer.from(r.body, 'utf8')
    const mimeType = MIME[r.fileType] ?? 'text/plain'
    const kind = sourceKindOf(r.file)
    const resource = await prisma.resource.create({
      data: {
        spaceId: SPACE_ID,
        name: r.name,
        fileType: r.fileType,
        fileSize: buffer.length,
        uploadedBy: ADMIN_USER,
        folderId: FILING[r.file] ?? null,
        indexState: kind ? 'pending' : 'unsupported',
        metadata: { originalFilename: r.file, mimeType, seeded: true },
        createdAt: daysAgo(r.daysAgo),
      },
    })
    if (!kind) continue
    const meta = await ingestSource(context, {
      path: normalizeSourcePath(`resources/${r.file}`),
      name: r.file,
      kind,
      mimeType,
      buffer,
      createdBy: ADMIN_USER,
      // The Resource owns the object; the source is only its chunked projection.
      storeOriginal: false,
    })
    await prisma.resource.update({
      where: { id: resource.id },
      data: {
        sourcePath: meta.path,
        indexState: meta.status === 'ready' ? 'indexed' : 'failed',
        indexError: meta.error ?? null,
      },
    })
    if (meta.status === 'ready') indexed++
  }

  // A comment thread and the change-proposal queue over the roll-up table: one
  // approved restatement, one rejected guess.
  const rollUp = await prisma.resource.findFirst({ where: { spaceId: SPACE_ID, name: 'Revenue roll-up (Q3)' } })
  if (rollUp) {
    await prisma.resourceComment.createMany({
      data: [
        {
          resourceId: rollUp.id,
          cellRef: 'D8',
          author: 'Dev Admin',
          content: 'Corporate Innovation MRR includes Northbank, which I would not count on past March.',
          createdAt: daysAgo(4),
        },
        {
          resourceId: rollUp.id,
          cellRef: null,
          author: 'Dev Admin',
          content: 'Refreshing the whole roll-up after the September invoices land.',
          createdAt: daysAgo(3),
        },
      ],
    })
    await prisma.resourceChange.createMany({
      data: [
        {
          id: 'rch_hq_002',
          resourceId: rollUp.id,
          cellRef: 'E3',
          originalValue: '97',
          proposedValue: '99',
          reason: 'Venture Capital NRR restated once the Harbourline downgrade was backdated.',
          proposedBy: ADMIN_USER,
          status: 'approved',
          reviewedBy: ADMIN_USER,
          reviewedAt: daysAgo(3),
          createdAt: daysAgo(3.2),
        },
        {
          id: 'rch_hq_003',
          resourceId: rollUp.id,
          cellRef: 'C5',
          originalValue: '381',
          proposedValue: '410',
          reason: 'Thought the Third Space expansion had been invoiced — it had not.',
          proposedBy: MEMBER_USER,
          status: 'rejected',
          reviewedBy: ADMIN_USER,
          reviewedAt: daysAgo(3.5),
          createdAt: daysAgo(3.6),
        },
      ],
    })
  }

  // A standalone Resource record, so the type appears in the directory with its
  // own resources/ note beside the files.
  const sync = await syncEntityNode({
    spaceId: SPACE_ID,
    type: 'resource',
    nodeId: RESOURCE_NODE.id,
    name: RESOURCE_NODE.name,
    subtitle: RESOURCE_NODE.subtitle,
    url: RESOURCE_NODE.url,
    tags: [...RESOURCE_NODE.tags],
    body: `${RESOURCE_NODE.subtitle}. Linked from onboarding, and the first thing a new space admin is sent.`,
    actor: anchorActor(ADMIN_USER),
    revalidate: false,
  })
  if (sync.noteError) throw new Error(`seed: resource note: ${sync.noteError}`)

  return { files: FILE_RESOURCES.length, indexed }
}
