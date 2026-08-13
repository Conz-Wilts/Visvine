/**
 * The MCP tool surface: thirteen tools over the context layer.
 *
 *   read     list_spaces, list_context, search_context, read_context,
 *            list_files, read_file
 *   write    add_context, edit_context, append_context, move_context
 *   maintain clean_context
 *   connect  list_connectors, run_connector
 *
 * The shape of this surface follows the shape of the model, deliberately:
 *
 *   • An entity is a typed Node PLUS one canonical context note at a
 *     deterministic path (person:craig → people/craig.md).
 *   • The TYPE decides what you can create and which fields it has.
 *   • Links are DERIVED, not authored. A markdown link to an entity's note,
 *     inside another shared-brain note, is what creates a `mentioned` edge —
 *     so there is no create_link tool, because there is no such operation.
 *
 * Tools call the domain layer directly (brainService / store / createEntity)
 * rather than the app's own HTTP routes. Authorization is never re-implemented:
 * lib/mcp/context.ts resolves the brain through `resolveBrain`/`principalOf`,
 * the same functions the web routes use, and every read goes through the
 * visibility lens while every write goes through the folder gate.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { withCtx, McpError } from '@/lib/mcp/auth'
import {
  listMySpaces,
  resolveTarget,
  requireSpaceBrain,
  type BrainScope,
} from '@/lib/mcp/context'
import {
  searchBrain,
  readVisible,
  visibleVault,
  writeGated,
  appendLogGated,
  moveGated,
  listVisibleSources,
  readSourceVisible,
} from '@/lib/notes/brainService'
import { readableRoots, LEVEL_FULL } from '@/lib/notes/shared/authz'
import { audienceSummary } from '@/lib/notes/shared/audience'
import { loadSpaceAccess, grantAccess, setFolderRestricted } from '@/lib/notes/access'
import { buildTypeCatalog } from '@/lib/mcp/typeCatalog'
import { principalCanWrite, principalLevelName } from '@/lib/notes/shared/permissions'
import type { WriteResult } from '@/lib/notes/shared/brainTypes'
import type { NoteMeta } from '@/lib/notes/shared/types'
import { entityNotePath } from '@/lib/notes/entities'
import { firstExcerpt, readLinkContextMeta } from '@/lib/notes/context/linkReason'
import { isStructuralNodeType, canonicalNodeType, nodeTypeSpellings } from '@/lib/types/context'
import { readFields } from '@/lib/create/typeFields'
import { createEntity, CREATABLE_TYPES } from '@/lib/directory/createEntity'
import { normalizeImageUrl } from '@/lib/mediaUrl'
import { ConnectorError } from '@/lib/connectors/config'
import { executeConnectorScript, listConnectors, loadConnector } from '@/lib/connectors/service'
import { readNoteOrNull, type Brain } from '@/lib/notes/store'
import { runClean, applyCleanFixes, trashNotes } from '@/lib/notes/clean'
import type { CleanRole } from '@/lib/notes/shared/clean'
import type { BrainPrincipal } from '@/lib/notes/shared/brainTypes'
import type { SpaceFeatureConfig } from '@/lib/types'

const scopeArg = z
  .enum(['shared', 'personal'])
  .optional()
  .describe(
    "Which brain: 'shared' = the space's context (the default for reads), 'personal' = your own private personal space",
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
  "A markdown link to an entity's context note inside a SHARED-brain note body creates a " +
  '`mentioned` edge between the two entities, e.g. `[Craig Piggott](/people/craig-piggott.md)`. ' +
  'Deleting that link from the text removes the edge on the next write. ' +
  'ALWAYS write the path with a leading slash — it is resolved from the context root, whereas a ' +
  "path without one is resolved from the mentioning note's own folder and will silently link to " +
  'nothing. Every tool that returns an entity also returns a ready-to-paste `mention` string; ' +
  'use it verbatim. Mentions in your personal space do not create edges.'

/**
 * The exact markdown an agent should paste to mention this entity. Exported so
 * tests can prove the string it produces actually resolves back to the entity
 * from a note in any folder — a relative form silently would not.
 */
export function mentionFor(name: string, notePath: string | null): string | null {
  return notePath ? `[${name}](/${notePath})` : null
}

/** Map an apply-or-deny WriteResult into a clean tool error on denial. */
function unwrapWrite(result: WriteResult): { status: 'applied'; path: string } {
  if (result.status === 'denied') throw new McpError(403, `Write denied: ${result.reason}`)
  return result
}

const visibilityArg = z
  .enum(['private', 'inherit'])
  .optional()
  .describe(
    "For a NEW shared-brain note only: 'private' (the default) restricts it so only space " +
      "admins and you can see it until someone shares it; 'inherit' leaves it visible to whoever " +
      'can see its folder. Ignored for personal-space writes and for edits of existing notes.',
  )

/**
 * Make a freshly created shared note private-by-default: the author gets an
 * explicit FULL grant FIRST, then the note path is restricted (a restricted
 * boundary on a note path is exactly the app's "Make private"). The order
 * mirrors app/api/notes/access/route.ts — the grant must exist before the cut
 * so a non-admin author never severs their own access. The grant is written
 * even for admins: the bypass makes it redundant today, but the explicit row
 * survives role loss and keeps the access list honest. Failures are returned,
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
      { subjectType: 'user', subjectId: actor.userId, resourcePath: path, level: LEVEL_FULL },
      actor,
    )
    await setFolderRestricted(spaceId, path, true, actor)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'Failed to restrict the note'
  }
}

/** Load a connector or throw a 404 that doesn't reveal whether it exists. */
async function loadConnectorOr404(principal: BrainPrincipal, brain: Brain, name: string) {
  let loaded
  try {
    loaded = await loadConnector(principal, brain, name)
  } catch (e) {
    throw mapConnectorError(e)
  }
  if (!loaded) {
    throw new McpError(404, `No connector named '${name}' — list_connectors shows what exists`)
  }
  return loaded
}

/** ConnectorError codes → tool-facing statuses. Messages are pre-redacted. */
function mapConnectorError(e: unknown): unknown {
  if (!(e instanceof ConnectorError)) return e
  const status = { denied: 403, ssrf: 403, config: 400, missing_secret: 400, timeout: 504, upstream: 502 }[e.code]
  return new McpError(status, e.message)
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

/** A node as the tools report it: identity, type-driven fields, note path. */
function describeNode(row: NodeRow) {
  const notePath = entityNotePath({ id: row.id, type: row.type })
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

export function registerTools(server: McpServer): void {
  // ── Read ────────────────────────────────────────────────────────────────

  server.registerTool(
    'list_spaces',
    {
      description:
        'List the spaces you can act in, with your role in each and whether it is your own personal space. ' +
        'Start here: every other tool needs a space_id (the wire name for a space id).',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    (_args, extra) =>
      withCtx(extra, 'list_spaces', async (ctx) => ({
        you: { name: ctx.name, email: ctx.email },
        spaces: await listMySpaces(ctx),
      })),
  )

  server.registerTool(
    'list_context',
    {
      description:
        "Get your bearings in one space: the entities in its directory grouped by type, the index of its " +
        'context notes (path — title — description), and which folders you can write to. Call this before ' +
        'searching or writing so you know what already exists and where it lives. Also returns `you` (who you ' +
        'are here — name, admin status, aliases), `types` (the node-type catalog: which types are enabled, ' +
        'their exact field keys, live usage, and how each is created), and an `audience` line per writable ' +
        'path summarising who can see notes stored there — use these to pick the right type and the right home ' +
        'for what you write.',
      inputSchema: {
        space_id: z.string(),
        scope: scopeArg,
        type: z
          .string()
          .optional()
          .describe("Only entities of this type, e.g. 'person', 'space', 'resource', 'event'"),
        path_prefix: z.string().optional().describe("Only notes under this path, e.g. 'people/'"),
        limit: z.number().int().min(1).max(500).optional().describe('Max entries per list (default 100)'),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, 'list_context', async (ctx) => {
        const scope: BrainScope = args.scope ?? 'shared'
        const { principal, brain, resolved } = await resolveTarget(ctx, args.space_id, scope)
        const limit = args.limit ?? 100

        // Notes (visibility lens applied inside visibleVault).
        const { metas } = await visibleVault(principal, brain)
        let notes = [...metas].sort((a, b) => a.path.localeCompare(b.path))
        if (args.path_prefix) notes = notes.filter((m) => m.path.startsWith(args.path_prefix!))

        // Grant-derived context — only meaningful for a real space's shared
        // brain (personal spaces are never gated, and the personal scope has no
        // directory). One indexed query per piece; the grant table is bounded by
        // alias/folder rows, not by member count, so this stays cheap however
        // large the space is.
        const isGatedShared = scope === 'shared' && resolved !== null && !resolved.isPersonalSpace
        const [space, aliasRows, spaceAccess] = isGatedShared
          ? await Promise.all([
              prisma.space.findUnique({
                where: { id: args.space_id },
                select: { name: true, featureConfig: true },
              }),
              prisma.userAlias.findMany({
                where: { spaceId: args.space_id, userId: ctx.userId },
                select: { aliasName: true },
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
        const describeWritable = (path: string) => ({
          path: path || '(brain root)',
          your_level: principalLevelName(principal, path),
          // One line, computed from grant rows only — it can name aliases but
          // never individual members, however many grants exist.
          ...(spaceAccess
            ? {
                audience: audienceSummary(path, spaceAccess.grants, spaceAccess.restricted, {
                  selfUserId: ctx.userId,
                  spaceName: space?.name,
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
            aliases: aliasRows.map((r) => r.aliasName),
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
      }),
  )

  server.registerTool(
    'search_context',
    {
      description:
        "Search one space's context — both halves at once. Notes and uploaded files are ranked by fused " +
        'retrieval (keyword BM25 + semantic vectors + link context); directory entities are matched by name, ' +
        'alias and tag. Every hit carries what you need to open it: node_id for read_context, path for read_context, ' +
        'or path+seq for read_file. Only what you are allowed to read is searched. ' +
        'The `semantic` field reports whether the meaning-based stages ran — "no-key" means these results are ' +
        'keyword-only, so prefer literal terms and try more phrasings. Filters beat ranking: narrow with ' +
        'type/tags/folder/updated_after when you can.',
      inputSchema: {
        space_id: z.string(),
        query: z.string().describe('Natural-language or keyword query'),
        scope: scopeArg,
        k: z.number().int().min(1).max(50).optional().describe('Max results per kind (default 10)'),
        type: z.string().optional().describe("Filter notes by frontmatter `type`, entities by node type"),
        tags: z.array(z.string()).optional().describe('Require ALL of these tags (notes)'),
        folder: z
          .string()
          .optional()
          .describe("Only this top-level folder, e.g. 'people' ('' = the brain root)"),
        updated_after: z.number().optional().describe('Only notes modified at/after this epoch-ms timestamp'),
        updated_before: z.number().optional().describe('Only notes modified at/before this epoch-ms timestamp'),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, 'search_context', async (ctx) => {
        const scope: BrainScope = args.scope ?? 'shared'
        const { principal, brain } = await resolveTarget(ctx, args.space_id, scope)
        const k = args.k ?? 10

        const { hits, semantic } = await searchBrain(
          principal,
          brain,
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
                  const notePath = entityNotePath({ id: r.id, type: r.type })
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
            ...(h.kind === 'source'
              ? { seq: h.seq, read_with: { tool: 'read_file', path: h.path } }
              : { read_with: { tool: 'read_context', note_path: h.path } }),
          })),
        }
      }),
  )

  server.registerTool(
    'read_context',
    {
      description:
        'Everything about one entity in one call: its type-driven fields, the full markdown of its context note, ' +
        'the entities it is linked to (with where each link came from), and the notes that mention it. ' +
        'Identify it by node_id or by note_path — search_context and list_context give you both.',
      inputSchema: {
        space_id: z.string(),
        node_id: z.string().optional().describe("The entity's node id, e.g. 'person:craig-piggott'"),
        note_path: z.string().optional().describe("The entity's context note path, e.g. 'people/craig-piggott.md'"),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, 'read_context', async (ctx) => {
        if (!args.node_id && !args.note_path) {
          throw new McpError(400, 'Pass either node_id or note_path')
        }
        const { principal, brain } = await resolveTarget(ctx, args.space_id, 'shared')

        // node_id resolves directly; note_path has to go through the node list,
        // because entityNotePath is lossy and only invertible over real nodes.
        let row: NodeRow | null = null
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
          row = all.find((n) => entityNotePath({ id: n.id, type: n.type }) === args.note_path) ?? null
        }

        // Structural nodes (the space itself, sections, channels, connectors)
        // are not directory entities — list_context and search_context hide
        // them, so resolving one by id here would be the one way in. Their note
        // still reads below as a plain note, via its path.
        let structuralPath: string | null = null
        if (row && isStructuralNodeType(row.type)) {
          structuralPath = entityNotePath({ id: row.id, type: row.type })
          row = null
        }

        // A note path with no node behind it is still readable — a plain note,
        // or an entity note whose node was removed. Return the note alone
        // rather than a bare "not found".
        if (!row) {
          const path = args.note_path ?? structuralPath
          if (!path) throw new McpError(404, `No entity '${args.node_id}' in this space`)
          const content = await readVisible(principal, brain, path)
          if (!content) throw new McpError(404, `No accessible note or entity at '${path}'`)
          return { entity: null, note_path: path, note: content, links: [], mentioned_by: [] }
        }

        const notePath = entityNotePath({ id: row.id, type: row.type })
        const note = notePath ? await readVisible(principal, brain, notePath) : null

        const linkRows = await prisma.link.findMany({
          where: {
            spaceId: args.space_id,
            OR: [{ sourceId: row.id }, { targetId: row.id }],
          },
          select: { sourceId: true, targetId: true, relationship: true, origin: true, originRef: true, metadata: true },
        })
        const otherIds = [...new Set(linkRows.map((l) => (l.sourceId === row!.id ? l.targetId : l.sourceId)))]
        const others = new Map(
          (
            await prisma.node.findMany({
              where: { id: { in: otherIds } },
              select: { id: true, name: true, type: true },
            })
          ).map((n) => [n.id, n]),
        )

        const { metas } = await visibleVault(principal, brain)
        const mentionedBy = notePath
          ? metas
              .filter((m) => m.path !== notePath && m.linkTargets.includes(notePath))
              .map((m) => m.path)
              .sort()
          : []

        return {
          entity: describeNode(row),
          note_path: notePath,
          note: note ?? '(no context note yet — edit_context at note_path creates one)',
          links: linkRows.map((l) => {
            const otherId = l.sourceId === row!.id ? l.targetId : l.sourceId
            const other = others.get(otherId)
            // The link-reason payload written by the note-save sync: the prose
            // around the mention, plus the AI phrase when one has been generated.
            const context = readLinkContextMeta(l.metadata)
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
              reason: context?.reason ?? null,
              excerpt: firstExcerpt(context),
            }
          }),
          mentioned_by: mentionedBy,
        }
      }),
  )

  server.registerTool(
    'list_files',
    {
      description:
        'List the uploaded files in this context — PDFs, spreadsheets, documents and the like, which live ' +
        'alongside notes at their own paths and are what search_context returns as `kind: "source"` hits. ' +
        'Each entry reports its extraction status; only `ready` sources are searchable and readable.',
      inputSchema: {
        space_id: z.string(),
        scope: scopeArg,
        folder: z.string().optional().describe("Only sources in this top-level folder ('' = the brain root)"),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, 'list_files', async (ctx) => {
        const scope: BrainScope = args.scope ?? 'shared'
        const { principal, brain } = await resolveTarget(ctx, args.space_id, scope)
        const sources = await listVisibleSources(principal, brain, args.folder)
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
      }),
  )

  server.registerTool(
    'read_file',
    {
      description:
        "Read the extracted text of an uploaded file — the other half of a search_context `kind: 'source'` hit, " +
        'whose snippet is one chunk of this. Returns plain text (the original binary is not served here), ' +
        'paged: pass offset_chars to continue where the last call stopped, guided by total_chars.',
      inputSchema: {
        space_id: z.string(),
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
    },
    (args, extra) =>
      withCtx(extra, 'read_file', async (ctx) => {
        const scope: BrainScope = args.scope ?? 'shared'
        const { principal, brain } = await resolveTarget(ctx, args.space_id, scope)
        // A '#<seq>' suffix is how search used to report a chunk; accept it.
        const path = args.path.replace(/#\d+$/, '')
        const result = await readSourceVisible(principal, brain, path, {
          offsetChars: args.offset_chars,
          maxChars: args.max_chars,
        })
        // Absent and inaccessible are deliberately indistinguishable.
        if (!result) throw new McpError(404, `No accessible source at '${path}'`)
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
      }),
  )

  // ── Write ───────────────────────────────────────────────────────────────

  server.registerTool(
    'add_context',
    {
      description:
        'Create a directory entity — a typed node plus its context note, in one step. Call list_context first: ' +
        'its `types` catalog shows which types this space has enabled, their exact field keys, and live ' +
        'usage — pick the best EXISTING type. You cannot create new types; if none fits, use the closest and ' +
        'suggest a new type in prose. The TYPE decides which fields apply and where the note lives:\n' +
        '  • person   → people/<slug>.md      fields: subtitle (role), email, companyName, linkedinUrl, location, image_url\n' +
        '  • space    → communities/<slug>.md fields: subtitle (tagline), url (website), location, founded, memberCount, image_url\n' +
        '  • resource → resources/<slug>.md   fields: subtitle (description), url\n' +
        'A "space" here is a group, organisation or space — a company, collective or investor — recorded as a ' +
        'card in the directory of the space you are working in. It NEVER provisions a new workspace: the card ' +
        'points at a real (possibly unclaimed) space via its identity, and the space you are in is not creatable ' +
        'from here.\n' +
        'Use exactly these field keys — email, companyName, linkedinUrl and url/website are what match a person or ' +
        'organisation to their identity across spaces, and an unrecognised key is silently dropped. ' +
        'Only these three types are creatable; events are made in the events surface, and channels/sections are admin-only. ' +
        'If the entity already exists you get an error naming it, so open that one instead of creating a duplicate. ' +
        'The new context note is PRIVATE by default — the directory card (name, fields, mention) stays visible ' +
        "to everyone, but the note's content is readable only by space admins and you until someone shares " +
        "it; pass visibility:'inherit' to let it follow its folder's visibility instead. " +
        `To connect it to others, write mentions: ${MENTION_RULE}`,
      inputSchema: {
        space_id: z.string(),
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
        alias: z.string().optional().describe('Alternative name this entity is also known by'),
        visibility: visibilityArg,
      },
    },
    (args, extra) =>
      withCtx(extra, 'add_context', async (ctx) => {
        const brain = await requireSpaceBrain(ctx, args.space_id)
        const result = await createEntity(brain, {
          type: args.type,
          name: args.name,
          fields: args.fields,
          tags: args.tags,
          body: args.body,
          alias: args.alias,
        })
        if (!result.ok) {
          throw new McpError(
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
          !brain.isPersonalSpace && args.visibility !== 'inherit' && result.notePath !== null && !result.noteError
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
          ...(brain.isPersonalSpace
            ? {}
            : {
                visibility: wantPrivate && !visibilityError ? 'private' : 'inherit',
                ...(visibilityError ? { visibility_error: visibilityError } : {}),
              }),
        }
      }),
  )

  server.registerTool(
    'edit_context',
    {
      description:
        'Create or overwrite one context note (full-content write; the previous version is kept in history). ' +
        "Writes go to your PERSONAL space by default — pass scope:'shared' to write the space's shared context, " +
        'which is gated on your write access to that folder. A NEW shared note is PRIVATE by default — only ' +
        "space admins and you can see it — pass visibility:'inherit' to make it visible to whoever can see " +
        'its folder (list_context shows each folder\'s audience). Writes are attributed to the authenticated ' +
        'caller — list_context\'s `you` says who that is here. Read the note first when editing, or you will ' +
        `clobber it; use append_context when you only want to add. ${MENTION_RULE}`,
      inputSchema: {
        space_id: z.string(),
        path: z.string().describe("Brain-relative path ending in .md, e.g. 'people/craig-piggott.md'"),
        content: z.string().describe('The full markdown content of the note, including frontmatter'),
        scope: scopeArg.describe(
          "Target brain — defaults to 'personal'; pass 'shared' explicitly to write the space's shared context",
        ),
        visibility: visibilityArg,
      },
    },
    (args, extra) =>
      withCtx(extra, 'edit_context', async (ctx) => {
        const scope: BrainScope = args.scope ?? 'personal'
        const { principal, brain, resolved } = await resolveTarget(ctx, args.space_id, scope)
        // Private-by-default applies only to a note this call CREATES in a real
        // space's shared brain — checked before the write, since afterwards
        // the note always exists. Personal spaces are private already.
        const isGatedShared = scope === 'shared' && resolved !== null && !resolved.isPersonalSpace
        const existed = isGatedShared ? (await readNoteOrNull(brain, args.path)) !== null : true
        // Stamped as an agent revision so human and agent edits stay
        // distinguishable in the note's history.
        const result = unwrapWrite(
          await writeGated(principal, brain, args.path, args.content, 'agent', 'mcp'),
        )
        const wantPrivate = !existed && args.visibility !== 'inherit'
        const visibilityError = wantPrivate
          ? await makeNotePrivate(args.space_id, result.path, { userId: ctx.userId, name: ctx.name })
          : null
        return {
          status: 'applied',
          scope,
          path: result.path,
          // Every shared-brain write re-syncs that note's mention set, so the
          // edges it draws are already up to date by the time this returns.
          links_synced: scope === 'shared',
          ...(isGatedShared
            ? {
                visibility: existed ? 'unchanged' : wantPrivate && !visibilityError ? 'private' : 'inherit',
                ...(wantPrivate && !visibilityError ? { audience: 'you + admins only' } : {}),
                ...(visibilityError ? { visibility_error: visibilityError } : {}),
              }
            : {}),
        }
      }),
  )

  server.registerTool(
    'append_context',
    {
      description:
        "Append a dated, attributed entry to a note's '## Log' section, creating the section if it is absent. " +
        'The safe way to add one fact to an existing note — nothing else in the note can be lost. The entry is ' +
        "attributed to the authenticated caller (list_context's `you`). " +
        "Defaults to your personal space; pass scope:'shared' for the space's shared context. " +
        `Mentions in the entry create links the same way: ${MENTION_RULE}`,
      inputSchema: {
        space_id: z.string(),
        path: z.string().describe('Path of the existing note to append to'),
        entry: z.string().describe('The entry text — one update. The date and your name are added for you.'),
        scope: scopeArg.describe("Target brain — defaults to 'personal'; pass 'shared' for the space's shared context"),
      },
    },
    (args, extra) =>
      withCtx(extra, 'append_context', async (ctx) => {
        const scope: BrainScope = args.scope ?? 'personal'
        const { principal, brain } = await resolveTarget(ctx, args.space_id, scope)
        const result = unwrapWrite(
          await appendLogGated(principal, brain, args.path, args.entry, 'agent', 'mcp'),
        )
        return { status: 'applied', scope, path: result.path }
      }),
  )

  server.registerTool(
    'move_context',
    {
      description:
        'Move or rename one note. Links pointing AT it are rewritten across the brain, so the mentions that ' +
        'make up the graph survive the move — which is why this exists instead of write-then-delete. ' +
        'Needs write access at BOTH the old and the new path. Moving an entity note away from the path its ' +
        'type implies (people/<slug>.md and so on) detaches it from that entity, so do not. Moving a note ' +
        'does NOT carry note-level sharing or restriction with it — a private note becomes governed by its ' +
        'new folder; re-apply sharing after moving if it matters.',
      inputSchema: {
        space_id: z.string(),
        from: z.string().describe('Current path of the note'),
        to: z
          .string()
          .describe(
            'New path, ending in .md. Folders are implicit in the path, so none need creating first; ' +
              'a note already at that path is an error rather than an overwrite.',
          ),
        scope: scopeArg.describe("Target brain — defaults to 'personal'; pass 'shared' for the space's shared context"),
      },
    },
    (args, extra) =>
      withCtx(extra, 'move_context', async (ctx) => {
        const scope: BrainScope = args.scope ?? 'personal'
        const { principal, brain } = await resolveTarget(ctx, args.space_id, scope)
        const result = unwrapWrite(await moveGated(principal, brain, args.from, args.to, 'agent'))
        return { status: 'applied', scope, from: args.from, path: result.path, links_rewritten: true }
      }),
  )

  // ── Maintain ────────────────────────────────────────────────────────────

  server.registerTool(
    'clean_context',
    {
      description:
        'Analyze and clean up context, scoped to your role. The default action (analyze) is READ-ONLY: it ' +
        'returns (a) safe mechanical fixes this tool can apply itself — missing frontmatter, uniquely ' +
        'resolvable broken links, unambiguous mention linking, staling of long-untouched notes — and (b) a ' +
        'prioritized worklist of judgment calls for YOU to execute with the ordinary write tools (each item ' +
        'says how). Recommended loop: analyze → apply_fixes → work the worklist with read/edit/append/' +
        "move_context → re-analyze to confirm the counts dropped. Members clean the notes THEY authored; " +
        'space admins clean the whole space (and get a `structure` block — folder sizes, empties, outliers, ' +
        'tag/type mixes — to reason about better organisation); pass `path` to target one folder. ' +
        "mode:'full' adds duplicate detection and oversized-note flags. Folders frozen for AI are reported " +
        "but never touched. action:'trash' soft-deletes notes you are allowed to remove (author, admin, or " +
        'full access; restorable for 7 days) — use it for confirmed duplicates and empties only, AFTER ' +
        `reading them. When fixing orphans, remember: ${MENTION_RULE}`,
      inputSchema: {
        space_id: z.string(),
        scope: scopeArg.describe(
          "Which brain to clean — defaults to 'shared' (the space's context); 'personal' cleans your own space",
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
          .describe("'light' (default) | 'full' adds duplicate + oversized-note detection (slower)"),
        paths: z
          .array(z.string())
          .max(50)
          .optional()
          .describe("For action:'trash': the note paths to soft-delete (max 50)"),
        limit: z.number().int().min(1).max(100).optional().describe('Max items per worklist category (default 20)'),
      },
    },
    (args, extra) =>
      withCtx(extra, 'clean_context', async (ctx) => {
        const scope: BrainScope = args.scope ?? 'shared'
        const { principal, brain, resolved } = await resolveTarget(ctx, args.space_id, scope)
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
          if (!args.paths?.length) throw new McpError(400, "action:'trash' needs `paths`")
          const results = await trashNotes(principal, brain, resolved, args.paths)
          return { action, results, restorable_days: 7 }
        }
        if (action === 'apply_fixes') {
          const result = await applyCleanFixes(principal, brain, opts)
          return { action, ...result }
        }
        return { action, scope, ...(await runClean(principal, brain, opts)) }
      }),
  )

  // ── Connectors ──────────────────────────────────────────────────────────
  // A connector is a note at connectors/<name>.md: frontmatter declares the
  // perimeter (hosts, env, limits) and the body teaches how to call the
  // service. Execution is one tool — JavaScript in an isolate whose only way
  // out is a perimeter-gated fetch/sql/mcp. Secrets resolve server-side into
  // the isolate's `env` and are redacted from everything that returns; the
  // model sees names, never values.

  server.registerTool(
    'list_connectors',
    {
      description:
        "List the space's connectors — admin-configured gateways to external APIs, databases and services. " +
        'Each entry carries its docs (what the system is and how to call it), the hosts it may reach, ' +
        'and the env var names its code can read. Run one with run_connector; a connector with no hosts is ' +
        "documentation-only. Executing needs the 'connectors:use' scope.",
      inputSchema: { space_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, 'list_connectors', async (ctx) => {
        const { principal, brain } = await resolveTarget(ctx, args.space_id, 'shared')
        return { connectors: await listConnectors(principal, brain) }
      }),
  )

  server.registerTool(
    'run_connector',
    {
      description:
        "Run JavaScript inside a connector's isolate (see list_connectors; the connector's docs say what calls " +
        'make sense). Write the body of an async function and `return` the answer — top-level await works. ' +
        'Available: `fetch(url, init)` which resolves to {status, ok, headers, body, truncated} with body as a ' +
        'STRING (call JSON.parse yourself, there is no .json()); `sql(dsn, query)` for read-only Postgres/MySQL; ' +
        '`mcp(url).listTools()` / `mcp(url).callTool(name, args)`; `sleep(ms)` for backing off a 429 (bounded ' +
        "by the run deadline); `env` holding the connector's secrets; and " +
        '`console.log`. There is no filesystem, no process, no require/import, and no network beyond the hosts ' +
        "the connector declares — a refused call throws with the reason. Use secrets by name (e.g. " +
        '`{ Authorization: `Bearer ${env.API_KEY}` }`), never ask for or supply credential values; they are ' +
        'redacted from everything that comes back. Output is capped at 256KB.',
      inputSchema: {
        space_id: z.string(),
        connector: z.string().describe("The connector's name, e.g. 'stripe' for connectors/stripe.md"),
        code: z
          .string()
          .describe(
            'JavaScript to evaluate, e.g. `const r = await fetch("https://api.stripe.com/v1/customers", ' +
              '{ headers: { Authorization: `Bearer ${env.STRIPE_KEY}` } }); return JSON.parse(r.body)`',
          ),
      },
    },
    (args, extra) =>
      withCtx(extra, 'run_connector', async (ctx) => {
        const { principal, brain } = await resolveTarget(ctx, args.space_id, 'shared')
        const loaded = await loadConnectorOr404(principal, brain, args.connector)
        try {
          const result = await executeConnectorScript(principal, brain, args.space_id, loaded, args.code)
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
      }),
  )
}
