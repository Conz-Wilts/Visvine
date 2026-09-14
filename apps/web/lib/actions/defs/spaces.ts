/**
 * Spaces as tenants: starting one, or a sub-space inside one.
 *
 * This is the same act as the switcher's "New space" and the console's "New
 * sub-space" (`POST /api/spaces`), and it goes through the same
 * `provisionSpace` — the one routine that makes a space. The only authority
 * decided here is the route's: anyone signed in may start a space, and only an
 * admin of the parent may put a sub-space under it. Everything else (one level
 * deep, sibling names, public names, the flow-up grant) is provisionSpace's.
 *
 * A space is not a directory record. `add_context` with `type: space` writes a
 * card about an organisation in `spaces/` and provisions nothing; the two
 * manuals say so to each other, because the words are the same.
 */
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { defineAction, ActionError } from '@/lib/actions/types'
import { isAdmin } from '@/lib/auth'
import { provisionSpace } from '@/lib/spaces/provision'

export const SPACE_ACTIONS = [
  defineAction({
    name: 'create_space',
    scope: 'context:write',
    summary:
      'Start a new space — a tenant with its own members, context and tools — or a sub-space inside one you administer.',
    description:
      'Create a SPACE: a tenant of its own, with its own members, admins, context, Drive, connectors and agents. ' +
      'You become its first member and hold its Admin alias. This is what "create a space", "start a workspace" ' +
      'and "make a sub-space" mean.\n' +
      'It is NOT add_context with type "space" — that writes a directory card about an organisation inside an ' +
      'existing space and provisions nothing.\n\n' +
      'A SUB-SPACE: pass `parent_id`. Only an admin of the parent may create one, and the creator — not the ' +
      "parent's admins — administers it. Spaces nest one level: a sub-space cannot hold sub-spaces, and neither a " +
      'personal space nor the Visvine space can hold one. Names must be unique among siblings.\n\n' +
      'VISIBILITY defaults to private. A public space\'s name must be unique among public spaces. A public ' +
      "sub-space's context flows up: its parent reads it, view-only, as the folder `subspaces/<id>/`. A private " +
      "sub-space shows its parent's members only its name.\n\n" +
      'The id is derived from the name (with -2, -3 if taken) and returned as `space_id` — use it as `space_id` ' +
      'in every other action. A new space starts with every toggleable tool OFF; its admins turn them on in the ' +
      'Space Console. Ask for the name and whether it should be public if the person has not said; create ' +
      'nothing speculatively, since a space cannot be deleted through an action.',
    input: {
      name: z.string().trim().min(1).max(120).describe('The space\'s name — also the basis of its id'),
      description: z.string().max(2000).optional().describe('One or two sentences on what the space is for'),
      visibility: z
        .enum(['private', 'public'])
        .optional()
        .describe("'private' (default): invite-only. 'public': listed on Discover and joinable by anyone"),
      parent_id: z
        .string()
        .optional()
        .describe('Make this a sub-space of that space. You must be an admin of it — list_spaces shows `you_manage_it`'),
    },
    run: async (ctx, args) => {
      const parentId = args.parent_id?.trim() || null
      let parentName: string | null = null
      if (parentId) {
        const parent = await prisma.space.findUnique({ where: { id: parentId }, select: { name: true } })
        // Unknown and not-yours read the same, so a guess learns nothing.
        if (!parent || !(await isAdmin(ctx.userId, parentId, ctx.email))) {
          throw new ActionError(403, `Only an admin of the space "${parentId}" can create a sub-space inside it`)
        }
        parentName = parent.name
      }

      const result = await provisionSpace({
        name: args.name,
        description: args.description,
        visibility: args.visibility,
        parentId,
        creator: { id: ctx.userId, name: ctx.name, email: ctx.email },
      })
      if (!result.ok) throw new ActionError(result.status, result.error)

      const s = result.space
      return {
        space_id: s.id,
        name: s.name,
        visibility: s.visibility,
        parent_id: s.parentId,
        ...(parentName ? { parent_name: parentName } : {}),
        you_manage_it: true,
        url: `/spaces/${encodeURIComponent(s.id)}`,
        next:
          'Pass this space_id to any other action. Its tools start off — an admin turns them on in the Space Console.' +
          (s.parentId && s.visibility === 'public'
            ? ` Its context is readable from ${parentName} under subspaces/${s.id}/.`
            : ''),
      }
    },
  }),
] as const
