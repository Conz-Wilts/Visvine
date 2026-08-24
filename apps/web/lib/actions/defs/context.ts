/**
 * The Visvine context actions — everything the platform can be asked to do with
 * a space's context, its Drive, its events, its connectors and its agents.
 *
 * Each resolves the caller's principal through `resolveTarget` /
 * `requireSpaceContext` and calls the domain layer, so authorization behaves
 * identically for an agent, a mobile client and a browser. They are actions
 * (lib/actions/types.ts), reached through `POST /api/actions/<name>` and through
 * the one `visvine` MCP tool.
 *
 * The `description` on each is the prose of that action's note in the Visvine
 * notes, fetched when someone asks what the action does rather than shipped to
 * every client on connect. Write it for the model that has to act on it.
 */

import { z } from 'zod'
import prisma from '@/lib/prisma'
import {
  listMySpaces,
  resolveTarget,
  requireSpaceContext,
  type ContextScope,
} from '@/lib/actions/resolve'
import {
  searchContext,
  readVisible,
  visibleVault,
  writeGated,
  appendLogGated,
  moveGated,
  listVisibleSources,
  readSourceVisible,
} from '@/lib/notes/contextService'
import { readableRoots, LEVEL_EDIT } from '@/lib/notes/shared/authz'
import { audienceSummary } from '@/lib/notes/shared/audience'
import { loadSpaceAccess, grantAccess, setFolderRestricted } from '@/lib/notes/access'
import { buildTypeCatalog } from '@/lib/mcp/typeCatalog'
import { principalCanWrite, principalLevelName } from '@/lib/notes/shared/permissions'
import type { WriteResult } from '@/lib/notes/shared/contextTypes'
import type { NoteMeta } from '@/lib/notes/shared/types'
import {
  entityFolderPathOf,
  entityNotePath,
  entityNotePaths,
  entityOwnerPathOf,
} from '@/lib/notes/entities'
import { firstExcerpt, readLinkContextMeta } from '@/lib/notes/context/linkReason'
import {
  isStructuralNodeType,
  canonicalNodeType,
  nodeTypeSpellings,
  aliasesForType,
  personAliases,
  findAliasByRef,
  type SpaceAlias,
} from '@/lib/types/context'
import {
  assignNodeAlias,
  createTypeAlias,
  deleteTypeAlias,
  listAliasesByType,
  updateTypeAlias,
} from '@/lib/notes/typeAliases'
import { isIndexPath } from '@/lib/notes/shared/indexNote'
import { lifecycleOf, type NoteLifecycle } from '@/lib/notes/shared/lifecycle'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { readFields } from '@/lib/create/typeFields'
import { createEntity, CREATABLE_TYPES } from '@/lib/directory/createEntity'
import { normalizeImageUrl } from '@/lib/mediaUrl'
import { ConnectorError } from '@/lib/connectors/config'
import {
  describeConnector,
  executeConnectorScript,
  listConnectors,
  loadConnector,
} from '@/lib/connectors/service'
import { setSpaceSecret, storedSecretNames, SECRET_MAX_CHARS } from '@/lib/connectors/secretStore'
import { listFolders } from '@/lib/resources/folders'
import { getEvent, getEventsData } from '@/lib/eventRepo'
import { buildNewEvent } from '@/lib/events/build'
import { createEventRecord, updateEventRecord } from '@/lib/events/write'
import { coverUrlFromResource } from '@/lib/events/cover'
import { isEventManager, EVENT_MANAGER_DENIAL } from '@/lib/eventAuth'
import { eventCreateInputSchema, eventUpdateInputSchema } from '@/lib/schemas/eventSchemas'
import { canTriggerRun, listAgents } from '@/lib/agents/service'
import { claimManualRun } from '@/lib/agents/schedule'
import { featureAccessForbidden } from '@/lib/auth'
import { readNoteOrNull, type Context } from '@/lib/notes/store'
import { runClean, applyCleanFixes, trashNotes } from '@/lib/notes/clean'
import type { CleanRole } from '@/lib/notes/shared/clean'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { SpaceFeatureConfig } from '@/lib/types'
import { defineAction, ActionError, type ActionCaller } from '@/lib/actions/types'

/**
 * Every action that touches a space takes one, and it is always the same thing.
 * Declared once so the contract each action's note advertises says so — an
 * undescribed argument in a catalogue is an argument a caller has to guess at.
 */
const spaceArg = z
  .string()
  .describe('The space to act in — list_spaces returns the ids you can act in')

const scopeArg = z
  .enum(['shared', 'personal'])
  .optional()
  .describe(
    "Which context: 'shared' = the space's context (the default for reads), 'personal' = your own private personal space",
  )

/**
 * How mentions become links. Repeated in the write tools' descriptions because
 * it is the single most important thing an agent has to understand about this
 * model, and a tool description is the only place it will read it.
 *
 * The LEADING SLASH is load-bearing and the reason every tool hands back a
 * ready-made `mention` string: `resolveOkfLink` resolves a relative href from
 * the folder of the note doing the mentioning, so `people/craig.md` written
 * inside `deals/acme.md` resolves to `deals/people/craig.md`, matches no
 * entity, and silently draws no edge. `/people/craig.md` is root-relative and
 * always resolves.
 */
const MENTION_RULE =
  'Links between entities are never created directly — they are a side effect of mentions. ' +
  "A markdown link to an entity's context note inside a SHARED-context note body creates a " +
  '`mentioned` edge between the two entities, e.g. `[Craig Piggott](/people/craig-piggott.md)`. ' +
  'Deleting that link from the text removes the edge on the next write. ' +
  'ALWAYS write the path with a leading slash — it is resolved from the context root, whereas a ' +
  "path without one is resolved from the mentioning note's own folder and will silently link to " +
  'nothing. Every tool that returns an entity also returns a ready-to-paste `mention` string; ' +
  'use it verbatim. Mentions in your personal space do not create edges.'

/**
 * The memory-lifecycle contract, told to the write tools — the frontmatter that
 * keeps a context honest as it ages. Lives in a tool description because that is
 * the only place an agent reads it. The vocabulary itself is
 * lib/notes/shared/lifecycle.ts; clean_context maintains it.
 */
const LIFECYCLE_RULE =
  'MEMORY LIFECYCLE — a note that is no longer true is worse than a missing note, so say so in ' +
  'frontmatter rather than deleting or silently rewriting. `status:` is one of active (default) | ' +
  'proposed | accepted | stale | superseded | deprecated | expired | archived | rejected. When a note ' +
  'REPLACES an earlier one, do not delete the old one: add `supersedes: /old/path.md` to the new note ' +
  'and the next clean pass records the back-pointer and retires the old one, so the history of the ' +
  'decision survives. Add `expires: YYYY-MM-DD` to anything with a known shelf life (a quarterly plan, ' +
  'a temporary workaround) and it retires itself. Add `confidence: certain|likely|speculative` when you ' +
  'are recording something you inferred rather than confirmed. Retired notes still rank in search, below ' +
  'current ones, and their `status` is reported on every hit.'

/**
 * The index-note contract, told to the write tools. Like MENTION_RULE this
 * lives in tool descriptions because that is the only place an agent reads it.
 */
const INDEX_RULE =
  'FOLDERS: every folder IS its index.md — created automatically the moment a note lands in the ' +
  "folder, carrying `title:` (the folder's display name) and a machine-maintained child list between " +
  '`<!-- index:children -->` markers. A folder is a PATH, never a type: NEVER write `type: Index` on ' +
  'anything. An index note\'s `type:` says what the folder is ABOUT — `type: Person` on a person\'s ' +
  'folder, no type at all on a folder that just groups notes. When you add notes to a folder, ENRICH ' +
  "its existing index (prose ABOVE the markers — a description of what the folder holds is what makes " +
  'it findable in search) rather than creating or replacing one. Never hand-write the child list; the ' +
  'markers are refreshed for you on every change in the folder, and a write that drops them is ' +
  'restored. ' +
  'INDEX LAYOUT (fixed, keep it simple): `# <Title>`, then one or two short paragraphs saying what the ' +
  'folder holds and who it is for, then optional grouped `- [Title](/path.md) — one-line note` bullets. ' +
  'NO tables, no columns, no HTML, no nested headings deeper than `##` — a flat list of links reads best ' +
  'in search and costs models the fewest tokens. Every index in a space must look the same. ' +
  'MAKING A FOLDER: write a note INSIDE it. `a/b.md` becomes `a/b/index.md` — the folder\'s home page — ' +
  'the moment you add `a/b/<anything>.md`. That is the only gesture; there is no retype and no ' +
  'separate convert step. ' +
  "ENTITY FOLDERS: the same move on an entity. An entity's note (people/<slug>.md) becomes a folder the " +
  'moment a second note about that entity is needed — write the extra note at people/<slug>/<anything>.md ' +
  'and the entity note moves to people/<slug>/index.md by itself, keeping its entity type and `node:`. ' +
  'Both paths keep resolving to the entity; read_context reports the current one as `note_path` and lists ' +
  "the folder's other notes as `sub_notes`. A sub-note's mentions count as the entity's mentions. " +
  'Never file a note under an entity namespace (people/, communities/, resources/, events/) unless it is ' +
  'about that entity — the write is refused when no entity of that slug exists.'

/**
 * The exact markdown an agent should paste to mention this entity. Exported so
 * tests can prove the string it produces actually resolves back to the entity
 * from a note in any folder — a relative form silently would not.
 */
export function mentionFor(name: string, notePath: string | null): string | null {
  return notePath ? `[${name}](/${notePath})` : null
}

/**
 * Refuse an alias the space has not defined for this type. `Node.alias` is a
 * chip drawn from the type's vocabulary, not free text: a name nothing matches
 * renders as a colourless label and matches no filter, so it is a 400 naming
 * what the type does have.
 */
async function assertAliasExists(spaceId: string, type: string, alias: string): Promise<void> {
  const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { aliases: true } })
  const all = (space?.aliases ?? []) as unknown as SpaceAlias[]
  const available =
    canonicalNodeType(type) === 'person' ? personAliases(all) : aliasesForType(all, type)
  if (available.some((a) => a.name.toLowerCase() === alias.trim().toLowerCase())) return
  throw new ActionError(
    400,
    available.length
      ? `"${alias}" is not a ${type} alias in this space — use one of: ${available.map((a) => a.name).join(', ')}, or create it with manage_alias`
      : `This space has no ${type} aliases — create one with manage_alias, or omit alias`,
  )
}

/** Map an apply-or-deny WriteResult into a clean tool error on denial. */
function unwrapWrite(result: WriteResult): { status: 'applied'; path: string } {
  if (result.status === 'denied') throw new ActionError(403, `Write denied: ${result.reason}`)
  return result
}

const visibilityArg = z
  .enum(['private', 'inherit'])
  .optional()
  .describe(
    "For a NEW shared-context note only: 'private' (the default) restricts it so only space " +
      "admins and you can see it until someone shares it; 'inherit' leaves it visible to whoever " +
      'can see its folder. Ignored for personal-space writes and for edits of existing notes.',
  )

/**
 * Make a freshly created shared note private-by-default: the author gets an
 * explicit EDIT grant FIRST, then the note path is restricted (a restricted
 * boundary on a note path is exactly the app's "Make private"). The order
 * mirrors app/api/notes/access/route.ts — the grant must exist before the cut
 * so a non-admin author never severs their own access. The grant is written
 * even for admins: the bypass makes it redundant today, but the explicit row
 * survives role loss and keeps the access list honest.
 *
 * Note this is the one restrict that a non-admin can still cause, and it is
 * deliberate: privacy on a note you are creating right now is authorship, not
 * administration. Undoing it afterwards is a space-admin action like any other
 * restrict, so an author who wants the note shared again has to ask.
 *
 * Failures are returned,
 * not thrown — the content write already succeeded, so this reports like
 * add_context's note_error rather than failing the whole call. Both mutations
 * audit-log themselves.
 */
async function makeNotePrivate(
  spaceId: string,
  path: string,
  actor: { userId: string; name: string },
): Promise<string | null> {
  try {
    await grantAccess(
      spaceId,
      { subjectType: 'user', subjectId: actor.userId, resourcePath: path, level: LEVEL_EDIT },
      actor,
    )
    await setFolderRestricted(spaceId, path, true, actor)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'Failed to restrict the note'
  }
}

/** Load a connector or throw a 404 that doesn't reveal whether it exists. */
async function requireAgentsFeature(principal: ContextPrincipal, spaceId: string): Promise<void> {
  if (await featureAccessForbidden(principal.userId, spaceId, 'agents', principal.email)) {
    throw new ActionError(403, 'The Agents tool is not available to you in this space')
  }
}

/** The Drive's own gate: a space may switch Resources off, or hold it to admins. */
async function requireDriveFeature(ctx: ActionCaller, spaceId: string): Promise<void> {
  if (await featureAccessForbidden(ctx.userId, spaceId, 'resources', ctx.email)) {
    throw new ActionError(403, 'The Drive is not available to you in this space')
  }
}

/**
 * Validate an event payload through the SAME schema the composer posts to, and
 * turn a rejection into a tool error naming the field. The MCP argument shapes
 * are deliberately looser than the record (a date is `z.string()` here) so that
 * one schema stays the only definition of what a valid event is.
 */
function parseEventInput<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } }, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success || !parsed.data) {
    const issue = parsed.error?.issues[0]
    const where = issue?.path?.length ? `${issue.path.join('.')}: ` : ''
    throw new ActionError(400, `${where}${issue?.message ?? 'Invalid event'}`)
  }
  return parsed.data
}

/** The event, or a 404 that reads the same whether it is absent or elsewhere. */
async function requireEvent(spaceId: string, eventId: string) {
  const event = await getEvent(spaceId, eventId)
  if (!event) throw new ActionError(404, `No event '${eventId}' in this space`)
  return event
}

async function loadConnectorOr404(principal: ContextPrincipal, context: Context, name: string) {
  let loaded
  try {
    loaded = await loadConnector(principal, context, name)
  } catch (e) {
    throw mapConnectorError(e)
  }
  if (!loaded) {
    throw new ActionError(404, `No connector named '${name}' — list_connectors shows what exists`)
  }
  return loaded
}

/** ConnectorError codes → tool-facing statuses. Messages are pre-redacted. */
function mapConnectorError(e: unknown): unknown {
  if (!(e instanceof ConnectorError)) return e
  const status = {
    denied: 403, ssrf: 403, config: 400, missing_secret: 400, timeout: 504, upstream: 502, rate_limited: 429,
  }[e.code]
  return new ActionError(status, e.message)
}

function indexLine(m: NoteMeta): string {
  const desc = m.frontmatter.description
  return desc ? `${m.path} — ${m.title} — ${desc}` : `${m.path} — ${m.title}`
}

const NODE_SELECT = {
  id: true, type: true, name: true, alias: true, subtitle: true, location: true,
  url: true, imageUrl: true, tags: true, metadata: true,
} as const

type NodeRow = {
  id: string; type: string; name: string; alias: string | null; subtitle: string | null
  location: string | null; url: string | null; imageUrl: string | null
  tags: string[]; metadata: unknown
}

/** A node row as entities.ts wants it — metadata typed, so `metadata.notePath`
 *  (set once the note has become an entity folder) steers entityNotePath. */
function nodeLike(row: { id: string; type: string; metadata?: unknown }) {
  return { id: row.id, type: row.type, metadata: (row.metadata as Record<string, unknown> | null) ?? null }
}

/** A node as the tools report it: identity, type-driven fields, note path. */
function describeNode(row: NodeRow) {
  const notePath = entityNotePath(nodeLike(row))
  return {
    node_id: row.id,
    type: row.type,
    name: row.name,
    alias: row.alias,
    subtitle: row.subtitle,
    location: row.location,
    url: row.url,
    image_url: normalizeImageUrl(row.imageUrl),
    tags: row.tags,
    // Read back through the type's field schema so the keys an agent sees are
    // the same keys add_context accepts.
    fields: readFields({
      type: row.type,
      subtitle: row.subtitle,
      location: row.location,
      url: row.url,
      image_url: normalizeImageUrl(row.imageUrl),
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    }),
    note_path: notePath,
    mention: mentionFor(row.name, notePath),
  }
}

/**
 * The parsed memory lifecycle of a note, returned alongside its markdown so a
 * reader is TOLD when what it is holding is no longer current, instead of
 * having to notice a YAML key. Omitted entirely for a plain active note, which
 * is most of them — the field's presence is itself the signal.
 */
function lifecycleBlock(content: string | null): { lifecycle: WireLifecycle } | Record<string, never> {
  if (!content) return {}
  const lc: NoteLifecycle = lifecycleOf(parseFrontmatter(content))
  if (
    lc.status === 'active' &&
    !lc.confidence &&
    lc.expires === null &&
    !lc.supersedes.length &&
    !lc.supersededBy
  ) {
    return {}
  }
  return {
    lifecycle: {
      status: lc.status,
      ...(lc.confidence ? { confidence: lc.confidence } : {}),
      ...(lc.expires !== null ? { expires: new Date(lc.expires).toISOString() } : {}),
      ...(lc.supersedes.length ? { supersedes: lc.supersedes } : {}),
      ...(lc.supersededBy
        ? {
            superseded_by: lc.supersededBy,
            // The single most useful thing to do next: go read the note that
            // replaced this one before acting on anything in it.
            read_instead: { tool: 'read_context', note_path: lc.supersededBy },
          }
        : {}),
    },
  }
}

interface WireLifecycle {
  status: string
  confidence?: string
  expires?: string
  supersedes?: string[]
  superseded_by?: string
  read_instead?: { tool: string; note_path: string }
}

export const CONTEXT_ACTIONS = [
    defineAction({
      name: 'list_spaces',
      scope: 'context:read',
      summary:
        'The spaces you can act in, with your role in each. Every other action needs a space_id.',
      description:
        'List the spaces you can act in, with your role in each and whether it is your own personal space. ' +
        'Start here: every other tool needs a space_id (the wire name for a space id).',
      input: {},
      annotations: { readOnlyHint: true },
      run: async (ctx, _args) => ({
        you: { name: ctx.name, email: ctx.email },
        spaces: await listMySpaces(ctx),
      }),
    }),
    defineAction({
      name: 'list_context',
      scope: 'context:read',
      summary:
        'Bearings in one space: its entities by type, its note index, the folders you can write to, and the node-type catalog.',
      description:
        "Get your bearings in one space: the entities in its directory grouped by type, the index of its " +
        'context notes (path — title — description), and which folders you can write to. Call this before ' +
        'searching or writing so you know what already exists and where it lives. Also returns `you` (who you ' +
        'are here — name, admin status, aliases), `types` (the node-type catalog: which types are enabled, ' +
        'their exact field keys, live usage, and how each is created), and an `audience` line per writable ' +
        'path summarising who can see notes stored there — use these to pick the right type and the right home ' +
        'for what you write.',
      input: {
        space_id: spaceArg,
        scope: scopeArg,
        type: z
          .string()
          .optional()
          .describe("Only entities of this type, e.g. 'person', 'space', 'resource', 'event'"),
        path_prefix: z.string().optional().describe("Only notes under this path, e.g. 'people/'"),
        limit: z.number().int().min(1).max(500).optional().describe('Max entries per list (default 100)'),
      },
      annotations: { readOnlyHint: true },
      run: async (ctx, args) => {
        const scope: ContextScope = args.scope ?? 'shared'
        const { principal, context, resolved } = await resolveTarget(ctx, args.space_id, scope)
        const limit = args.limit ?? 100

        // Notes (visibility lens applied inside visibleVault).
        const { metas } = await visibleVault(principal, context)
        let notes = [...metas].sort((a, b) => a.path.localeCompare(b.path))
        if (args.path_prefix) notes = notes.filter((m) => m.path.startsWith(args.path_prefix!))

        // Grant-derived context — only meaningful for a real space's shared
        // context (personal spaces are never gated, and the personal scope has no
        // directory). One indexed query per piece; the grant table is bounded by
        // alias/folder rows, not by member count, so this stays cheap however
        // large the space is.
        const isGatedShared = scope === 'shared' && resolved !== null && !resolved.isPersonalSpace
        const [space, aliasRows, spaceAccess] = isGatedShared
          ? await Promise.all([
              prisma.space.findUnique({
                where: { id: args.space_id },
                select: { name: true, featureConfig: true, aliases: true },
              }),
              prisma.userAlias.findMany({
                where: { spaceId: args.space_id, userId: ctx.userId },
                select: { aliasId: true },
              }),
              loadSpaceAccess(args.space_id),
            ])
          : [null, [], null]

        // Entities live in the space directory, not in the personal space,
        // so a personal-scope call reports notes only.
        const entitiesByType: Record<string, ReturnType<typeof describeNode>[]> = {}
        let entityTotal = 0
        const usageByType: Record<string, number> = {}
        if (scope === 'shared') {
          const rows = await prisma.node.findMany({
            where: { spaceId: args.space_id },
            select: NODE_SELECT,
            orderBy: { name: 'asc' },
          })
          // Usage counts feed the type catalog and run over the FULL row set,
          // before the structural filter, so Space/Channel/Connector show their
          // live counts even though the directory listing hides them.
          for (const row of rows) {
            const t = canonicalNodeType(row.type)
            usageByType[t] = (usageByType[t] ?? 0) + 1
          }
          // Structural types (section/channel/note/file) describe the
          // container, not the directory — the grid hides them and so do we.
          // Canonicalised both sides: legacy rows still carry retired spellings
          // ('org', 'group'), so a raw string compare silently returns nothing.
          const wanted = args.type ? canonicalNodeType(args.type) : null
          const directory = rows
            .filter((r) => !isStructuralNodeType(r.type))
            .filter((r) => !wanted || canonicalNodeType(r.type) === wanted)
          entityTotal = directory.length
          for (const row of directory.slice(0, limit)) {
            ;(entitiesByType[row.type] ??= []).push(describeNode(row))
          }
        }

        // A grant's resource path can be a single NOTE, not a folder
        // (shared/authz.ts) — reporting those as folders sends an agent off to
        // write files inside a .md path. Split them, and say so.
        const writablePaths = (principal.spaceAdmin ? [''] : readableRoots(principal.access)).filter(
          (path) => principalCanWrite(principal, path),
        )
        // Grants carry alias ids; the audience line names aliases, so it needs
        // this space's id → name map.
        const aliasNames = new Map(
          personAliases(space?.aliases as unknown as SpaceAlias[])
            .filter((a) => a.id)
            .map((a) => [a.id!, a.name]),
        )
        const describeWritable = (path: string) => ({
          path: path || '(context root)',
          your_level: principalLevelName(principal, path),
          // One line, computed from grant rows only — it can name aliases but
          // never individual members, however many grants exist.
          ...(spaceAccess
            ? {
                audience: audienceSummary(path, spaceAccess.grants, spaceAccess.restricted, {
                  selfUserId: ctx.userId,
                  spaceName: space?.name,
                  aliasNames,
                }).line,
              }
            : {}),
        })
        const isNotePath = (path: string) => path.toLowerCase().endsWith('.md')

        return {
          scope,
          you: {
            name: ctx.name,
            admin: principal.spaceAdmin === true,
            // Holder rows carry alias ids; the agent is told names, which is
            // what every other tool takes.
            aliases: aliasRows
              .map((r) => findAliasByRef(space?.aliases as unknown as SpaceAlias[], r.aliasId, 'Person')?.name)
              .filter((n): n is string => Boolean(n)),
          },
          entities: entitiesByType,
          entity_count: entityTotal,
          // The space's node-type vocabulary — closed: pick the best
          // existing type; nobody (agents included) creates new ones.
          ...(isGatedShared
            ? {
                types: buildTypeCatalog({
                  featureConfig: (space?.featureConfig ?? null) as SpaceFeatureConfig | null,
                  isAdmin: principal.spaceAdmin === true,
                  usageByType,
                  creatableTypes: CREATABLE_TYPES,
                  aliases: (space?.aliases ?? []) as unknown as SpaceAlias[],
                }),
              }
            : {}),
          notes: notes.slice(0, limit).map(indexLine),
          note_count: notes.length,
          // Write access inside these can still be cut off deeper down by a
          // restricted subfolder; edit_context tells you if so.
          writable_folders: writablePaths.filter((p) => !isNotePath(p)).map(describeWritable),
          writable_notes: writablePaths.filter(isNotePath).map(describeWritable),
          truncated: entityTotal > limit || notes.length > limit,
        }
      },
    }),
    defineAction({
      name: 'search_context',
      scope: 'context:read',
      summary:
        'Fused search across notes, uploaded files and entities in one space.',
      description:
        "Search one space's context — both halves at once. Notes and uploaded files are ranked by fused " +
        'retrieval (keyword BM25 + semantic vectors + link context); directory entities are matched by name, ' +
        'alias and tag. Every hit carries what you need to open it: node_id for read_context, path for read_context, ' +
        'or path+seq for read_file. Only what you are allowed to read is searched. ' +
        'The `semantic` field reports whether the meaning-based stages ran — "no-key" means these results are ' +
        'keyword-only, so prefer literal terms and try more phrasings. Filters beat ranking: narrow with ' +
        'type/tags/folder/updated_after when you can. ' +
        'A note hit carries `status` when it is NOT current (superseded, expired, stale, deprecated, ' +
        'rejected, archived) — such notes are ranked below current ones but still returned, because the ' +
        'record of what changed is often the answer. Do not act on one as present truth: read its ' +
        '`superseded_by` note first.',
      input: {
        space_id: spaceArg,
        query: z.string().describe('Natural-language or keyword query'),
        scope: scopeArg,
        k: z.number().int().min(1).max(50).optional().describe('Max results per kind (default 10)'),
        type: z.string().optional().describe("Filter notes by frontmatter `type`, entities by node type"),
        tags: z.array(z.string()).optional().describe('Require ALL of these tags (notes)'),
        folder: z
          .string()
          .optional()
          .describe("Only this top-level folder, e.g. 'people' ('' = the context root)"),
        updated_after: z.number().optional().describe('Only notes modified at/after this epoch-ms timestamp'),
        updated_before: z.number().optional().describe('Only notes modified at/before this epoch-ms timestamp'),
      },
      annotations: { readOnlyHint: true },
      run: async (ctx, args) => {
        const scope: ContextScope = args.scope ?? 'shared'
        const { principal, context } = await resolveTarget(ctx, args.space_id, scope)
        const k = args.k ?? 10

        const { hits, semantic } = await searchContext(
          principal,
          context,
          args.query,
          {
            type: args.type,
            tags: args.tags,
            folderId: args.folder,
            updatedAfter: args.updated_after,
            updatedBefore: args.updated_before,
          },
          k,
        )

        const entities =
          scope === 'shared'
            ? (
                await prisma.node.findMany({
                  where: {
                    spaceId: args.space_id,
                    OR: [
                      { name: { contains: args.query, mode: 'insensitive' } },
                      { alias: { contains: args.query, mode: 'insensitive' } },
                      { tags: { has: args.query.toLowerCase() } },
                    ],
                    // Every spelling of the type, so legacy 'org'/'group' rows
                    // are found by a search for either name.
                    ...(args.type ? { type: { in: nodeTypeSpellings(args.type) } } : {}),
                  },
                  select: NODE_SELECT,
                  take: k,
                })
              )
                .filter((r) => !isStructuralNodeType(r.type))
                .map((r) => {
                  const notePath = entityNotePath(nodeLike(r))
                  return {
                    kind: 'entity' as const,
                    node_id: r.id,
                    type: r.type,
                    name: r.name,
                    subtitle: r.subtitle,
                    note_path: notePath,
                    mention: mentionFor(r.name, notePath),
                  }
                })
            : []

        return {
          semantic,
          entities,
          // A source hit is a chunk of an uploaded file: it has no note to read,
          // so it says how to open it (read_file) rather than handing back a
          // path that looks like a note and isn't.
          notes: hits.map((h) => ({
            kind: h.kind,
            path: h.path,
            title: h.title,
            snippet: h.snippet ?? null,
            // Present only when the note is not current — see shared/lifecycle.ts.
            ...(h.status ? { status: h.status } : {}),
            ...(h.kind === 'source'
              ? { seq: h.seq, read_with: { tool: 'read_file', path: h.path } }
              : { read_with: { tool: 'read_context', note_path: h.path } }),
          })),
        }
      },
    }),
    defineAction({
      name: 'read_context',
      scope: 'context:read',
      summary:
        'One entity in full: its fields, its note, what it links to and what mentions it.',
      description:
        'Everything about one entity in one call: its type-driven fields, the full markdown of its context note, ' +
        'the entities it is linked to (with where each link came from), and the notes that mention it. ' +
        'Identify it by node_id or by note_path — search_context and list_context give you both. ' +
        "note_path also accepts the folder form (people/<slug>/index.md) and any sub-note in the entity's " +
        'folder (people/<slug>/<note>.md): a sub-note read returns that note with the entity it belongs to.',
      input: {
        space_id: spaceArg,
        node_id: z.string().optional().describe("The entity's node id, e.g. 'person:craig-piggott'"),
        note_path: z
          .string()
          .optional()
          .describe(
            "The entity's context note path, e.g. 'people/craig-piggott.md' (or 'people/craig-piggott/index.md' " +
              "once it is a folder, or a sub-note 'people/craig-piggott/notes.md')",
          ),
      },
      annotations: { readOnlyHint: true },
      run: async (ctx, args) => {
        if (!args.node_id && !args.note_path) {
          throw new ActionError(400, 'Pass either node_id or note_path')
        }
        const { principal, context } = await resolveTarget(ctx, args.space_id, 'shared')

        // node_id resolves directly; note_path has to go through the node list,
        // because entityNotePath is lossy and only invertible over real nodes.
        // Either path form names the entity; a sub-note names the entity whose
        // folder it sits in (and is the note returned).
        let row: NodeRow | null = null
        let subNotePath: string | null = null
        if (args.node_id) {
          row = await prisma.node.findFirst({
            where: { id: args.node_id, spaceId: args.space_id },
            select: NODE_SELECT,
          })
        } else {
          const all = await prisma.node.findMany({
            where: { spaceId: args.space_id },
            select: NODE_SELECT,
          })
          const wanted = args.note_path!.replace(/^\//, '')
          row = all.find((n) => entityNotePaths(nodeLike(n)).includes(wanted)) ?? null
          const owner = row ? null : entityOwnerPathOf(wanted)
          if (owner) {
            row = all.find((n) => entityFolderPathOf(nodeLike(n)) === owner) ?? null
            if (row) subNotePath = wanted
          }
        }

        // Structural nodes (the space itself, sections, channels, connectors)
        // are not directory entities — list_context and search_context hide
        // them, so resolving one by id here would be the one way in. Their note
        // still reads below as a plain note, via its path.
        let structuralPath: string | null = null
        if (row && isStructuralNodeType(row.type)) {
          structuralPath = entityNotePath(nodeLike(row))
          row = null
        }

        // A note path with no node behind it is still readable — a plain note,
        // or an entity note whose node was removed. Return the note alone
        // rather than a bare "not found".
        if (!row) {
          const path = args.note_path ?? structuralPath
          if (!path) throw new ActionError(404, `No entity '${args.node_id}' in this space`)
          const content = await readVisible(principal, context, path)
          if (!content) throw new ActionError(404, `No accessible note or entity at '${path}'`)
          return {
            entity: null,
            note_path: path,
            note: content,
            ...lifecycleBlock(content),
            links: [],
            mentioned_by: [],
          }
        }

        const notePath = entityNotePath(nodeLike(row))
        const [note, linkRows, { metas }] = await Promise.all([
          notePath ? readVisible(principal, context, subNotePath ?? notePath) : null,
          prisma.link.findMany({
            where: {
              spaceId: args.space_id,
              OR: [{ sourceId: row.id }, { targetId: row.id }],
            },
            select: { sourceId: true, targetId: true, relationship: true, origin: true, originRef: true, metadata: true },
          }),
          visibleVault(principal, context),
        ])
        const otherIds = [...new Set(linkRows.map((l) => (l.sourceId === row!.id ? l.targetId : l.sourceId)))]
        const others = new Map(
          (
            await prisma.node.findMany({
              where: { id: { in: otherIds } },
              select: { id: true, name: true, type: true },
            })
          ).map((n) => [n.id, n]),
        )

        // Both path forms are the entity, so a mention of either counts; the
        // entity's own notes (index + sub-notes) don't "mention" it.
        const selfPaths = new Set(entityNotePaths(nodeLike(row)))
        const folder = entityFolderPathOf(nodeLike(row))
        const isOwn = (p: string) => selfPaths.has(p) || (folder !== null && p.startsWith(`${folder}/`))
        const mentionedBy = notePath
          ? metas
              .filter((m) => !isOwn(m.path) && m.linkTargets.some((t) => selfPaths.has(t)))
              .map((m) => m.path)
              .sort()
          : []
        // The entity folder's other notes (sub-notes), when the note has become one.
        const subNotes =
          folder !== null
            ? metas
                .filter((m) => m.path.startsWith(`${folder}/`) && m.path !== notePath)
                .map((m) => m.path)
                .sort()
            : []

        return {
          entity: describeNode(row),
          note_path: subNotePath ?? notePath,
          ...(subNotePath ? { sub_note_of: notePath, owner_node_id: row.id } : {}),
          sub_notes: subNotes,
          note: note ?? '(no context note yet — edit_context at note_path creates one)',
          ...lifecycleBlock(note),
          links: linkRows.map((l) => {
            const otherId = l.sourceId === row!.id ? l.targetId : l.sourceId
            const other = others.get(otherId)
            // The link-reason payload written by the note-save sync: the prose
            // around the mention, plus the AI phrase when one has been generated.
            const linkContext = readLinkContextMeta(l.metadata)
            return {
              relationship: l.relationship,
              other_node_id: otherId,
              other_name: other?.name ?? otherId,
              other_type: other?.type ?? null,
              // 'context' = derived from a mention in the note at origin_ref, and
              // editable only by editing that note. 'structure'/'event_*' are
              // owned by the app. 'manual' came from the admin API.
              origin: l.origin,
              origin_ref: l.originRef,
              reason: linkContext?.reason ?? null,
              excerpt: firstExcerpt(linkContext),
            }
          }),
          mentioned_by: mentionedBy,
        }
      },
    }),
    defineAction({
      name: 'list_files',
      scope: 'context:read',
      summary:
        'Uploaded files in a space and whether their text has been extracted yet.',
      description:
        'List the uploaded files in this context — PDFs, spreadsheets, documents and the like, which live ' +
        'alongside notes at their own paths and are what search_context returns as `kind: "source"` hits. ' +
        'Each entry reports its extraction status; only `ready` sources are searchable and readable.',
      input: {
        space_id: spaceArg,
        scope: scopeArg,
        folder: z.string().optional().describe("Only sources in this top-level folder ('' = the context root)"),
      },
      annotations: { readOnlyHint: true },
      run: async (ctx, args) => {
        const scope: ContextScope = args.scope ?? 'shared'
        const { principal, context } = await resolveTarget(ctx, args.space_id, scope)
        const sources = await listVisibleSources(principal, context, args.folder)
        return {
          scope,
          sources: sources.map((s) => ({
            path: s.path,
            name: s.name,
            kind: s.kind,
            size_bytes: s.sizeBytes,
            status: s.status,
            error: s.error ?? null,
            // Extraction caps at 500k chars / 300 chunks — a truncated source is
            // searchable but its tail is not there.
            truncated: s.truncated,
            text_chars: s.textChars ?? null,
            chunk_count: s.chunkCount,
          })),
        }
      },
    }),
    defineAction({
      name: 'read_file',
      scope: 'context:read',
      summary:
        'A page of an uploaded file\'s extracted text.',
      description:
        "Read the extracted text of an uploaded file — the other half of a search_context `kind: 'source'` hit, " +
        'whose snippet is one chunk of this. Returns plain text (the original binary is not served here), ' +
        'paged: pass offset_chars to continue where the last call stopped, guided by total_chars.',
      input: {
        space_id: spaceArg,
        path: z.string().describe("The source's path, exactly as search_context or list_files reported it"),
        scope: scopeArg,
        offset_chars: z.number().int().min(0).optional().describe('Start here in the extracted text (default 0)'),
        max_chars: z
          .number()
          .int()
          .min(1)
          .max(100_000)
          .optional()
          .describe('How much to return (default 20000)'),
      },
      annotations: { readOnlyHint: true },
      run: async (ctx, args) => {
        const scope: ContextScope = args.scope ?? 'shared'
        const { principal, context } = await resolveTarget(ctx, args.space_id, scope)
        // A trailing '#<seq>' chunk marker names the same file.
        const path = args.path.replace(/#\d+$/, '')
        const result = await readSourceVisible(principal, context, path, {
          offsetChars: args.offset_chars,
          maxChars: args.max_chars,
        })
        // Absent and inaccessible are deliberately indistinguishable.
        if (!result) throw new ActionError(404, `No accessible source at '${path}'`)
        const offset = args.offset_chars ?? 0
        return {
          path: result.meta.path,
          name: result.meta.name,
          kind: result.meta.kind,
          status: result.meta.status,
          offset_chars: offset,
          returned_chars: result.text.length,
          total_chars: result.totalChars,
          has_more: offset + result.text.length < result.totalChars,
          text: result.text,
        }
      },
    }),
    defineAction({
      name: 'list_drive',
      scope: 'context:read',
      summary:
        'The Drive as things to USE — files and folders including images, each with a resource_id.',
      description:
        "The space's Drive: uploaded files and the folders they sit in — including IMAGES, which carry no text " +
        'and so never appear in list_files or search_context. Each file reports `resource_id` (the handle other ' +
        'tools take), its folder, its type and, for a document, the `readable` path to pass to read_file. ' +
        'This is the surface to open when someone points you at "the files for X": read the plan or brief with ' +
        "read_file, then use the picture with create_event's cover_resource_id. Download URLs are deliberately " +
        'not returned — a file is used by id, inside the space, never by handing out a link to its bytes.',
      input: {
        space_id: spaceArg,
        folder: z
          .string()
          .optional()
          .describe("Only files in this Drive folder, by name (case-insensitive) — omit for the whole Drive"),
        kind: z
          .enum(['all', 'image', 'document'])
          .optional()
          .describe("Narrow to pictures or to text-bearing files (default 'all')"),
        limit: z.number().int().min(1).max(500).optional().describe('Newest first; default 100'),
      },
      annotations: { readOnlyHint: true },
      run: async (ctx, args) => {
        await requireSpaceContext(ctx, args.space_id)
        await requireDriveFeature(ctx, args.space_id)

        const folders = await listFolders(args.space_id)
        const byId = new Map(folders.map((f) => [f.id, f]))
        // A folder's path, walked up through its parents. Depth is bounded by
        // the walk itself so a cycle (which the tree should make impossible)
        // cannot hang the call.
        const pathOf = (id: string | null): string => {
          const parts: string[] = []
          let cursor = id
          for (let i = 0; cursor && i < 16; i++) {
            const folder = byId.get(cursor)
            if (!folder) break
            parts.unshift(folder.name)
            cursor = folder.parentId
          }
          return parts.join('/')
        }

        const wanted = args.folder?.trim().toLowerCase()
        const folderIds = wanted
          ? folders.filter((f) => f.name.toLowerCase() === wanted || pathOf(f.id).toLowerCase() === wanted).map((f) => f.id)
          : null
        if (folderIds && folderIds.length === 0) {
          throw new ActionError(404, `No Drive folder named '${args.folder}'`)
        }

        const limit = args.limit ?? 100
        // Queried here rather than through lib/resources/service#listResources
        // on purpose: that listing signs a download URL per row, and a signed
        // URL is a bearer capability for the bytes. Tools hand out ids.
        const rows = await prisma.resource.findMany({
          where: {
            spaceId: args.space_id,
            ...(folderIds ? { folderId: { in: folderIds } } : {}),
            ...(args.kind === 'image' ? { fileType: 'image' } : {}),
            ...(args.kind === 'document' ? { NOT: { fileType: 'image' } } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: limit + 1,
          select: {
            id: true, name: true, fileType: true, fileSize: true, folderId: true,
            sourcePath: true, indexState: true, indexError: true, createdAt: true,
          },
        })
        const page = rows.slice(0, limit)

        return {
          folders: folders.map((f) => ({ id: f.id, name: f.name, path: pathOf(f.id) })),
          files: page.map((r) => ({
            resource_id: r.id,
            name: r.name,
            file_type: r.fileType,
            folder: pathOf(r.folderId) || null,
            size_bytes: r.fileSize,
            uploaded_at: r.createdAt.toISOString(),
            // Where read_file can read this file's extracted text, when it has any.
            readable: r.indexState === 'indexed' ? r.sourcePath : null,
            index_state: r.indexState,
            index_error: r.indexError,
            usable_as_cover: r.fileType === 'image',
          })),
          truncated: rows.length > limit,
        }
      },
    }),
    defineAction({
      name: 'list_events',
      scope: 'context:read',
      summary:
        'Events in a space with their RSVP counts.',
      description:
        "The space's events, newest start first: id, when and where, status, and how many people are coming. " +
        'The `event_id` here is what update_event takes; `note_path` is the event\'s context note, where its ' +
        'briefing and marketing copy belong. Drafts are included and marked — a draft is visible only to its ' +
        'hosts and admins until it is published.',
      input: {
        space_id: spaceArg,
        when: z.enum(['upcoming', 'past', 'all']).optional().describe("Default 'upcoming'"),
        limit: z.number().int().min(1).max(200).optional().describe('Default 25'),
      },
      annotations: { readOnlyHint: true },
      run: async (ctx, args) => {
        await requireSpaceContext(ctx, args.space_id)
        const { events, attendees } = await getEventsData(args.space_id)
        const when = args.when ?? 'upcoming'
        const now = Date.now()
        const inWindow = (e: (typeof events)[number]) => {
          if (when === 'all') return true
          const at = Date.parse(e.endAt ?? e.startAt)
          if (Number.isNaN(at)) return when === 'upcoming'
          return when === 'upcoming' ? at >= now : at < now
        }
        const chosen = events
          .filter(inWindow)
          .sort((a, b) => (a.startAt < b.startAt ? 1 : -1))
          .slice(0, args.limit ?? 25)

        return {
          events: chosen.map((e) => ({
            event_id: e.id,
            title: e.title,
            start_at: e.startAt,
            end_at: e.endAt ?? null,
            timezone: e.timezone ?? null,
            location: e.location?.label ?? null,
            status: e.status,
            visibility: e.visibility,
            has_cover: !!e.coverImageUrl,
            note_path: entityNotePath({ id: e.id, type: 'event' }),
            public_url: e.visibility === 'public' && e.slug ? `/e/${e.slug}` : null,
            going: attendees.filter((a) => a.eventId === e.id && a.status === 'going').length,
          })),
        }
      },
    }),
    defineAction({
      name: 'add_context',
      scope: 'context:write',
      summary:
        'Create a directory entity — a person, space, resource or event — and its canonical note.',
      description:
        'Create a directory entity — a typed node plus its context note, in one step. Call list_context first: ' +
        'its `types` catalog shows which types this space has enabled, their exact field keys, and live ' +
        'usage — pick the best EXISTING type. You cannot create new types; if none fits, use the closest and ' +
        'suggest a new type in prose. The TYPE decides which fields apply and where the note lives:\n' +
        '  • person   → people/<slug>.md      fields: subtitle (role), email, companyName, linkedinUrl, location, image_url\n' +
        '  • space    → communities/<slug>.md fields: subtitle (tagline), url (website), location, founded, memberCount, image_url\n' +
        '  • resource → resources/<slug>.md   fields: subtitle (description), url\n' +
        'A "space" here is a group, organisation or space — a company, collective or investor. Every space node ' +
        'stands for a real space: pass `space_id_ref` to link one that already runs here (list_spaces shows the ' +
        'ones you can see), otherwise a space is created INSIDE the space you are working in — no members, ' +
        'managed by its admins, visible to its members — and the card is its record. Search first: recording ' +
        '"Canva" twice makes two spaces.\n' +
        'Use exactly these field keys — email, companyName, linkedinUrl and url/website are what match a person or ' +
        'organisation to their identity across spaces, and an unrecognised key is silently dropped. ' +
        'Only these three types are creatable here; an event is made with create_event (it has dates, RSVPs and a page of its own), and channels/sections are admin-only. ' +
        'If the entity already exists you get an error naming it, so open that one instead of creating a duplicate. ' +
        'The new context note is PRIVATE by default — the directory card (name, fields, mention) stays visible ' +
        "to everyone, but the note's content is readable only by space admins and you until someone shares " +
        "it; pass visibility:'inherit' to let it follow its folder's visibility instead. " +
        `${INDEX_RULE}\n` +
        `To connect it to others, write mentions: ${MENTION_RULE}`,
      input: {
        space_id: spaceArg,
        type: z.enum(CREATABLE_TYPES),
        name: z.string().describe('Display name — also the basis of the id and note path'),
        fields: z
          .record(z.string(), z.union([z.string(), z.number()]))
          .optional()
          .describe('Type-specific fields, using exactly the keys listed above'),
        tags: z.array(z.string()).optional(),
        body: z
          .string()
          .optional()
          .describe("Markdown for the context note body (frontmatter is generated for you). Mentions here create links."),
        alias: z
          .string()
          .optional()
          .describe(
            "One of this type's aliases — the chip that narrows what it is here (list_context's " +
              '`types` catalog lists them per type). Must already exist in the space; create one with ' +
              'manage_alias first.',
          ),
        visibility: visibilityArg,
        space_id_ref: z
          .string()
          .optional()
          .describe('type "space" only: the id of an existing space this record stands for. Omit to create one inside `space_id`.'),
      },
      run: async (ctx, args) => {
        const context = await requireSpaceContext(ctx, args.space_id)
        if (args.alias) await assertAliasExists(args.space_id, args.type, args.alias)
        const result = await createEntity(context, {
          type: args.type,
          name: args.name,
          fields: args.fields,
          tags: args.tags,
          body: args.body,
          alias: args.alias,
          spaceRef: args.type === 'space' ? args.space_id_ref ?? null : null,
        })
        if (!result.ok) {
          throw new ActionError(
            result.status,
            result.status === 409 && result.existingNodeId
              ? `${result.error} (node_id: ${result.existingNodeId}, note: ${result.existingPath}) — read it with read_context instead of creating a duplicate`
              : result.error,
          )
        }
        // Private-by-default for the entity's context note. The node row stays
        // in the directory — the card is meant to be findable; only the note
        // BODY is restricted. Skipped in personal spaces (private already) and
        // when the note itself failed to write.
        const wantPrivate =
          !context.isPersonalSpace && args.visibility !== 'inherit' && result.notePath !== null && !result.noteError
        const visibilityError = wantPrivate
          ? await makeNotePrivate(args.space_id, result.notePath!, { userId: ctx.userId, name: ctx.name })
          : null
        return {
          node_id: result.node.id,
          type: result.node.type,
          name: result.node.name,
          note_path: result.notePath,
          // Paste this verbatim into another shared note to link to it.
          mention: mentionFor(result.node.name, result.notePath),
          identity_resolution: result.resolution,
          note_error: result.noteError,
          ...(context.isPersonalSpace
            ? {}
            : {
                visibility: wantPrivate && !visibilityError ? 'private' : 'inherit',
                ...(visibilityError ? { visibility_error: visibilityError } : {}),
              }),
        }
      },
    }),
    defineAction({
      name: 'edit_context',
      scope: 'context:write',
      summary:
        'Write a note at a path, replacing its whole content. This is how connectors, agents and briefs are authored.',
      description:
        'Create or overwrite one context note (full-content write; the previous version is kept in history). ' +
        "Writes go to your PERSONAL space by default — pass scope:'shared' to write the space's shared context, " +
        'which is gated on your write access to that folder. A NEW shared note is PRIVATE by default — only ' +
        "space admins and you can see it — pass visibility:'inherit' to make it visible to whoever can see " +
        'its folder (list_context shows each folder\'s audience). Writes are attributed to the authenticated ' +
        'caller — list_context\'s `you` says who that is here. Read the note first when editing, or you will ' +
        `clobber it; use append_context when you only want to add. ${INDEX_RULE} ${MENTION_RULE} ${LIFECYCLE_RULE}`,
      input: {
        space_id: spaceArg,
        path: z.string().describe("Context-relative path ending in .md, e.g. 'people/craig-piggott.md'"),
        content: z.string().describe('The full markdown content of the note, including frontmatter'),
        scope: scopeArg.describe(
          "Target context — defaults to 'personal'; pass 'shared' explicitly to write the space's shared context",
        ),
        visibility: visibilityArg,
      },
      run: async (ctx, args) => {
        const scope: ContextScope = args.scope ?? 'personal'
        const { principal, context, resolved } = await resolveTarget(ctx, args.space_id, scope)
        // Private-by-default applies only to a note this call CREATES in a real
        // space's shared context — checked before the write, since afterwards
        // the note always exists. Personal spaces are private already.
        const isGatedShared = scope === 'shared' && resolved !== null && !resolved.isPersonalSpace
        const existed = isGatedShared ? (await readNoteOrNull(context, args.path)) !== null : true
        // Stamped as an agent revision so human and agent edits stay
        // distinguishable in the note's history.
        const result = unwrapWrite(
          await writeGated(principal, context, args.path, args.content, 'agent', 'mcp'),
        )
        const wantPrivate = !existed && args.visibility !== 'inherit'
        const visibilityError = wantPrivate
          ? await makeNotePrivate(args.space_id, result.path, { userId: ctx.userId, name: ctx.name })
          : null
        return {
          status: 'applied',
          scope,
          path: result.path,
          // Every shared-context write re-syncs that note's mention set, so the
          // edges it draws are already up to date by the time this returns.
          links_synced: scope === 'shared',
          // Index paths are folders: the store holds them to the index contract
          // (a title, the managed child markers, and an entity's type and
          // `node:` when the folder is one) whatever the write carried.
          ...(entityOwnerPathOf(result.path)
            ? {
                sub_note_of: `${entityOwnerPathOf(result.path)}/index.md`,
                sub_note:
                  "This note sits in an entity folder: it belongs to that entity, and its mentions are the entity's.",
              }
            : {}),
          ...(isIndexPath(result.path)
            ? {
                index_note: true,
                index_contract:
                  "This path is a FOLDER's home page. A `title:` and the <!-- index:children --> block " +
                  'are enforced on it — read the note back if you need the exact stored content. Its ' +
                  '`type:` is what the folder is about (never `Index`). Layout is fixed: H1, short ' +
                  'prose, flat `- [Title](/path.md)` bullets. No tables.',
              }
            : {}),
          ...(isGatedShared
            ? {
                visibility: existed ? 'unchanged' : wantPrivate && !visibilityError ? 'private' : 'inherit',
                ...(wantPrivate && !visibilityError ? { audience: 'you + admins only' } : {}),
                ...(visibilityError ? { visibility_error: visibilityError } : {}),
              }
            : {}),
        }
      },
    }),
    defineAction({
      name: 'append_context',
      scope: 'context:write',
      summary:
        'Append a dated entry to a note\'s ## Log without rewriting the rest of it.',
      description:
        "Append a dated, attributed entry to a note's '## Log' section, creating the section if it is absent. " +
        'The safe way to add one fact to an existing note — nothing else in the note can be lost. The entry is ' +
        "attributed to the authenticated caller (list_context's `you`). " +
        "Defaults to your personal space; pass scope:'shared' for the space's shared context. " +
        `Mentions in the entry create links the same way: ${MENTION_RULE}`,
      input: {
        space_id: spaceArg,
        path: z.string().describe('Path of the existing note to append to'),
        entry: z.string().describe('The entry text — one update. The date and your name are added for you.'),
        scope: scopeArg.describe("Target context — defaults to 'personal'; pass 'shared' for the space's shared context"),
      },
      run: async (ctx, args) => {
        const scope: ContextScope = args.scope ?? 'personal'
        const { principal, context } = await resolveTarget(ctx, args.space_id, scope)
        const result = unwrapWrite(
          await appendLogGated(principal, context, args.path, args.entry, 'agent', 'mcp'),
        )
        return { status: 'applied', scope, path: result.path }
      },
    }),
    defineAction({
      name: 'move_context',
      scope: 'context:write',
      summary:
        'Move or rename a note, rewriting every inbound link to it.',
      description:
        'Move or rename one note. Links pointing AT it are rewritten across the context, so the mentions that ' +
        'make up the graph survive the move — which is why this exists instead of write-then-delete. ' +
        'Needs write access at BOTH the old and the new path. Moving an entity note away from the path its ' +
        'type implies (people/<slug>.md and so on) detaches it from that entity, so do not. Moving a note ' +
        'does NOT carry note-level sharing or restriction with it — a private note becomes governed by its ' +
        'new folder; re-apply sharing after moving if it matters.',
      input: {
        space_id: spaceArg,
        from: z.string().describe('Current path of the note'),
        to: z
          .string()
          .describe(
            'New path, ending in .md. Folders are implicit in the path, so none need creating first; ' +
              'a note already at that path is an error rather than an overwrite.',
          ),
        scope: scopeArg.describe("Target context — defaults to 'personal'; pass 'shared' for the space's shared context"),
      },
      run: async (ctx, args) => {
        const scope: ContextScope = args.scope ?? 'personal'
        const { principal, context } = await resolveTarget(ctx, args.space_id, scope)
        const result = unwrapWrite(await moveGated(principal, context, args.from, args.to, 'agent'))
        return { status: 'applied', scope, from: args.from, path: result.path, links_rewritten: true }
      },
    }),
    defineAction({
      name: 'clean_context',
      scope: 'context:write',
      summary:
        'Analyze a context for problems, then optionally apply the safe fixes or trash what it names.',
      description:
        'Analyze and clean up context, scoped to your role. The default action (analyze) is READ-ONLY: it ' +
        'returns (a) safe mechanical fixes this tool can apply itself — missing frontmatter, uniquely ' +
        'resolvable broken links, unambiguous mention linking, staling of long-untouched notes, retiring notes ' +
        'whose own `expires:` date has passed, and recording the `superseded_by` back-pointer on a note that ' +
        'another note declares it `supersedes:` — and (b) a ' +
        'prioritized worklist of judgment calls for YOU to execute with the ordinary write tools (each item ' +
        'says how). Recommended loop: analyze → apply_fixes → work the worklist with read/edit/append/' +
        "move_context → re-analyze to confirm the counts dropped. Members clean the notes THEY authored; " +
        'space admins clean the whole space (and get a `structure` block — folder sizes, empties, outliers, ' +
        'tag/type mixes — to reason about better organisation); pass `path` to target one folder. ' +
        "mode:'full' adds duplicate detection, CONTRADICTION detection (related notes that assert different " +
        'numbers, dates or opposite claims) and oversized-note flags. A contradiction is not a duplicate: do ' +
        'not merge one away. Establish which note is current and add `supersedes: /<path>` to it, or make the ' +
        'distinction between them explicit in both. Folders frozen for AI are reported ' +
        "but never touched. action:'trash' soft-deletes notes you are allowed to remove (author, admin, or " +
        'edit access; restorable for 7 days) — use it for confirmed duplicates and empties only, AFTER ' +
        'reading them. While cleaning, also normalise any index note whose prose uses tables/columns to the ' +
        `fixed index layout (H1, short prose, flat link bullets). When fixing orphans, remember: ${MENTION_RULE}`,
      input: {
        space_id: spaceArg,
        scope: scopeArg.describe(
          "Which context to clean — defaults to 'shared' (the space's context); 'personal' cleans your own space",
        ),
        action: z
          .enum(['analyze', 'apply_fixes', 'trash'])
          .optional()
          .describe(
            "'analyze' (default, read-only) | 'apply_fixes' (apply the safe allow-list) | 'trash' (soft-delete `paths`)",
          ),
        path: z.string().optional().describe("Target one folder, e.g. 'deals' — omit for your whole scope"),
        mode: z
          .enum(['light', 'full'])
          .optional()
          .describe(
            "'light' (default) | 'full' adds duplicate, contradiction and oversized-note detection (slower)",
          ),
        paths: z
          .array(z.string())
          .max(50)
          .optional()
          .describe("For action:'trash': the note paths to soft-delete (max 50)"),
        limit: z.number().int().min(1).max(100).optional().describe('Max items per worklist category (default 20)'),
      },
      run: async (ctx, args) => {
        const scope: ContextScope = args.scope ?? 'shared'
        const { principal, context, resolved } = await resolveTarget(ctx, args.space_id, scope)
        const role: CleanRole =
          scope === 'personal' || resolved?.isPersonalSpace
            ? 'owner'
            : principal.spaceAdmin
              ? 'admin'
              : 'member'
        const opts = {
          role,
          targetPath: args.path?.replace(/^\/+|\/+$/g, '') || undefined,
          mode: args.mode ?? ('light' as const),
          limit: args.limit ?? 20,
        }
        const action = args.action ?? 'analyze'
        if (action === 'trash') {
          if (!args.paths?.length) throw new ActionError(400, "action:'trash' needs `paths`")
          const results = await trashNotes(principal, context, resolved, args.paths)
          return { action, results, restorable_days: 7 }
        }
        if (action === 'apply_fixes') {
          const result = await applyCleanFixes(principal, context, opts)
          return { action, ...result }
        }
        return { action, scope, ...(await runClean(principal, context, opts)) }
      },
    }),
    defineAction({
      name: 'manage_alias',
      scope: 'context:write',
      summary:
        'Curate a node type\'s alias vocabulary, or assign an alias chip to one entity.',
      description:
        "Curate a node type's ALIASES — the space's own vocabulary for what a thing is: 'Founder' or " +
        "'Investor' on a Person, 'Portfolio' on a Space. An alias is a coloured chip on the directory card " +
        'and a filter, not a tag: it comes from a list the space defines, so tag anything you like but alias ' +
        'only with a name that exists here. list_context\'s `types` catalog shows each type\'s current list; ' +
        'add_context takes one of those names in `alias`.\n' +
        'Actions: create (name + optional #rrggbb colour, defaulting to the type\'s colour), update (rename ' +
        'via new_name and/or recolour — the cards wearing the chip follow the rename), delete (removes the ' +
        'chip from every card of that type), assign (put an existing alias on ONE entity: node_id + name — ' +
        'this is how you alias an entity that already exists; add_context only covers creation), and clear ' +
        "(node_id — take the entity's chip off).\n" +
        'Vocabulary edits (create/update/delete) are space-admin only; assign/clear are open to members, like ' +
        'editing tags. All of it works only in a real space (a personal space has no vocabulary). PERSON aliases are ' +
        'also the permission model — an alias flagged `admin` is what makes its holders admins — so who holds ' +
        'one, and what it reaches, stay in the app; this tool edits the vocabulary itself. The built-in Admin ' +
        "alias cannot be renamed, recoloured or removed, and a change that would leave the space with nobody " +
        'administering it is refused.',
      input: {
        space_id: spaceArg,
        action: z.enum(['list', 'create', 'update', 'delete', 'assign', 'clear']),
        node_type: z
          .string()
          .optional()
          .describe(
            "The type the alias narrows, e.g. 'person', 'space', 'resource'. Required for create/update/delete",
          ),
        name: z.string().optional().describe('The alias name. Required except for list and clear'),
        node_id: z
          .string()
          .optional()
          .describe("assign/clear — the entity wearing the chip, e.g. 'space:canva'"),
        new_name: z.string().optional().describe("action:'update' — rename it to this"),
        color: z.string().optional().describe("#rrggbb chip colour, e.g. '#2563eb'"),
        admin: z
          .boolean()
          .optional()
          .describe(
            "action:'update' on a PERSON alias only — whether holding it means managing the space (admin)",
          ),
      },
      run: async (ctx, args) => {
        const { principal, resolved } = await resolveTarget(ctx, args.space_id, 'shared')
        if (resolved === null || resolved.isPersonalSpace) {
          throw new ActionError(400, 'A personal space has no aliases')
        }
        if (args.action === 'list') {
          return { action: 'list', aliases_by_type: await listAliasesByType(args.space_id) }
        }
        const actor = { userId: ctx.userId, name: ctx.name }
        // Wearing a chip is collaborative card metadata (like tags): any member
        // may assign or clear one; only the vocabulary itself is admin-gated.
        if (args.action === 'assign' || args.action === 'clear') {
          if (!args.node_id) throw new ActionError(400, 'node_id is required')
          if (args.action === 'assign' && !args.name) {
            throw new ActionError(400, "name is required for 'assign' — use 'clear' to remove the chip")
          }
          try {
            const result = await assignNodeAlias(
              args.space_id,
              args.node_id,
              args.action === 'assign' ? args.name! : null,
              actor,
            )
            return { action: args.action, node_id: result.nodeId, alias: result.alias }
          } catch (e) {
            throw new ActionError(400, e instanceof Error ? e.message : 'Alias change refused')
          }
        }
        if (!principal.spaceAdmin) {
          throw new ActionError(403, 'Only a space admin can manage this space\'s aliases')
        }
        if (!args.node_type) throw new ActionError(400, 'node_type is required')
        if (!args.name) throw new ActionError(400, 'name is required')

        try {
          if (args.action === 'create') {
            const alias = await createTypeAlias(
              args.space_id,
              args.node_type,
              args.name,
              args.color,
              actor,
            )
            return { action: args.action, alias }
          }
          if (args.action === 'update') {
            const alias = await updateTypeAlias(
              args.space_id,
              args.node_type,
              args.name,
              { newName: args.new_name, color: args.color, admin: args.admin },
              actor,
            )
            return { action: args.action, alias }
          }
          await deleteTypeAlias(args.space_id, args.node_type, args.name, actor)
          return { action: args.action, deleted: args.name }
        } catch (e) {
          // The alias layer refuses with plain sentences meant for a person —
          // hand them straight back rather than flattening them into a 500.
          throw new ActionError(400, e instanceof Error ? e.message : 'Alias change refused')
        }
      },
    }),
    defineAction({
      name: 'list_connectors',
      scope: 'context:read',
      summary:
        'The connectors a space has, what each reaches, and the docs its note carries.',
      description:
        "List the space's connectors — admin-configured gateways to external APIs, databases and services. " +
        'Each entry carries its docs (what the system is and how to call it), the hosts it may reach, ' +
        'and the env var names its code can read. `actions` lists named entry points (name, description, params) ' +
        'you can run with run_connector by name instead of writing code. Run one with run_connector; a connector with no hosts is ' +
        "documentation-only. Entries with kind 'model' are LLM providers the space's agents run on (their key " +
        "is the space's) — they are listed for context but never runnable. Executing needs the 'connectors:use' scope. " +
        'TO CREATE ONE: a connector is a NOTE at connectors/<name>.md, written with edit_context ' +
        "(scope:'shared', visibility:'inherit'), space admins only — there is no create_connector tool because " +
        'there is nothing to create but the note. Ask the visvine tool with no action for the frontmatter contract and the ' +
        'ordered steps before you write it.',
      input: { space_id: z.string() },
      annotations: { readOnlyHint: true },
      run: async (ctx, args) => {
        const { principal, context } = await resolveTarget(ctx, args.space_id, 'shared')
        return { connectors: await listConnectors(principal, context) }
      },
    }),
    defineAction({
      name: 'run_connector',
      scope: 'connectors:use',
      summary:
        'Run JavaScript, or a declared action, inside the connector isolate against an external system.',
      description:
        "Run a connector (see list_connectors; the connector's docs say what calls make sense) — either one of " +
        'its named `actions` with `args`, or JavaScript you write in `code` (exactly one of the two). Code is the ' +
        'body of an async function: `return` the answer — top-level await works. ' +
        'Available: `fetch(url, init)` which resolves to {status, ok, headers, body, truncated, hops} with body as a ' +
        'STRING (call JSON.parse yourself, there is no .json()); redirects are not followed unless init.follow (1..3) ' +
        'is set, and every hop is re-checked against the perimeter; `sql(dsn, query)` for read-only Postgres/MySQL; ' +
        '`mcp(url).listTools()` / `mcp(url).callTool(name, args)`; `sleep(ms)` for backing off a 429 (bounded ' +
        "by the run deadline); `env` holding the connector's secrets; `console.log`; " +
        '`visvine.crypto.{hmac(alg,key,data,{keyEncoding?,encoding?}), hash(alg,data), randomHex(n), ' +
        'base64.encode/decode, timingSafeEqual(a,b), sigv4({accessKeyEnv, secretEnv, sessionTokenEnv?, region, service, ' +
        'method, url, headers?, body?}) → {headers}}` for request signing (sigv4 reads the AWS keys from env by NAME); and ' +
        "`visvine.state.get(key)` / `visvine.state.set(key, value)` — the connector's memory between runs (64KB a value, " +
        '100 keys; set null to clear). Action code additionally sees `args`, frozen. There is no filesystem, no process, ' +
        'no require/import, and no network beyond the hosts ' +
        "the connector declares — a refused call throws with the reason. Use secrets by name (e.g. " +
        '`{ Authorization: `Bearer ${env.API_KEY}` }`), never ask for or supply credential values; they are ' +
        'redacted from everything that comes back. Output is capped at 256KB; each space has a per-minute run budget (429).',
      input: {
        space_id: spaceArg,
        connector: z.string().describe("The connector's name, e.g. 'stripe' for connectors/stripe.md"),
        code: z
          .string()
          .optional()
          .describe(
            'JavaScript to evaluate, e.g. `const r = await fetch("https://api.stripe.com/v1/customers", ' +
              '{ headers: { Authorization: `Bearer ${env.STRIPE_KEY}` } }); return JSON.parse(r.body)`. Omit when passing action.',
          ),
        action: z.string().optional().describe("One of the connector's declared actions (see list_connectors). Omit when passing code."),
        args: z.record(z.string(), z.unknown()).optional().describe('Arguments for the action, per its params'),
      },
      run: async (ctx, args) => {
        const { principal, context } = await resolveTarget(ctx, args.space_id, 'shared')
        const hasCode = typeof args.code === 'string' && args.code.trim().length > 0
        const hasAction = typeof args.action === 'string' && args.action.trim().length > 0
        if (hasCode === hasAction) {
          throw new ActionError(400, 'Pass exactly one of `code` (JavaScript) or `action` (a declared action name, with `args`)')
        }
        const loaded = await loadConnectorOr404(principal, context, args.connector)
        try {
          const result = await executeConnectorScript(
            principal,
            context,
            args.space_id,
            loaded,
            hasAction ? { action: args.action!.trim(), args: args.args ?? {} } : { code: args.code! },
          )
          return {
            ok: result.ok,
            value: result.value,
            logs: result.logs,
            error: result.error,
            truncated: result.truncated,
            timed_out: result.timedOut,
            // Why a call failed when the perimeter refused it. The thrown error
            // says the same thing, but a run can swallow it in a catch.
            denials: result.denials,
            duration_ms: result.durationMs,
            ...(loaded.warnings.length > 0 ? { warnings: loaded.warnings } : {}),
          }
        } catch (e) {
          throw mapConnectorError(e)
        }
      },
    }),
    defineAction({
      name: 'set_connector_secret',
      scope: 'secrets:write',
      summary:
        'Store a credential a connector note references. Write-only, admins only.',
      description:
        'Store the value of a credential a connector note references as `{{secret:NAME}}` — the step between ' +
        'writing the note and running it. SPACE ADMINS ONLY. `name` must be a secret the named connector ' +
        'already references (see list_connectors `secrets`); you cannot introduce a new one here, only fill in ' +
        'a blank the note declared. The value is encrypted at rest and is WRITE-ONLY: nothing — no tool, no ' +
        'admin, no page — can read it back, so record it wherever you keep credentials before storing it. ' +
        'Setting an existing secret is refused unless overwrite:true, because the old value cannot be shown to ' +
        'you for comparison. Returns which of the connector\'s secrets are still unset, so you know when it is ' +
        'ready for run_connector. NEVER write the value into the note itself, and do not echo it back to the ' +
        'user afterwards.',
      input: {
        space_id: spaceArg,
        connector: z.string().describe("The connector whose secret this is, e.g. 'stripe' for connectors/stripe.md"),
        name: z
          .string()
          .describe("The secret NAME as the note references it, e.g. 'STRIPE_KEY' for {{secret:STRIPE_KEY}}"),
        value: z
          .string()
          .min(1)
          .max(SECRET_MAX_CHARS)
          .describe('The credential itself. Stored encrypted; never returned by anything.'),
        overwrite: z
          .boolean()
          .optional()
          .describe('Replace an existing value (a rotation). Defaults to false, which refuses rather than clobbers.'),
      },
      annotations: { destructiveHint: true },
      run: async (ctx, args) => {
        const { principal, context, resolved } = await resolveTarget(ctx, args.space_id, 'shared')
        if (!resolved?.isAdmin) {
          throw new ActionError(403, "Only a space admin can store this space's connector secrets")
        }
        const connector = await describeConnector(principal, context, args.connector)
        if (!connector) throw new ActionError(404, `No connector named '${args.connector}' in this space`)
        if (connector.invalid) {
          throw new ActionError(
            400,
            `connectors/${connector.name}.md does not parse, so its secret references cannot be trusted: ${connector.invalid}`,
          )
        }

        const name = args.name.trim()
        if (!connector.secrets.includes(name)) {
          throw new ActionError(
            400,
            connector.secrets.length === 0
              ? `${connector.name} references no secrets. Add \`{{secret:${name}}}\` to its \`env:\` first, then store the value.`
              : `${connector.name} does not reference '${name}'. It references: ${connector.secrets.join(', ')}. ` +
                'Fix the note if the name is wrong — the note decides which secrets may exist.',
          )
        }

        const result = await setSpaceSecret(
          args.space_id,
          { userId: ctx.userId, name: ctx.name || ctx.email, email: ctx.email },
          { name, value: args.value, overwrite: args.overwrite === true },
        )
        if (!result.ok) throw new ActionError(result.code === 'already_set' ? 409 : 400, result.error)

        const stored = await storedSecretNames(args.space_id, connector.secrets)
        const missing = connector.secrets.filter((s) => !stored.has(s))
        return {
          stored: result.name,
          rotated: result.rotated,
          connector: connector.name,
          secrets_missing: missing,
          ready_to_run: missing.length === 0,
          note:
            missing.length === 0
              ? `${connector.name} has every secret it references. Probe it with run_connector.`
              : `Still unset: ${missing.join(', ')}. run_connector will fail with missing_secret until they are stored.`,
        }
      },
    }),
    defineAction({
      name: 'create_event',
      scope: 'context:write',
      summary:
        'Create an event: the record, its public page, its RSVP list and its context note.',
      description:
        'Create an event in this space — the record, its page, its RSVP form and its context note at ' +
        'events/<slug>.md, in one call. This is the step that turns material already in the space into ' +
        'something people can turn up to.\n' +
        'The intended shape of the job: list_drive to see what the space has, read_file the run sheet or plan, ' +
        'create_event with the picture as `cover_resource_id`, then write the marketing copy as a sub-note of ' +
        "the event — edit_context, scope:'shared', path 'events/<slug>/marketing.md' — so the copy sits with " +
        'the event rather than in a chat log. Mentions there link it to the people and organisations involved.\n' +
        'It is created as a DRAFT unless you pass status:"published": publishing is what makes it visible to ' +
        'the space (or to the world, at visibility:"public"), and that stays a decision someone takes ' +
        'deliberately. You become a host, so you can edit it afterwards with update_event.',
      input: {
        space_id: spaceArg,
        title: z.string(),
        start_at: z.string().describe('ISO 8601 instant, e.g. 2026-09-14T18:00:00.000Z'),
        end_at: z.string().optional().describe('ISO 8601 instant'),
        timezone: z.string().optional().describe("IANA zone the event is read in, e.g. 'Pacific/Auckland'"),
        description: z.string().optional().describe('The summary shown on the event card and page'),
        location: z
          .object({ label: z.string(), address: z.string().optional() })
          .optional()
          .describe('Where it happens — label is what people read'),
        capacity: z.number().int().positive().optional().describe('Adds a waitlist once it is full'),
        visibility: z
          .enum(['public', 'space', 'private'])
          .optional()
          .describe("Who can see it once published — default 'space'"),
        status: z.enum(['draft', 'published']).optional().describe("Default 'draft'"),
        cover_resource_id: z
          .string()
          .optional()
          .describe("A Drive image (list_drive, usable_as_cover: true) to use as the event's poster"),
        hosts: z
          .array(z.string())
          .optional()
          .describe("Person node ids who can manage it, e.g. 'person:craig-piggott'. You are added regardless."),
      },
      run: async (ctx, args) => {
        // Membership of the space is the gate, exactly as it is in the composer:
        // any member may create an event.
        await requireSpaceContext(ctx, args.space_id)

        const input = parseEventInput<import('@/lib/schemas/eventSchemas').EventCreateInput>(eventCreateInputSchema, {
          spaceId: args.space_id,
          title: args.title,
          startAt: args.start_at,
          endAt: args.end_at,
          timezone: args.timezone,
          description: args.description,
          location: args.location,
          capacity: args.capacity,
          visibility: args.visibility ?? 'space',
          status: args.status ?? 'draft',
          hosts: args.hosts ?? [],
        })

        // The cover is minted against the id the record will get, so the bytes
        // and the row cannot disagree about which event they belong to.
        const eventId = buildNewEvent(input, { personId: ctx.personId }).id
        const coverImageUrl = args.cover_resource_id
          ? await coverUrlFromResource({
              spaceId: args.space_id,
              eventId,
              resourceId: args.cover_resource_id,
            })
          : undefined

        const event = await createEventRecord({ ...input, id: eventId, coverImageUrl }, { personId: ctx.personId })
        const notePath = entityNotePath({ id: event.id, type: 'event' })
        return {
          event_id: event.id,
          title: event.title,
          status: event.status,
          visibility: event.visibility,
          start_at: event.startAt,
          note_path: notePath,
          cover_image_set: !!event.coverImageUrl,
          public_url: event.visibility === 'public' ? `/e/${event.slug}` : null,
          next: notePath
            ? `Write the marketing copy as a sub-note: edit_context path '${notePath.replace(/\.md$/, '')}/marketing.md', scope 'shared'.`
            : null,
          ...(event.status === 'draft'
            ? { publish_with: "update_event with status:'published' — nobody else can see a draft" }
            : {}),
        }
      },
    }),
    defineAction({
      name: 'update_event',
      scope: 'context:write',
      summary:
        'Edit an event, or publish a draft. Hosts and space admins only.',
      description:
        'Edit an event that already exists — publish a draft, move the date, add the poster, change the venue. ' +
        'Only the fields you pass are touched. A Drive image can be attached at any time with ' +
        '`cover_resource_id`. Hosts and space admins only (list_events shows what is there).',
      input: {
        space_id: spaceArg,
        event_id: z.string().describe("The event's id, e.g. 'event:launch-night-20260914'"),
        title: z.string().optional(),
        start_at: z.string().optional().describe('ISO 8601 instant'),
        end_at: z.string().optional().describe('ISO 8601 instant'),
        timezone: z.string().optional(),
        description: z.string().optional(),
        location: z.object({ label: z.string(), address: z.string().optional() }).optional(),
        capacity: z.number().int().positive().optional(),
        visibility: z.enum(['public', 'space', 'private']).optional(),
        status: z.enum(['draft', 'published']).optional(),
        cover_resource_id: z.string().optional().describe('A Drive image to use as the poster (list_drive)'),
        hosts: z.array(z.string()).optional().describe('Replaces the host list — include the existing hosts to keep them'),
      },
      run: async (ctx, args) => {
        await requireSpaceContext(ctx, args.space_id)
        const existing = await requireEvent(args.space_id, args.event_id)
        if (!(await isEventManager(ctx, args.space_id, existing))) {
          throw new ActionError(403, EVENT_MANAGER_DENIAL)
        }

        const coverImageUrl = args.cover_resource_id
          ? await coverUrlFromResource({
              spaceId: args.space_id,
              eventId: existing.id,
              resourceId: args.cover_resource_id,
            })
          : undefined

        const updates = parseEventInput<import('@/lib/schemas/eventSchemas').EventUpdateInput>(eventUpdateInputSchema, {
          ...(args.title === undefined ? {} : { title: args.title }),
          ...(args.start_at === undefined ? {} : { startAt: args.start_at }),
          ...(args.end_at === undefined ? {} : { endAt: args.end_at }),
          ...(args.timezone === undefined ? {} : { timezone: args.timezone }),
          ...(args.description === undefined ? {} : { description: args.description }),
          ...(args.location === undefined ? {} : { location: args.location }),
          ...(args.capacity === undefined ? {} : { capacity: args.capacity }),
          ...(args.visibility === undefined ? {} : { visibility: args.visibility }),
          ...(args.status === undefined ? {} : { status: args.status }),
          ...(args.hosts === undefined ? {} : { hosts: args.hosts }),
          ...(coverImageUrl === undefined ? {} : { coverImageUrl }),
        })

        const event = await updateEventRecord(args.space_id, existing, updates)
        return {
          event_id: event.id,
          title: event.title,
          status: event.status,
          visibility: event.visibility,
          start_at: event.startAt,
          cover_image_set: !!event.coverImageUrl,
          note_path: entityNotePath({ id: event.id, type: 'event' }),
          public_url: event.visibility === 'public' ? `/e/${event.slug}` : null,
        }
      },
    }),
    defineAction({
      name: 'list_agents',
      scope: 'context:read',
      summary:
        'The agent roster in a space with each one’s schedule and last run.',
      description:
        "List the space's scheduled agents: name, brief summary, model, declared connectors, whether it is active, " +
        'its schedule, next run and last run outcome. Spend is not included (admins see it in the app). ' +
        "Trigger one with run_agent (needs the 'agents:run' scope; the agent must be active). " +
        'AUTHORING IS CLOSED TO YOU: an agent is a brief at agents/<name>.md plus an admin activation at ' +
        'agents/live/<name>.md, and agents/ is structurally frozen against AI writes — edit_context there is ' +
        'refused whatever your permissions. Draft the brief and hand it to a human. The create_agent recipe has the ' +
        'brief contract and the hand-off steps.',
      input: { space_id: z.string() },
      annotations: { readOnlyHint: true },
      run: async (ctx, args) => {
        const { principal, context } = await resolveTarget(ctx, args.space_id, 'shared')
        await requireAgentsFeature(principal, args.space_id)
        const { agents, heartbeatAt } = await listAgents(principal, context)
        return {
          scheduler_last_tick_at: heartbeatAt,
          agents: agents.map((a) => ({
            name: a.name,
            title: a.title,
            description: a.description,
            model: a.model,
            connectors: a.connectors,
            tools: a.tools,
            invalid: a.invalid ?? a.activation.invalid,
            active: a.activation.active,
            schedule: a.activation.scheduleLabel,
            every: a.activation.every,
            triggers: a.activation.triggersLabel,
            state: a.rowState,
            next_run_at: a.state.nextRunAt,
            last_run: a.lastRun
              ? { status: a.lastRun.status, reason: a.lastRun.terminalReason, started_at: a.lastRun.startedAt, summary: a.lastRun.summary }
              : null,
            brief_path: a.path,
          })),
        }
      },
    }),
    defineAction({
      name: 'run_agent',
      scope: 'agents:run',
      summary:
        'Trigger an agent run now.',
      description:
        "Trigger a run of an ACTIVE agent now (see list_agents). Only the agent's author or a space admin may; an inactive " +
        'agent is refused — activation is the review point. Shares the scheduler\'s claim path so it cannot double-fire, and ' +
        "does not advance the schedule. Returns the run id and, when the run completes within this call, its outcome.",
      input: {
        space_id: spaceArg,
        agent: z.string().describe("The agent's name, e.g. 'weekly-digest' for agents/weekly-digest.md"),
      },
      run: async (ctx, args) => {
        const { principal } = await resolveTarget(ctx, args.space_id, 'shared')
        await requireAgentsFeature(principal, args.space_id)
        if (!(await canTriggerRun(principal, args.space_id, args.agent))) {
          throw new ActionError(403, "Only the agent's author or a space admin can run it")
        }
        const claimed = await claimManualRun(args.space_id, args.agent, principal.userId)
        if (!claimed.ok) throw new ActionError(claimed.code === 'unknown' ? 404 : 409, claimed.message)
        const result = await claimed.dispatch
        return {
          run_id: claimed.runId,
          outcome: result?.ok ? result.outcome : null,
          error: result && !result.ok ? result.error : null,
        }
      },
    }),
]
