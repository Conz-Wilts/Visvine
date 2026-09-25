/**
 * Resources as an AI meets them: every file and link a space holds, whether it
 * was uploaded, dropped into a channel or pasted into a message — found, read,
 * and shared on, under exactly the visibility a person has
 * (lib/resources/visibility.ts). A private channel's file is its members'
 * alone here as everywhere; an agent sees what the person it runs as sees.
 *
 * A resource is used by id. Nothing here returns a signed URL: those are bearer
 * capabilities for the bytes, and the id is the currency the other actions
 * take (`cover_resource_id`, `set_image`). Every read, share and use is written
 * to `resource_access` with the door it came through.
 */
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { defineAction, ActionError, type ActionCaller } from '@/lib/actions/types'
import { requireSpaceContext, resolveTarget } from '@/lib/actions/resolve'
import { inSpaces } from '@/lib/actions/searchEverywhere'
import { accessOf, asMessaging, folderFor, messageHref, stampShare } from '@/lib/actions/resourceUse'
import { featureAccessForbidden } from '@/lib/auth'
import { listResources } from '@/lib/resources/list'
import { loadView } from '@/lib/resources/views'
import { requireVisibleResource, resourceViewer } from '@/lib/resources/visibility'
import { readResourceTextAs } from '@/lib/resources/text'
import { logResourceAccess } from '@/lib/resources/accessLog'
import { LIST_KINDS, PAGE_SIZE, type ListQuery } from '@/lib/resources/shared/listQuery'
import type { ResourceView } from '@/lib/resources/shared/view'
import { readFederated } from '@/lib/notes/federation'
import { sendMessage } from '@/lib/messages'
import { publishToUsers } from '@/lib/messages/realtime'
import { inSpace } from '@/lib/spaces/shared/spaceUrl'
import type { SearchedSpace } from '@/lib/actions/shared/everywhere'

const TEXT_PAGE_CHARS = 20_000

async function requireResourcesFeature(ctx: ActionCaller, spaceId: string): Promise<void> {
  if (await featureAccessForbidden(ctx.userId, spaceId, 'directory', ctx.email)) {
    throw new ActionError(403, 'Resources are not available to you in this space')
  }
}

/** One resource as a tool reads it: facts and handles, never a link to the bytes. */
function describeResource(view: ResourceView, space?: SearchedSpace) {
  const upload = view.source === 'upload'
  return {
    ...(space ? { space } : {}),
    resource_id: view.id,
    name: view.name,
    kind: view.kind,
    source: view.source,
    mime_type: view.mimeType,
    size_bytes: view.fileSize,
    width: view.width,
    height: view.height,
    page_count: view.pageCount,
    url: view.url,
    provider: view.source === 'link' ? view.provider : null,
    title: view.card?.title ?? null,
    description: view.card?.description ?? null,
    created_at: view.createdAt,
    created_by: view.creator?.name ?? null,
    shared_to_space: view.sharedToSpace,
    shares: view.shares.map((s) => ({
      channel_id: s.channelId,
      channel: s.channelName,
      at: s.at,
      by: s.byName,
      message_href: s.channelId && s.messageId ? messageHref(view.spaceId, s.channelId, s.messageId) : null,
    })),
    node_id: view.nodeId,
    note_path: view.notePath,
    page: view.nodeId ? inSpace(view.spaceId, `/directory/${encodeURIComponent(view.nodeId)}`) : null,
    has_thumbnail: view.thumbUrl !== null,
    // Its text (a PDF's pages, a deck's slides) is read with read_resource.
    readable: view.hasText,
    usable_as_cover: upload && view.kind === 'image',
    usable_as_image: upload && view.kind === 'image',
  }
}

export const RESOURCE_ACTIONS = [
  defineAction({
    name: 'list_resources',
    scope: 'context:read',
    summary:
      'Every file and link in a space — uploads, channel files, links shared in messages, images included — each with a resource_id.',
    description:
      "The space's resources: files uploaded to it or dropped into its channels, and links shared in messages, " +
      'one row per resource however many times it was shared. IMAGES are here, though they carry no text and so ' +
      'never appear in list_files or search_context. Each row reports `resource_id` (the handle other tools ' +
      "take — create_event's cover_resource_id, set_image), where it was shared (`shares`, each with the message " +
      'that carried it), and whether it has text to read (`readable` → read_resource). Only what you can see is ' +
      "listed: a private channel's files reach its members alone. `q` searches names, link titles and the text " +
      'inside files. Download URLs are never returned — a resource is used by id, inside the space.',
    input: {
      space_id: z
        .string()
        .optional()
        .describe('The space to list. Omit to list every space you can act in, each row stamped with its space.'),
      kind: z
        .enum(LIST_KINDS)
        .optional()
        .describe("'image', 'pdf', 'doc', 'sheet', 'slides', 'video', 'audio', 'text', 'code', 'archive', 'link', 'files' (every upload), or 'all' (default)"),
      q: z.string().trim().max(200).optional().describe('Search names, link titles and the text inside files'),
      channel_id: z.string().optional().describe('Only what was shared in this channel'),
      shared_by: z.string().optional().describe("Only what this person added — a user id, or 'me'"),
      since: z.string().optional().describe('ISO date: only what arrived on or after it'),
      sort: z.enum(['recent', 'name', 'size']).optional().describe("Default 'recent'"),
      folder: z.string().optional().describe('Only what is filed in this folder of resources/, by path (`design`, `design/logos`); with q or a filter, anything below it too (needs space_id)'),
      limit: z.number().int().min(1).max(100).optional().describe(`Default ${PAGE_SIZE}`),
      offset: z.number().int().min(0).max(10_000).optional().describe("The previous answer's next_offset, for the next page (needs space_id)"),
    },
    annotations: { readOnlyHint: true },
    run: async (ctx, args) => {
      if (args.folder && !args.space_id) throw new ActionError(400, '`folder` needs a space_id')
      const since = args.since && !Number.isNaN(Date.parse(args.since)) ? new Date(args.since).toISOString() : null
      const limit = args.limit ?? PAGE_SIZE
      const query: ListQuery = {
        kind: args.kind ?? 'all',
        channelId: args.channel_id ?? null,
        by: args.shared_by ?? null,
        q: args.q || null,
        since,
        sort: args.sort ?? 'recent',
        trash: false,
        folder: null,
        offset: args.space_id ? (args.offset ?? 0) : 0,
        limit,
      }
      const { runs, searched, skipped } = await inSpaces(ctx, args.space_id, async (space) => {
        await requireSpaceContext(ctx, space.id)
        await requireResourcesFeature(ctx, space.id)
        const folder = args.folder ? ((await folderFor(space.id, args.folder)) ?? 'resources') : null
        const viewer = await resourceViewer(space.id, ctx.userId, ctx.email)
        const page = await listResources(space.id, viewer, { ...query, folder })
        return { space, page }
      })
      const rows = runs.flatMap((r) => r.result.page.items.map((view) => ({ view, space: r.result.space })))
      if (runs.length > 1) {
        const by = query.sort
        rows.sort((a, b) =>
          by === 'name'
            ? a.view.name.localeCompare(b.view.name)
            : by === 'size'
              ? (b.view.fileSize ?? -1) - (a.view.fileSize ?? -1)
              : b.view.createdAt.localeCompare(a.view.createdAt),
        )
      }
      const chosen = rows.slice(0, limit)
      return {
        spaces: { searched, skipped },
        resources: chosen.map(({ view, space }) => describeResource(view, space)),
        next_offset: args.space_id ? (runs[0]?.result.page.nextOffset ?? null) : null,
      }
    },
  }),
  defineAction({
    name: 'read_resource',
    scope: 'context:read',
    summary: 'One resource in full: its facts, where it was shared, its note, and a page of the text inside it.',
    description:
      'Read one resource by `resource_id` (list_resources and search_context return them): what it is (kind, ' +
      'size, dimensions, pages), where it was shared and by whom, its context note (prose people and agents ' +
      'wrote about it), a link\'s title and description, and a page of the text extracted from a file — a ' +
      "PDF's pages, a deck's slides, a document's words. Long text comes a page at a time: pass the answer's " +
      '`next_offset` back as `offset_chars`. Images carry no text; their note says what they show.',
    input: {
      resource_id: z.string().describe('The resource, from list_resources or search_context'),
      offset_chars: z.number().int().min(0).optional().describe('Where to start reading its text (default 0)'),
      max_chars: z.number().int().min(500).max(50_000).optional().describe(`Default ${TEXT_PAGE_CHARS}`),
    },
    annotations: { readOnlyHint: true },
    run: async (ctx, args) => {
      const gated = await requireVisibleResource(args.resource_id, ctx.userId, ctx.email)
      const { principal, context } = await resolveTarget(ctx, gated.spaceId)
      const view = await loadView(gated.id, gated.viewer)
      if (!view) throw new ActionError(404, 'Not found')
      const facts = describeResource(view)
      const [note, text, external] = await Promise.all([
        facts.note_path ? readFederated(principal, context, facts.note_path) : null,
        view.hasText
          ? readResourceTextAs(principal, gated.spaceId, gated.id, {
              offsetChars: args.offset_chars ?? 0,
              maxChars: args.max_chars ?? TEXT_PAGE_CHARS,
            })
          : null,
        prisma.resource.findUnique({ where: { id: gated.id }, select: { external: true, entitySource: true } }),
      ])
      await logResourceAccess({ resourceId: gated.id, spaceId: gated.spaceId, action: 'read', ...accessOf(ctx) })
      return {
        ...facts,
        space_id: gated.spaceId,
        note,
        text: text
          ? { text: text.text, offset_chars: text.offset, total_chars: text.totalChars, next_offset: text.nextOffset }
          : null,
        // What the provider itself says of a linked file, read as the person who shared it.
        external: external?.external ?? null,
        entity_source: external?.entitySource ?? null,
      }
    },
  }),
  defineAction({
    name: 'share_resource',
    scope: 'messages:write',
    summary: 'Post a resource into a channel, as you, with an optional message.',
    description:
      'Share a file or link the space already holds into a channel: a message is posted AS YOU carrying it, ' +
      "exactly as if you had attached it yourself. You must be able to see the resource and be a member of the " +
      'channel; a resource from a private channel shared into a wider one becomes visible to that channel — ' +
      'which is the point of sharing it, so share only where the person asked. Returns the message and its href.',
    input: {
      resource_id: z.string().describe('The resource, from list_resources'),
      channel_id: z.string().describe('The channel to post into'),
      text: z.string().trim().max(4000).optional().describe('The message to post with it'),
    },
    run: async (ctx, args) => {
      const gated = await requireVisibleResource(args.resource_id, ctx.userId, ctx.email)
      await requireSpaceContext(ctx, gated.spaceId)
      if (await featureAccessForbidden(ctx.userId, gated.spaceId, 'channels', ctx.email)) {
        throw new ActionError(403, 'Channels is switched off in this space')
      }
      const link = gated.source === 'link'
      if (link && !gated.url) throw new ActionError(400, 'This link has no address to share')
      const text = link ? [args.text, gated.url].filter(Boolean).join('\n') : (args.text ?? '')
      const { message, memberIds } = await asMessaging(() =>
        sendMessage(ctx.userId, args.channel_id, link ? { text } : { text, fileIds: [gated.id] }),
      )
      await stampShare(ctx, message.id, gated.id)
      publishToUsers(memberIds, { type: 'message.new', conversationId: args.channel_id, message })
      publishToUsers(memberIds, { type: 'conversation.updated', conversationId: args.channel_id })
      await logResourceAccess({ resourceId: gated.id, spaceId: gated.spaceId, action: 'share', ...accessOf(ctx) })
      return {
        resource_id: gated.id,
        channel_id: args.channel_id,
        message_id: message.id,
        message_href: messageHref(gated.spaceId, args.channel_id, message.id),
      }
    },
  }),
] as const
