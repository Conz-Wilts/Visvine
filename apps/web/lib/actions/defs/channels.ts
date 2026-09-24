/**
 * Channels and the sections that group them.
 *
 * The same acts as `POST /api/messages/conversations/channel` and
 * `POST /api/messages/sections`, asked in the same order: the Channels tool
 * before the permission, and the permission is the space's admin. Both write a
 * context note (`channels/<slug>/index.md`, `sections/<slug>/index.md`), which
 * is why a space with Channels off is refused rather than handed a namespace
 * for a tool it does not run.
 */
import { z } from 'zod'
import { defineAction, ActionError } from '@/lib/actions/types'
import { featureAccessForbidden, isAdmin } from '@/lib/auth'
import { createChannelConversation, createChannelSection } from '@/lib/messages'
import { MessagingError } from '@/lib/messages/core'
import { ICON_NAMES } from '@/lib/icons/names'
import { inSpace } from '@/lib/spaces/shared/spaceUrl'
import type { ActionCaller } from '@/lib/actions/types'

const spaceArg = z.string().describe('The space to act in — list_spaces returns the ids you can act in')

const iconArg = z
  .string()
  .refine((name) => (ICON_NAMES as readonly string[]).includes(name), 'Not an icon name Visvine has')
  .optional()
  .describe("The name of one of Visvine's icons, e.g. 'megaphone' — never an emoji. Leave it out for the default")

async function requireChannelsAdmin(ctx: ActionCaller, spaceId: string, what: string): Promise<void> {
  if (await featureAccessForbidden(ctx.userId, spaceId, 'channels', ctx.email)) {
    throw new ActionError(403, 'Channels is switched off in this space — an admin turns it on in the Space Console')
  }
  if (!(await isAdmin(ctx.userId, spaceId, ctx.email))) {
    throw new ActionError(403, `Only space admins can create ${what}`)
  }
}

/** The service speaks MessagingError; the doors speak ActionError. */
async function asAction<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (err) {
    if (err instanceof MessagingError) throw new ActionError(err.status, err.message)
    throw err
  }
}

export const CHANNEL_ACTIONS = [
  defineAction({
    name: 'create_channel',
    scope: 'context:write',
    summary: 'Create a channel in a space — a chat thread, or a feed of posts — with its context note.',
    description:
      'Create a CHANNEL: a conversation every member of the space can join, and its context note at ' +
      'channels/<slug>/index.md. `private: true` makes it invite-only and unlisted: only its members see it, ' +
      'its note and the files shared in it, and a member adds a member. `view_mode` FEED makes it a stream of ' +
      'posts with comments (what the Feed shows); CHAT (default) is a classic thread. File it under a section ' +
      'with `section_id` (create_section makes one). Space admins only, and only in a space with the Channels ' +
      'tool on. Ask for the name, whether it is a chat or a feed, and whether it is private if the person has ' +
      'not said.',
    input: {
      space_id: spaceArg,
      name: z.string().trim().min(1).max(80).describe("The channel's name, e.g. 'launch-night'"),
      description: z.string().trim().max(500).optional().describe('One line on what the channel is for'),
      view_mode: z.enum(['CHAT', 'FEED']).optional().describe("'CHAT' (default) or 'FEED'"),
      private: z.boolean().optional().describe('True for an invite-only channel only its members can see'),
      section_id: z.string().min(1).optional().describe('A section to file it under'),
      icon: iconArg,
      context: z.string().trim().max(5000).optional().describe("Starting text for the channel's context note"),
    },
    run: async (ctx, args) => {
      await requireChannelsAdmin(ctx, args.space_id, 'channels')
      const channel = await asAction(() =>
        createChannelConversation(
          ctx.userId,
          args.space_id,
          args.name,
          args.description,
          args.icon,
          args.section_id,
          args.view_mode,
          args.context,
          args.private ? 'PRIVATE' : 'PUBLIC',
        ),
      )
      return {
        channel_id: channel.id,
        name: channel.name,
        private: channel.visibility === 'PRIVATE',
        view_mode: channel.viewMode ?? 'CHAT',
        section_id: channel.sectionId ?? null,
        href: inSpace(args.space_id, `/channels/${encodeURIComponent(channel.id)}`),
      }
    },
  }),
  defineAction({
    name: 'create_section',
    scope: 'context:write',
    summary: "Create a section in a space's channel list, to group channels under a heading.",
    description:
      "Create a SECTION: a heading in the space's channel list that channels are filed under, and its context " +
      'note at sections/<slug>/index.md. Pass the returned `section_id` to create_channel. Space admins only, ' +
      'and only in a space with the Channels tool on.',
    input: {
      space_id: spaceArg,
      name: z.string().trim().min(1).max(80).describe("The section's heading, e.g. 'Programmes'"),
      icon: iconArg,
      context: z.string().trim().max(5000).optional().describe("Starting text for the section's context note"),
    },
    run: async (ctx, args) => {
      await requireChannelsAdmin(ctx, args.space_id, 'sections')
      const section = await asAction(() =>
        createChannelSection(args.space_id, args.name, args.icon, args.context, ctx.userId),
      )
      return { section_id: section.id, name: section.name }
    },
  }),
] as const
