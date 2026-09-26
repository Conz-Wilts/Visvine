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
import { intakeSummary } from '@/lib/actions/shared/intake'
import { SPACE_DESCRIPTION_MAX_WORDS, descriptionDenial } from '@/lib/spaces/shared/description'
import { isAdmin } from '@/lib/auth'
import { provisionSpace } from '@/lib/spaces/provision'
import { requireSpaceContext } from '@/lib/actions/resolve'
import { mergeNodeType, type MergeNodeTypeResult } from '@/lib/types'
import { addTrackedField, TRACKED_FIELD_KINDS } from '@/lib/directory/table'
import type { NodeTypeConfig } from '@/lib/types'
import { updateSpaceConfig, bustSpaceConfigCache, UnknownSpaceError } from '@/lib/spaces/spaceConfig'

export const SPACE_ACTIONS = [
  defineAction({
    name: 'create_space',
    scope: 'context:write',
    summary:
      'Start a new space — a tenant with its own members, context and tools — or a sub-space inside one you administer.',
    description:
      `BEFORE YOU CALL THIS: ${intakeSummary('space')}\n` +
      'Create a SPACE: a tenant of its own, with its own members, admins, context, Drive, connectors and agents. ' +
      'You become its first member and hold its Admin alias. This is what "create a space", "start a workspace" ' +
      'and "make a sub-space" mean.\n' +
      'It is NOT add_context with type "space" — that writes a directory card about an organisation inside an ' +
      'existing space and provisions nothing.\n\n' +
      'A SUB-SPACE (a room in a house): pass `parent_id`. Only an admin of the parent may create one. Spaces nest ' +
      'one level: a sub-space cannot hold sub-spaces, and neither a personal space nor the Visvine space can hold ' +
      'one. Names must be unique among siblings. A room has four dials, filled by `preset` (department, programme, ' +
      'committee, council, tenant, topic) and overridable one by one: `listing` (secret | house | world — who can ' +
      'see it exists), `house_door` and `world_door` (invite | ask | open — who walks in without an invite; the ' +
      "world's door is never wider than the house's), `flow_context` / `flow_events` (what the " +
      "parent's members read of it, nothing from a secret room; a room's people are its own — the person's page names the family's other records of them), and `parent_admins` (whether the parent's admins " +
      'manage it too — on by default; the room can switch it off later and the parent cannot switch it back).\n\n' +
      'VISIBILITY (top-level spaces) defaults to private. A public space\'s name must be unique among public ' +
      "spaces. For a room, `listing` decides visibility: world is public.\n\n" +
      'The id is derived from the name (with -2, -3 if taken) and returned as `space_id` — use it as `space_id` ' +
      'in every other action. A new space starts with every toggleable tool OFF; its admins turn them on in the ' +
      'Space Console. Create nothing speculatively, since a space cannot be deleted through an action.',
    input: {
      name: z.string().trim().min(1).max(120).describe('The space\'s name — also the basis of its id'),
      description: z
        .string()
        .refine((text) => !descriptionDenial(text), `At most ${SPACE_DESCRIPTION_MAX_WORDS} words`)
        .optional()
        .describe(`One or two sentences on what the space is for, at most ${SPACE_DESCRIPTION_MAX_WORDS} words`),
      visibility: z
        .enum(['private', 'public'])
        .optional()
        .describe("'private' (default): invite-only. 'public': listed on Discover and joinable by anyone"),
      parent_id: z
        .string()
        .optional()
        .describe('Make this a sub-space of that space. You must be an admin of it — list_spaces shows `you_manage_it`'),
      preset: z
        .enum(['department', 'programme', 'committee', 'council', 'tenant', 'topic'])
        .optional()
        .describe('A room preset that fills the dials (sub-spaces only). Default: department'),
      listing: z.enum(['secret', 'house', 'world']).optional().describe('Who can see the room exists (sub-spaces only)'),
      house_door: z.enum(['invite', 'ask', 'open']).optional().describe("The parent's members' door (sub-spaces only)"),
      world_door: z.enum(['invite', 'ask', 'open']).optional().describe("Everyone else's door, only when listing is world"),
      flow_context: z.boolean().optional().describe("Whether the parent's members read the room's context"),
      flow_events: z.boolean().optional().describe("Whether the room's public events show on the parent's calendar"),
      parent_admins: z.boolean().optional().describe("Whether the parent's admins manage the room too (default true)"),
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
        ...(parentId
          ? {
              preset: args.preset,
              listing: args.listing,
              houseDoor: args.house_door,
              worldDoor: args.world_door,
              flowContext: args.flow_context,
              flowEvents: args.flow_events,
              parentAdmins: args.parent_admins,
            }
          : {}),
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
  defineAction({
    name: 'add_type',
    scope: 'context:write',
    summary: "Add a type to a space's vocabulary, so notes can declare it and the directory colours and labels them.",
    description:
      "Add a TYPE to the space's type vocabulary — a name notes declare in their frontmatter (`type: Grant`) so " +
      'they are coloured, labelled and grouped as one kind everywhere. Any active member may add one, as they ' +
      'can add a tag. Adding a name the space already has returns that type unchanged; the first writer\'s ' +
      'colour wins. Built-in kinds (person, space, event, resource…) and platform words are reserved. Pick an ' +
      'existing type from list_context\'s `types` before adding one — a type is only worth adding when several ' +
      'notes will wear it. Then write notes with `type: <Name>` through edit_context. Give it `fields` to give it a ' +
      'shape: each is a frontmatter key its notes carry (minted from the label, `Round` → `round`), shown as a column ' +
      'in the Directory and queryable by list_records and a Tool\'s records.query — a `select` field carries its ' +
      'options. Fields go on a type as it is made; adding them to one that exists is an admin\'s. A name that is ' +
      'already a built-in (Company is the organisation record, `space`) comes back as that type, and the answer says so.',
    input: {
      space_id: z.string().describe('The space to act in — list_spaces returns the ids you can act in'),
      name: z.string().trim().min(1).describe("The type's name, singular, e.g. 'Grant'"),
      color: z.string().optional().describe('A 6-digit hex colour like #3b82f6. Leave it out for a default'),
      fields: z
        .array(
          z.object({
            label: z.string().trim().min(1).max(40).describe('The field\'s name, e.g. "Round" — its key is minted from it'),
            kind: z.enum(TRACKED_FIELD_KINDS.map((k) => k.value) as [string, ...string[]]).describe('text · number · date · select · checkbox · url · email'),
            options: z.array(z.string()).max(50).optional().describe('A select field\'s choices'),
          }),
        )
        .max(20)
        .optional()
        .describe('The fields its notes carry'),
    },
    run: async (ctx, args) => {
      const resolved = await requireSpaceContext(ctx, args.space_id)
      const membership = await prisma.spaceMember.findFirst({
        where: { userId: ctx.userId, spaceId: resolved.spaceId, status: 'active' },
        select: { id: true },
      })
      if (!membership) throw new ActionError(403, 'Only an active member of the space can add a type')

      const wantsFields = (args.fields?.length ?? 0) > 0
      const admin = wantsFields ? await isAdmin(ctx.userId, resolved.spaceId, ctx.email) : false
      let merged: MergeNodeTypeResult | null = null
      let fieldError: string | null = null
      try {
        await updateSpaceConfig(
          resolved.spaceId,
          (stored) => {
            const next = mergeNodeType(stored.nodeTypes, { name: args.name, color: args.color })
            merged = next
            if (!next.ok) return {}
            // Fields shape a type as it is made; on one that exists they are
            // the admin's, as tracked fields always are — and never on a
            // built-in record kind reached through a synonym.
            const shapeable = wantsFields && next.type.scope === 'note' && (next.created || admin)
            if (!shapeable) return next.created ? { nodeTypes: next.types } : {}
            let config: NodeTypeConfig = next.type
            for (const field of args.fields ?? []) {
              if ((config.fields ?? []).some((f) => f.label.toLowerCase() === field.label.toLowerCase())) continue
              const added = addTrackedField(config, { label: field.label, kind: field.kind as never, options: field.options })
              if (!added.ok) {
                fieldError = `${field.label}: ${added.error}`
                return {}
              }
              config = added.config
            }
            const types = next.types.map((t) => (t.name === config.name ? config : t))
            merged = { ...next, types, type: config }
            return { nodeTypes: types }
          },
          { skipRevalidate: true },
        )
      } catch (err) {
        if (err instanceof UnknownSpaceError) throw new ActionError(404, 'Unknown space')
        throw err
      }
      const result = merged as MergeNodeTypeResult | null
      if (!result) throw new ActionError(500, 'The type could not be added')
      if (fieldError) throw new ActionError(400, fieldError)
      if (!result.ok) throw new ActionError(400, result.error)
      const shaped = wantsFields && (result.created || admin) && result.type.scope === 'note'
      if (result.created || shaped) bustSpaceConfigCache()
      const folded = !result.created && result.type.name.toLowerCase() !== args.name.trim().toLowerCase()
      return {
        type: result.type.name,
        color: result.type.color,
        created: result.created,
        fields: (result.type.fields ?? []).map((f) => ({ key: f.key, label: f.label, kind: f.kind, ...(f.options ? { options: f.options } : {}) })),
        ...(folded
          ? { note: `"${args.name}" is the built-in ${result.type.name} type here — build on those records, or name a type for what these are (e.g. "Portfolio company").` }
          : {}),
        ...(wantsFields && !shaped
          ? { fields_skipped: result.type.scope !== 'note' ? 'A built-in type keeps its own fields.' : 'This type already exists — adding fields to it is an admin\'s.' }
          : {}),
      }
    },
  }),
] as const
