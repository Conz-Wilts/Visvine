/**
 * Fills Visvine HQ with the surfaces the directory and notes layers don't
 * cover, so every tool in the app has something in it: events (+ attendees,
 * attended/hosting links, a registration form with approval and a waitlist),
 * the Drive, channel sections + channels + messages with replies, reactions
 * and pins, and a standalone Resource node so that type shows up in the
 * directory beside the organisations and people.
 *
 *   pnpm db:hq:extras     (after pnpm db:seed and pnpm db:hq)
 *
 * Additive & idempotent: explicit ids + upserts, or delete-by-seed-marker where
 * rows have generated ids. Never touches another space. Local-only, guarded
 * like every destructive db:* script.
 *
 * On the Drive rows: they carry no bytes. `Resource.gcsPath` is server-minted
 * from a real upload, and a seeded row has never been through one — the schema
 * allows null for exactly this case, and `index_state` stays `pending` rather
 * than claiming a RAG projection that does not exist. The file BODIES live in
 * ./seed/dataset.ts, which is what a demo needs them for.
 */

import '../../../scripts/guard-local-db.mjs'
import 'dotenv/config'
import prisma from '../lib/prisma'
import { buildModel } from './seed/model'
import {
  CHANNELS,
  CHANNEL_SECTIONS,
  EVENTS,
  FILE_RESOURCES,
  MESSAGES,
  RESOURCE_NODE,
  type SeedEvent,
} from './seed/dataset'
import { ADMIN_NODE, ADMIN_USER, MEMBER_USER, SPACE_ID, SPACE_TIMEZONE } from './seed/space'

const model = buildModel()
const ANCHOR_USERS = [ADMIN_USER, MEMBER_USER]

// ---- utilities ---------------------------------------------------------------

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000)
const daysAgo = (d: number) => hoursAgo(d * 24)

/**
 * ISO timestamp `d` days from now at `hh:mm`, stamped +12:00 (Pacific/Auckland
 * standard time). Demo data: close enough that "tomorrow at 2pm" reads right,
 * and the space's own `timezone` is what the app formats with.
 */
function inDays(d: number, hh: number, mm = 0): string {
  const t = new Date(Date.now() + d * 24 * 3600_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(hh)}:${pad(mm)}:00+12:00`
}

async function upsertNode(input: {
  id: string
  type: string
  name: string
  subtitle?: string | null
  location?: string | null
  url?: string | null
  tags?: string[]
  metadata?: Record<string, unknown>
  alias?: string | null
  createdDaysAgo?: number
}) {
  const data = {
    type: input.type,
    name: input.name,
    subtitle: input.subtitle ?? null,
    location: input.location ?? null,
    url: input.url ?? null,
    tags: input.tags ?? [],
    metadata: (input.metadata ?? {}) as object,
    spaceId: SPACE_ID,
    alias: input.alias ?? null,
  }
  await prisma.node.upsert({
    where: { id: input.id },
    create: { id: input.id, ...data, createdAt: daysAgo(input.createdDaysAgo ?? 60) },
    update: data,
  })
}

async function upsertLinkRow(input: {
  sourceId: string
  targetId: string
  relationship: string
  origin: string
  originRef?: string | null
  since?: string | null
  metadata?: Record<string, unknown>
}) {
  const key = pairKey(input.sourceId, input.targetId)
  const shared = {
    origin: input.origin,
    originRef: input.originRef ?? null,
    metadata: (input.metadata ?? {}) as object,
  }
  await prisma.link.upsert({
    where: { link_identity: { spaceId: SPACE_ID, pairKey: key, relationship: input.relationship } },
    create: {
      sourceId: input.sourceId,
      targetId: input.targetId,
      relationship: input.relationship,
      since: input.since ?? null,
      spaceId: SPACE_ID,
      pairKey: key,
      ...shared,
    },
    update: shared,
  })
}

async function main() {
  const space = await prisma.space.findUnique({ where: { id: SPACE_ID }, select: { id: true } })
  if (!space) throw new Error(`space "${SPACE_ID}" not found — run \`pnpm db:seed\` first`)
  const users = await prisma.user.findMany({ where: { id: { in: ANCHOR_USERS } }, select: { id: true } })
  if (users.length < ANCHOR_USERS.length) {
    throw new Error(
      `add-visvine-hq-extras: expected the ${ANCHOR_USERS.length} seed anchors, found ${users.length} — run \`pnpm db:seed\` first`,
    )
  }
  const userIdFor = (who: 'admin' | 'member') => (who === 'admin' ? ADMIN_USER : MEMBER_USER)

  // Which person nodes actually exist, so an attendee can be bound to their
  // directory card (and earn an `attended` edge) without risking the FK.
  const existingNodes = new Set(
    (await prisma.node.findMany({ where: { spaceId: SPACE_ID }, select: { id: true } })).map((n) => n.id),
  )
  const personNodeByName = new Map(
    model.people.filter((p) => existingNodes.has(p.nodeId)).map((p) => [p.name.toLowerCase(), p.nodeId]),
  )

  // 1. Events + attendees + attended/hosting links
  console.log('--- Events ---')
  let attendeeCount = 0
  for (const e of EVENTS as SeedEvent[]) {
    const eventId = `event:${e.slug}`
    const start = inDays(e.startInDays, e.startHour)
    const end = inDays(e.startInDays, e.endHour)
    const rows = (e.attendees ?? []).map((a) => ({
      ...a,
      person: a.person ?? (a.name ? personNodeByName.get(a.name.toLowerCase()) : undefined),
    }))
    const rsvpCount = rows.filter((a) => ['going', 'checked_in'].includes(a.status)).length
    const checkinCount = rows.filter((a) => a.status === 'checked_in').length
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
        rsvpCount,
        checkinCount,
        createdAt: created.toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }
    // Node.alias is the public /e/<slug> route for an event (lib/eventRepo.ts).
    await upsertNode({
      id: eventId,
      type: 'event',
      name: e.name,
      subtitle: e.description.slice(0, 140),
      location: e.locationLabel,
      alias: e.slug,
      tags: ['event'],
      metadata,
    })

    for (const a of rows) {
      const attendeeId = `attendee:${e.slug}-${a.n}`
      const attendeeData = {
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
      }
      await prisma.eventAttendee.upsert({
        where: { eventId_email: { eventId, email: a.email } },
        create: {
          id: attendeeId,
          ...attendeeData,
          createdAt: new Date(created.getTime() + a.n * 36 * 3600_000),
        },
        update: attendeeData,
      })
      attendeeCount++
      if (a.person && !['cancelled', 'invited'].includes(a.status)) {
        await upsertLinkRow({
          sourceId: a.person,
          targetId: eventId,
          relationship: 'attended',
          origin: 'event_attendance',
          originRef: attendeeId,
          since: start,
          metadata: { status: a.status },
        })
      }
    }
    await upsertLinkRow({
      sourceId: ADMIN_NODE,
      targetId: eventId,
      relationship: 'hosting',
      origin: 'event_hosting',
      originRef: eventId,
      since: created.toISOString(),
    })
  }
  console.log(`  ✓ ${EVENTS.length} events, ${attendeeCount} attendees (+ attended/hosting links)`)

  // 2. Resource node (so the Resource type shows in the directory)
  await upsertNode({
    id: RESOURCE_NODE.id,
    type: 'resource',
    name: RESOURCE_NODE.name,
    subtitle: RESOURCE_NODE.subtitle,
    url: RESOURCE_NODE.url,
    tags: [...RESOURCE_NODE.tags],
    metadata: { seeded: true },
  })

  // 3. The Drive. Rows only — see the header on why there are no bytes.
  console.log('\n--- Drive ---')
  await prisma.$executeRaw`
    DELETE FROM resources WHERE space_id = ${SPACE_ID} AND metadata->>'seeded' = 'true'`
  const resourceIdByFile = new Map<string, string>()
  for (const r of FILE_RESOURCES) {
    const row = await prisma.resource.create({
      data: {
        spaceId: SPACE_ID,
        name: r.name,
        fileType: r.fileType,
        fileSize: Buffer.byteLength(r.body),
        uploadedBy: ADMIN_USER,
        indexState: 'pending',
        metadata: { seeded: true },
        createdAt: daysAgo(r.daysAgo),
      },
      select: { id: true },
    })
    resourceIdByFile.set(r.file, row.id)
  }
  const rollUpId = resourceIdByFile.get('revenue-roll-up.csv')
  if (rollUpId) {
    await prisma.resourceComment.createMany({
      data: [
        {
          resourceId: rollUpId,
          cellRef: 'D8',
          author: 'Dev Admin',
          content: 'Corporate Innovation MRR includes Northbank, which I would not count on past March.',
          createdAt: daysAgo(4),
        },
        {
          resourceId: rollUpId,
          cellRef: null,
          author: 'Dev Admin',
          content: 'Refreshing the whole roll-up after the September invoices land.',
          createdAt: daysAgo(3),
        },
      ],
    })
  }
  console.log(`  ✓ ${FILE_RESOURCES.length} files + 2 comments`)

  // 4. Channel sections, channels, messages
  console.log('\n--- Channels & messages ---')
  for (const s of CHANNEL_SECTIONS) {
    await prisma.channelSection.upsert({
      where: { id: s.id },
      create: { id: s.id, spaceId: SPACE_ID, name: s.name, icon: s.icon, position: s.position },
      update: { name: s.name, icon: s.icon, position: s.position },
    })
  }
  for (const ch of CHANNELS) {
    await prisma.conversation.upsert({
      where: { id: ch.id },
      create: {
        id: ch.id,
        type: 'CHANNEL',
        name: ch.name,
        description: ch.description,
        icon: ch.icon,
        spaceId: SPACE_ID,
        sectionId: ch.section,
        createdById: ADMIN_USER,
        createdAt: daysAgo(60),
      },
      update: {
        name: ch.name,
        description: ch.description,
        icon: ch.icon,
        spaceId: SPACE_ID,
        sectionId: ch.section,
      },
    })
    for (const uid of ANCHOR_USERS) {
      await prisma.conversationMember.upsert({
        where: { conversationId_userId: { conversationId: ch.id, userId: uid } },
        create: {
          conversationId: ch.id,
          userId: uid,
          role: uid === ADMIN_USER ? 'ADMIN' : 'MEMBER',
          joinedAt: daysAgo(60),
        },
        update: {},
      })
    }
  }
  for (const m of MESSAGES) {
    const data = {
      conversationId: m.chan,
      senderId: userIdFor(m.from),
      text: m.text,
      replyToId: m.replyTo ?? null,
      pinnedAt: m.pinned ? hoursAgo(m.hoursAgo - 1) : null,
    }
    await prisma.message.upsert({
      where: { id: m.id },
      create: { id: m.id, ...data, createdAt: hoursAgo(m.hoursAgo) },
      update: { ...data, createdAt: hoursAgo(m.hoursAgo) },
    })
    for (const r of m.reactions ?? []) {
      const userId = userIdFor(r.from)
      const existing = await prisma.messageReaction.findFirst({
        where: { messageId: m.id, userId, emoji: r.emoji },
        select: { id: true },
      })
      if (!existing) {
        await prisma.messageReaction.create({ data: { messageId: m.id, userId, emoji: r.emoji } })
      }
    }
  }
  console.log(
    `  ✓ ${CHANNEL_SECTIONS.length} sections, ${CHANNELS.length} channels, ${MESSAGES.length} messages`,
  )

  const summary = await prisma.node.groupBy({
    by: ['type'],
    where: { spaceId: SPACE_ID },
    _count: { _all: true },
  })
  console.log('\n=== Committed ===')
  console.table(summary.map((r) => ({ type: r.type, count: r._count._all })))
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
