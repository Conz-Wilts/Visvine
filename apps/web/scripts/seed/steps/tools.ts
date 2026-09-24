/**
 * The tools beside the directory, each filled the way its own surface fills it:
 *
 *  - Events — the event record, its `events/<slug>.md` note with the schedule
 *    mirrored into frontmatter (lib/eventRepo.ts#upsertEvent), attendees, and
 *    the attended/hosting edges. An event naming a `space` is written in that
 *    room instead, which is how the house comes to show a rolled-up one.
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
import { ensureMemberNode } from '../../../lib/spaces/memberNode'
import { normalizeSourcePath, sourceKindOf } from '../../../lib/notes/shared/sourceTypes'
import { SHARED_OWNER_KEY } from '../../../lib/notes/store'
import { linkFileNode } from '../../../lib/resources/node'
import {
  CHANNELS,
  CHANNEL_SECTIONS,
  EVENTS,
  FILE_RESOURCES,
  MESSAGES,
  RESOURCE_NODE,
  type SeedEvent,
  type SeedEventAttendee,
} from '../dataset'
import { buildModel } from '../model'
import { ADMIN_NODE, ADMIN_USER, MEMBER_NODE, MEMBER_USER, SPACE_ID, SPACE_TIMEZONE } from '../space'
import { SUBSPACES } from '../subspaces'
import { anchorActor } from './base'
import { daysAgo, hoursAgo } from '../write'

const ANCHOR_USERS = [ADMIN_USER, MEMBER_USER]
const userIdFor = (who: 'admin' | 'member') => (who === 'admin' ? ADMIN_USER : MEMBER_USER)

/**
 * ISO timestamp `d` days from now at `hh:mm`, stamped +10:00 (Australia/Sydney
 * standard time) — close enough that "tomorrow at 2pm" reads right.
 */
function inDays(d: number, hh: number, mm = 0): string {
  const t = new Date(Date.now() + d * 24 * 3600_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(hh)}:${pad(mm)}:00+10:00`
}

/** An event's own published times, or its relative ones. */
function timesOf(e: SeedEvent): { start: string; end: string } {
  if (e.startAt && e.endAt) return { start: e.startAt, end: e.endAt }
  if (e.startInDays === undefined || e.startHour === undefined || e.endHour === undefined) {
    throw new Error(`seed: event ${e.slug} has neither published nor relative times`)
  }
  return { start: inDays(e.startInDays, e.startHour), end: inDays(e.startInDays, e.endHour) }
}

// ---- events -------------------------------------------------------------------

export async function seedEvents(): Promise<{ events: number; attendees: number }> {
  const model = buildModel()
  const actor = anchorActor(ADMIN_USER)
  // People never flow: an event in a room names the room's own records, and
  // the anchors by the member nodes their room membership minted.
  const houseByName = new Map(model.people.map((p) => [p.name.toLowerCase(), p.nodeId]))
  const roomByName = new Map(
    SUBSPACES.map((sub) => [sub.id, new Map((sub.people ?? []).map((p) => [p.name.toLowerCase(), p.nodeId]))]),
  )
  const anchorUser: Record<string, string> = { [ADMIN_NODE]: ADMIN_USER, [MEMBER_NODE]: MEMBER_USER }
  const resolve = async (spaceId: string, a: SeedEventAttendee): Promise<string | undefined> => {
    if (spaceId === SPACE_ID) return a.person ?? (a.name ? houseByName.get(a.name.toLowerCase()) : undefined)
    if (a.person) {
      const userId = anchorUser[a.person]
      return userId ? ((await ensureMemberNode(spaceId, userId, actor, null)) ?? undefined) : undefined
    }
    return a.name ? roomByName.get(spaceId)?.get(a.name.toLowerCase()) : undefined
  }
  let attendees = 0

  for (const e of EVENTS as SeedEvent[]) {
    // A room's own event is written in the room, by the same code: the house
    // reads it rolled up, and nothing about it is copied upward.
    const spaceId = e.space ?? SPACE_ID
    const hostNode =
      spaceId === SPACE_ID ? ADMIN_NODE : await ensureMemberNode(spaceId, ADMIN_USER, actor, null)
    if (!hostNode) throw new Error(`seed: no host node for ${e.slug} in ${spaceId}`)
    const eventId = `event:${e.slug}`
    const { start, end } = timesOf(e)
    const rows = []
    for (const a of e.attendees ?? []) rows.push({ ...a, person: await resolve(spaceId, a) })
    const created = new Date(new Date(start).getTime() - 30 * 24 * 3600_000)
    const metadata = {
      seeded: true,
      description: e.description,
      start_at: start,
      end_at: end,
      timezone: e.timezone ?? SPACE_TIMEZONE,
      locationData: { label: e.locationLabel, address: e.locationAddress, lat: e.lat, lon: e.lon },
      hosts: [hostNode],
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
        spaceId,
        createdAt: created,
      },
    })
    const note = await ensureEntityNote(
      spaceId,
      // The description rides in as the note's subtitle line; the body is left
      // for what people write about the event.
      { id: eventId, type: 'event', name: e.name, subtitle: e.description },
      { actor },
    )
    if (note.noteError) throw new Error(`seed: event note for ${eventId}: ${note.noteError}`)
    await syncEntityNoteFrontmatter(
      { id: eventId, type: 'event', spaceId, name: e.name, location: e.locationLabel, metadata },
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
          spaceId,
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
      spaceId,
      sourceId: hostNode,
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
        viewMode: ch.viewMode ?? 'CHAT',
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
  { id: 'rfold_bb_portfolio', name: 'Portfolio', parentId: null as string | null },
  { id: 'rfold_bb_investments', name: 'Investments', parentId: null },
  { id: 'rfold_bb_programs', name: 'Programs', parentId: null },
  { id: 'rfold_bb_funds', name: 'Funds', parentId: null },
  { id: 'rfold_bb_sunrise', name: 'Sunrise Aotearoa 2026', parentId: 'rfold_bb_programs' },
]

/** Which folder each seeded file is filed in; unlisted files sit at the root. */
const FILING: Record<string, string> = {
  'portfolio-by-sector.csv': 'rfold_bb_portfolio',
  'fund-performance.csv': 'rfold_bb_funds',
  'sunrise-aotearoa-run-sheet.md': 'rfold_bb_sunrise',
  'investment-memo-template.md': 'rfold_bb_investments',
  'giants-mentor-guide.md': 'rfold_bb_programs',
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
    // Every file is the content of a Resource, as an upload makes it.
    await linkFileNode(resource, null, { revalidate: false })
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

  // A comment thread and the change-proposal queue over the sector table: one
  // approved correction, one rejected guess.
  const bySector = await prisma.resource.findFirst({ where: { spaceId: SPACE_ID, name: 'Portfolio by sector' } })
  if (bySector) {
    await prisma.resourceComment.createMany({
      data: [
        {
          resourceId: bySector.id,
          cellRef: 'D2',
          author: 'Dev Admin',
          content: 'Exited counts what actually happened, not the stage on the website — Eucalyptus, Factor and SafeStack among them.',
          createdAt: daysAgo(5),
        },
        {
          resourceId: bySector.id,
          cellRef: null,
          author: 'Dev Admin',
          content: 'Regenerated from the portfolio records after the September research pass.',
          createdAt: daysAgo(4),
        },
      ],
    })
    await prisma.resourceChange.createMany({
      data: [
        {
          id: 'rch_bb_001',
          resourceId: bySector.id,
          cellRef: 'D2',
          originalValue: '12',
          proposedValue: '13',
          reason: 'Hall is exited: Tracksuit acquired it in July 2026.',
          proposedBy: ADMIN_USER,
          status: 'approved',
          reviewedBy: ADMIN_USER,
          reviewedAt: daysAgo(4),
          createdAt: daysAgo(4.2),
        },
        {
          id: 'rch_bb_002',
          resourceId: bySector.id,
          cellRef: 'C2',
          originalValue: '55',
          proposedValue: '56',
          reason: 'Count CarbonChain as active — its site still shows it independent.',
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
    body: `${RESOURCE_NODE.subtitle}. Where a portfolio company posts a role so the whole community sees it.`,
    actor: anchorActor(ADMIN_USER),
    revalidate: false,
  })
  if (sync.noteError) throw new Error(`seed: resource note: ${sync.noteError}`)

  return { files: FILE_RESOURCES.length, indexed }
}
