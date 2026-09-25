/**
 * Files into the Drive, and a Drive image onto an entity.
 *
 * A person attaches an image or a PDF to an AI chat and says "put this in
 * Visvine". The model can see the file but can never reproduce its bytes, so
 * the bytes have to travel some other way, and which way depends on the client:
 *
 * - **A link** — a public URL, or the download link ChatGPT hands a tool for an
 *   attached file (`openai/fileParams` on `upload_file`). The server fetches it,
 *   every hop gated like `fetch_url` (lib/connectors/publicFetch.ts).
 * - **The client's sandbox** — Claude writes an attachment to its code sandbox;
 *   `request_upload` hands back a short-lived PUT URL and the curl line that
 *   sends it. Base64 on `upload_file` serves a coding agent reading a local file.
 * - **The person's device** — the same token's `/drop/<token>` page, where they
 *   drop the file themselves. It works in every client, so it is always offered.
 *
 * Every door lands in `receiveFile` (lib/resources/receive.ts): the same
 * membership and Drive gates as a browser upload, and the same Drive write —
 * stored, indexed, given its Resource node. What comes back is a `resource_id`,
 * the currency `create_event`'s cover and `set_image` take.
 */
import { z } from 'zod'
import { defineAction, ActionError, type ActionCaller } from '@/lib/actions/types'
import { requireSpaceContext } from '@/lib/actions/resolve'
import { MAX_RESOURCE_BYTES, type UploadedFile } from '@/lib/resources/service'
import { receiveFile, requireDriveWriter } from '@/lib/resources/receive'
import { mintUploadToken } from '@/lib/resources/uploadToken'
import { fetchPublicBytes } from '@/lib/connectors/publicFetch'
import { setNodeImageFromResource } from '@/lib/directory/nodeImage'
import { appOrigin } from '@/lib/tools/origin'
import { inSpace } from '@/lib/spaces/shared/spaceUrl'
import { sendMessage } from '@/lib/messages'
import { publishToUsers } from '@/lib/messages/realtime'
import { logResourceAccess } from '@/lib/resources/accessLog'
import { accessOf, asMessaging, folderFor, messageHref, requireChannelIn, stampShare } from '@/lib/actions/resourceUse'

const spaceArg = z.string().describe('The space to act in — list_spaces returns the ids you can act in')

const folderArg = z
  .string()
  .optional()
  .describe('A folder under resources/ to file it in, by path (`design`, `design/logos`) — make one with edit_context on resources/<path>/index.md; omit for the top')

/** Base64 is for small files; anything bigger goes through request_upload. */
const MAX_BASE64_CHARS = Math.ceil((8 * 1024 * 1024 * 4) / 3)

/** What every upload door answers — the handle, and what it can be used for. */
function describeUpload(spaceId: string, file: UploadedFile) {
  return {
    resource_id: file.id,
    name: file.name,
    file_type: file.fileType,
    size_bytes: file.fileSize,
    usable_as_cover: file.fileType === 'image',
    usable_as_image: file.fileType === 'image',
    index_state: file.indexState,
    // Where read_file reads the extracted text of a document, once indexed.
    readable: file.indexState === 'indexed' ? file.sourcePath : null,
    node_id: file.nodeId,
    page: file.nodeId ? inSpace(spaceId, `/directory/${encodeURIComponent(file.nodeId)}`) : null,
  }
}

async function requireWriter(ctx: ActionCaller, spaceId: string): Promise<void> {
  await requireSpaceContext(ctx, spaceId)
  await requireDriveWriter(ctx.userId, spaceId, ctx.email)
}

export const DRIVE_ACTIONS = [
  defineAction({
    name: 'upload_file',
    scope: 'context:write',
    summary: "Put a file — an image, a PDF, a document — into a space's Drive, from a link, a chat attachment or base64.",
    description:
      "Add a file to the space's Drive: stored, made searchable if it has text (a PDF, a document, a " +
      'spreadsheet), and given its own resource page. Returns `resource_id` — pass it to create_event or ' +
      "update_event as `cover_resource_id` to make an image an event's poster, or to set_image to make it a " +
      "person's photo or an organisation's logo.\n" +
      'Give exactly ONE source:\n' +
      '  • `file` — a file the person attached to this chat, when your client passes attachments to tools ' +
      '(ChatGPT does: the argument arrives with a `download_url`).\n' +
      '  • `url` — a public https link to the file (a logo on a website, a PDF someone linked).\n' +
      '  • `content_base64` + `name` — the bytes themselves, for small files (under 8MB) you can read from ' +
      'disk, as a coding agent can.\n' +
      'A file the person attached that you can SEE but cannot pass as `file` (an image or PDF in a Claude chat): ' +
      'call request_upload instead. Never try to write out an image as base64 from what you see — you cannot ' +
      `reproduce its bytes. Files up to ${Math.floor(MAX_RESOURCE_BYTES / 1024 / 1024)}MB.`,
    input: {
      space_id: spaceArg,
      file: z
        .object({
          download_url: z.string().describe('Where the attached file can be downloaded'),
          file_id: z.string().describe("The client's id for the file"),
          mime_type: z.string().nullable().optional().describe("The file's type, when known"),
          file_name: z.string().nullable().optional().describe("The file's name, when known"),
        })
        .optional()
        .describe('A file attached to the chat, as the client hands it to a tool'),
      url: z.string().optional().describe('A public https URL of the file'),
      content_base64: z
        .string()
        .max(MAX_BASE64_CHARS)
        .optional()
        .describe('The file itself, base64-encoded — small files only'),
      name: z
        .string()
        .max(200)
        .optional()
        .describe("The file's name with its extension, e.g. 'launch-poster.png' — what the Drive shows"),
      mime_type: z.string().optional().describe("The file's type, e.g. 'image/png', when you know it"),
      folder: folderArg,
      channel_id: z
        .string()
        .optional()
        .describe(
          "Post it into this channel as you, as if you had attached it there — then it is that channel's " +
            'members\' to see, not the whole space\'s. Needs the messages:write scope. Omit to add it to the space.',
        ),
      message: z.string().trim().max(4000).optional().describe('The message to post with it (with channel_id)'),
    },
    mcpMeta: { 'openai/fileParams': ['file'] },
    run: async (ctx, args) => {
      const sources = [args.file, args.url, args.content_base64].filter((v) => v !== undefined && v !== '')
      if (sources.length !== 1) {
        throw new ActionError(400, 'Give exactly one of file, url or content_base64')
      }
      if (args.message && !args.channel_id) throw new ActionError(400, '`message` goes with a channel_id')
      // Posting in a channel is a second act, under its own scope: the token
      // that may add files to a space may not by that alone speak in it.
      if (args.channel_id && !ctx.scopes.includes('messages:write')) {
        throw new ActionError(403, "Posting into a channel requires the 'messages:write' scope")
      }
      await requireWriter(ctx, args.space_id)
      const folder = await folderFor(args.space_id, args.folder)
      if (args.channel_id) await requireChannelIn(ctx, args.space_id, args.channel_id)

      let bytes: Buffer
      let name = args.name ?? null
      let mimeType = args.mime_type ?? null
      if (args.content_base64) {
        bytes = Buffer.from(args.content_base64.replace(/^data:[^,]*,/, ''), 'base64')
      } else {
        const link = args.file?.download_url ?? args.url!
        const fetched = await fetchPublicBytes(link, MAX_RESOURCE_BYTES)
        if (!fetched.ok) throw new ActionError(400, `Could not fetch the file: ${fetched.error}`)
        bytes = fetched.bytes
        name = name ?? args.file?.file_name ?? fetched.filename
        mimeType = mimeType ?? args.file?.mime_type ?? fetched.contentType
      }

      const file = await receiveFile({
        userId: ctx.userId,
        email: ctx.email,
        spaceId: args.space_id,
        folder,
        name,
        mimeType,
        bytes,
        conversationId: args.channel_id ?? null,
        via: ctx.via === 'agent' ? 'agent' : 'action',
        agentName: ctx.agentName ?? null,
      })
      await logResourceAccess({ resourceId: file.id, spaceId: args.space_id, action: 'upload', ...accessOf(ctx) })
      if (!args.channel_id) return describeUpload(args.space_id, file)
      const channelId = args.channel_id
      const { message, memberIds } = await asMessaging(() =>
        sendMessage(ctx.userId, channelId, { text: args.message ?? '', fileIds: [file.id] }),
      )
      await stampShare(ctx, message.id, file.id)
      publishToUsers(memberIds, { type: 'message.new', conversationId: channelId, message })
      publishToUsers(memberIds, { type: 'conversation.updated', conversationId: channelId })
      return {
        ...describeUpload(args.space_id, file),
        channel_id: channelId,
        message_id: message.id,
        message_href: messageHref(args.space_id, channelId, message.id),
      }
    },
  }),
  defineAction({
    name: 'request_upload',
    scope: 'context:write',
    summary: 'Get a short-lived link that puts files into a space\'s Drive — for a chat attachment you cannot pass directly.',
    description:
      'Mint a 15-minute upload link into the space\'s Drive, for files you can see in the chat but cannot pass ' +
      'to upload_file — an image or PDF the person attached in a Claude chat. It answers two ways to use it:\n' +
      '  • `curl` — if you have a code sandbox and the attachment is a file in it, run this command with the ' +
      "file's path. It PUTs the bytes and prints the new file's `resource_id`. The sandbox may need this " +
      "server's domain allowed for network access; if the command fails on the network, use the page instead.\n" +
      '  • `page` — give the person this link. They drop the file there themselves (it works on a phone).\n' +
      'Then call list_resources to find the new file and its `resource_id`, and use it (cover_resource_id, set_image). ' +
      'The link adds files as YOU, only to this space, and only until it expires.',
    input: {
      space_id: spaceArg,
      folder: folderArg,
    },
    run: async (ctx, args) => {
      await requireWriter(ctx, args.space_id)
      const folder = await folderFor(args.space_id, args.folder)
      const { token, expiresAt } = await mintUploadToken({ userId: ctx.userId, spaceId: args.space_id, folder })
      const origin = appOrigin()
      const uploadUrl = `${origin}/api/uploads/${token}`
      return {
        page: `${origin}/drop/${token}`,
        upload_url: uploadUrl,
        method: 'PUT',
        curl: `curl -sS -X PUT --data-binary @"<path>" -H "X-File-Name: <file name>" "${uploadUrl}"`,
        max_bytes: MAX_RESOURCE_BYTES,
        expires_at: expiresAt.toISOString(),
      }
    },
  }),
  defineAction({
    name: 'set_image',
    scope: 'context:write',
    summary: "Make a Drive image a person's photo, an organisation's logo or a resource's picture.",
    description:
      "Set an entity's picture from an image already in the Drive (list_resources, or the resource_id upload_file " +
      'returned). The image is copied into the entity\'s own picture, so the Drive file can move or go later. ' +
      "For an EVENT use update_event's `cover_resource_id` instead. Any active member of the space may do it, as " +
      'they may edit the entity.',
    input: {
      space_id: spaceArg,
      node_id: z.string().describe("The entity, e.g. 'person:craig-piggott' — search_context and list_context return ids"),
      resource_id: z.string().describe('A Drive image in this space'),
    },
    run: async (ctx, args) => {
      await requireSpaceContext(ctx, args.space_id)
      const { imageUrl } = await setNodeImageFromResource({
        spaceId: args.space_id,
        nodeId: args.node_id,
        resourceId: args.resource_id,
        actor: { id: ctx.userId, name: ctx.name, email: ctx.email },
        via: ctx.via ?? 'api', agentName: ctx.agentName, runId: ctx.runId,
      })
      return {
        node_id: args.node_id,
        image_url: imageUrl,
        page: inSpace(args.space_id, `/directory/${encodeURIComponent(args.node_id)}`),
      }
    },
  }),
] as const
