/**
 * The MCP tool surface: ten tools over the context layer.
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
  listMyCommunities,
  resolveTarget,
  requireCommunityBrain,
  type BrainScope,
} from '@/lib/mcp/context'
import { searchBrain, readVisible, visibleVault, writeGated, appendLogGated } from '@/lib/notes/brainService'
import { readableRoots } from '@/lib/notes/shared/authz'
import { principalCanWrite, principalLevelName } from '@/lib/notes/shared/permissions'
import type { WriteResult } from '@/lib/notes/shared/brainTypes'
import type { NoteMeta } from '@/lib/notes/shared/types'
import { entityNotePath } from '@/lib/notes/entities'
import { isStructuralNodeType } from '@/lib/types/context'
import { readFields } from '@/lib/create/typeFields'
import { createEntity, CREATABLE_TYPES } from '@/lib/directory/createEntity'
import { normalizeImageUrl } from '@/lib/mediaUrl'
import { configSecretRefs, ConnectorError, findSecretRefs, interpolateSecrets, isSqlConnector } from '@/lib/connectors/config'
import { executeHttpConnector } from '@/lib/connectors/http'
import { executePostgresQuery } from '@/lib/connectors/postgres'
import { executeMysqlQuery } from '@/lib/connectors/mysql'
import { callMcpTool, listMcpTools } from '@/lib/connectors/mcp'
import {
  auditConnectorCall,
  listConnectors,
  loadConnector,
  resolveSecretValues,
} from '@/lib/connectors/service'
import type { Brain } from '@/lib/notes/store'
import type { BrainPrincipal } from '@/lib/notes/shared/brainTypes'

const scopeArg = z
  .enum(['shared', 'personal'])
  .optional()
  .describe(
    "Which brain: 'shared' = the community's context (the default for reads), 'personal' = your own private space",
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
    // the same keys create_entity accepts.
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
    'list_communities',
    {
      description:
        'List the communities you can act in, with your role in each and whether it is your own personal space. ' +
        'Start here: every other tool needs a community_id.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    (_args, extra) =>
      withCtx(extra, 'list_communities', async (ctx) => ({
        you: { name: ctx.name, email: ctx.email },
        communities: await listMyCommunities(ctx),
      })),
  )

  server.registerTool(
    'list_context',
    {
      description:
        "Get your bearings in one community: the entities in its directory grouped by type, the index of its " +
        'context notes (path — title — description), and which folders you can write to. Call this before ' +
        'searching or writing so you know what already exists and where it lives.',
      inputSchema: {
        community_id: z.string(),
        scope: scopeArg,
        type: z
          .string()
          .optional()
          .describe("Only entities of this type, e.g. 'person', 'community', 'resource', 'event'"),
        path_prefix: z.string().optional().describe("Only notes under this path, e.g. 'people/'"),
        limit: z.number().int().min(1).max(500).optional().describe('Max entries per list (default 100)'),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, 'list_context', async (ctx) => {
        const scope: BrainScope = args.scope ?? 'shared'
        const { principal, brain } = await resolveTarget(ctx, args.community_id, scope)
        const limit = args.limit ?? 100

        // Notes (visibility lens applied inside visibleVault).
        const { metas } = await visibleVault(principal, brain)
        let notes = [...metas].sort((a, b) => a.path.localeCompare(b.path))
        if (args.path_prefix) notes = notes.filter((m) => m.path.startsWith(args.path_prefix!))

        // Entities live in the community directory, not in the personal space,
        // so a personal-scope call reports notes only.
        const entitiesByType: Record<string, ReturnType<typeof describeNode>[]> = {}
        let entityTotal = 0
        if (scope === 'shared') {
          const rows = await prisma.node.findMany({
            where: { communityId: args.community_id },
            select: NODE_SELECT,
            orderBy: { name: 'asc' },
          })
          // Structural types (community/space/channel/note/file) describe the
          // container, not the directory — the grid hides them and so do we.
          const directory = rows
            .filter((r) => !isStructuralNodeType(r.type))
            .filter((r) => !args.type || r.type.toLowerCase() === args.type.toLowerCase())
          entityTotal = directory.length
          for (const row of directory.slice(0, limit)) {
            ;(entitiesByType[row.type] ??= []).push(describeNode(row))
          }
        }

        return {
          scope,
          entities: entitiesByType,
          entity_count: entityTotal,
          notes: notes.slice(0, limit).map(indexLine),
          note_count: notes.length,
          writable_folders: (principal.communityAdmin ? [''] : readableRoots(principal.access))
            .filter((path) => principalCanWrite(principal, path))
            .map((path) => ({ path: path || '(brain root)', your_level: principalLevelName(principal, path) })),
          truncated: entityTotal > limit || notes.length > limit,
        }
      }),
  )

  server.registerTool(
    'search_context',
    {
      description:
        "Search one community's context — both halves at once. Notes and uploaded sources are ranked by fused " +
        'retrieval (keyword + semantic + link context); directory entities are matched by name, alias and tag. ' +
        'Every hit carries the node_id or note path you need for get_entity. Only what you are allowed to read is searched.',
      inputSchema: {
        community_id: z.string(),
        query: z.string().describe('Natural-language or keyword query'),
        scope: scopeArg,
        k: z.number().int().min(1).max(50).optional().describe('Max results per kind (default 10)'),
        type: z.string().optional().describe("Filter notes by frontmatter `type`, entities by node type"),
        tags: z.array(z.string()).optional().describe('Require ALL of these tags (notes)'),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, 'search_context', async (ctx) => {
        const scope: BrainScope = args.scope ?? 'shared'
        const { principal, brain } = await resolveTarget(ctx, args.community_id, scope)
        const k = args.k ?? 10

        const hits = await searchBrain(
          principal,
          brain,
          args.query,
          { type: args.type, tags: args.tags },
          k,
        )

        const entities =
          scope === 'shared'
            ? (
                await prisma.node.findMany({
                  where: {
                    communityId: args.community_id,
                    OR: [
                      { name: { contains: args.query, mode: 'insensitive' } },
                      { alias: { contains: args.query, mode: 'insensitive' } },
                      { tags: { has: args.query.toLowerCase() } },
                    ],
                    ...(args.type ? { type: args.type.toLowerCase() } : {}),
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
          entities,
          // A source hit is a chunk of an uploaded file: it has no note to read,
          // so it is labelled separately rather than looking like a missing note.
          notes: hits.map((h) => ({
            kind: h.kind,
            path: h.kind === 'source' ? `${h.path}#${h.seq}` : h.path,
            title: h.title,
            snippet: h.snippet ?? null,
          })),
        }
      }),
  )

  server.registerTool(
    'get_entity',
    {
      description:
        'Everything about one entity in one call: its type-driven fields, the full markdown of its context note, ' +
        'the entities it is linked to (with where each link came from), and the notes that mention it. ' +
        'Identify it by node_id or by note_path — search_context and list_context give you both.',
      inputSchema: {
        community_id: z.string(),
        node_id: z.string().optional().describe("The entity's node id, e.g. 'person:craig-piggott'"),
        note_path: z.string().optional().describe("The entity's context note path, e.g. 'people/craig-piggott.md'"),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, 'get_entity', async (ctx) => {
        if (!args.node_id && !args.note_path) {
          throw new McpError(400, 'Pass either node_id or note_path')
        }
        const { principal, brain } = await resolveTarget(ctx, args.community_id, 'shared')

        // node_id resolves directly; note_path has to go through the node list,
        // because entityNotePath is lossy and only invertible over real nodes.
        let row: NodeRow | null = null
        if (args.node_id) {
          row = await prisma.node.findFirst({
            where: { id: args.node_id, communityId: args.community_id },
            select: NODE_SELECT,
          })
        } else {
          const all = await prisma.node.findMany({
            where: { communityId: args.community_id },
            select: NODE_SELECT,
          })
          row = all.find((n) => entityNotePath({ id: n.id, type: n.type }) === args.note_path) ?? null
        }

        // A note path with no node behind it is still readable — a plain note,
        // or an entity note whose node was removed. Return the note alone
        // rather than a bare "not found".
        if (!row) {
          const path = args.note_path
          if (!path) throw new McpError(404, `No entity '${args.node_id}' in this community`)
          const content = await readVisible(principal, brain, path)
          if (!content) throw new McpError(404, `No accessible note or entity at '${path}'`)
          return { entity: null, note_path: path, note: content, links: [], mentioned_by: [] }
        }

        const notePath = entityNotePath({ id: row.id, type: row.type })
        const note = notePath ? await readVisible(principal, brain, notePath) : null

        const linkRows = await prisma.link.findMany({
          where: {
            communityId: args.community_id,
            OR: [{ sourceId: row.id }, { targetId: row.id }],
          },
          select: { sourceId: true, targetId: true, relationship: true, origin: true, originRef: true },
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
          note: note ?? '(no context note yet — write_note at note_path creates one)',
          links: linkRows.map((l) => {
            const otherId = l.sourceId === row!.id ? l.targetId : l.sourceId
            const other = others.get(otherId)
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
            }
          }),
          mentioned_by: mentionedBy,
        }
      }),
  )

  // ── Write ───────────────────────────────────────────────────────────────

  server.registerTool(
    'create_entity',
    {
      description:
        'Create a directory entity — a typed node plus its context note, in one step. The TYPE decides which ' +
        'fields apply and where the note lives:\n' +
        '  • person    → people/<slug>.md      fields: subtitle (role), email, companyName, linkedinUrl, location, image_url\n' +
        '  • community → communities/<slug>.md fields: subtitle (tagline), url (website), location, founded, memberCount, image_url\n' +
        '  • resource  → resources/<slug>.md   fields: subtitle (description), url\n' +
        'A "community" here is an organisation — a company, group or investor — recorded in the directory. It shares ' +
        'the type with the community you are in, which is NOT creatable from here.\n' +
        'Use exactly these field keys — email, companyName, linkedinUrl and url/website are what match a person or ' +
        'organization to their identity across communities, and an unrecognised key is silently dropped. ' +
        'Only these three types are creatable; events are made in the events surface, and channels/spaces are admin-only. ' +
        'If the entity already exists you get an error naming it, so open that one instead of creating a duplicate. ' +
        `To connect it to others, write mentions: ${MENTION_RULE}`,
      inputSchema: {
        community_id: z.string(),
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
      },
    },
    (args, extra) =>
      withCtx(extra, 'create_entity', async (ctx) => {
        const brain = await requireCommunityBrain(ctx, args.community_id)
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
              ? `${result.error} (node_id: ${result.existingNodeId}, note: ${result.existingPath}) — read it with get_entity instead of creating a duplicate`
              : result.error,
          )
        }
        return {
          node_id: result.node.id,
          type: result.node.type,
          name: result.node.name,
          note_path: result.notePath,
          // Paste this verbatim into another shared note to link to it.
          mention: mentionFor(result.node.name, result.notePath),
          identity_resolution: result.resolution,
          note_error: result.noteError,
        }
      }),
  )

  server.registerTool(
    'write_note',
    {
      description:
        'Create or overwrite one context note (full-content write; the previous version is kept in history). ' +
        "Writes go to your PERSONAL space by default — pass scope:'shared' to write the community's context, " +
        'which is gated on your write access to that folder. Read the note first when editing, or you will clobber it; ' +
        `use append_note when you only want to add. ${MENTION_RULE}`,
      inputSchema: {
        community_id: z.string(),
        path: z.string().describe("Brain-relative path ending in .md, e.g. 'people/craig-piggott.md'"),
        content: z.string().describe('The full markdown content of the note, including frontmatter'),
        scope: scopeArg.describe(
          "Target brain — defaults to 'personal'; pass 'shared' explicitly to write the community's context",
        ),
      },
    },
    (args, extra) =>
      withCtx(extra, 'write_note', async (ctx) => {
        const scope: BrainScope = args.scope ?? 'personal'
        const { principal, brain } = await resolveTarget(ctx, args.community_id, scope)
        // Stamped as an agent revision so human and agent edits stay
        // distinguishable in the note's history.
        const result = unwrapWrite(
          await writeGated(principal, brain, args.path, args.content, 'agent', 'mcp'),
        )
        return {
          status: 'applied',
          scope,
          path: result.path,
          // Every shared-brain write re-syncs that note's mention set, so the
          // edges it draws are already up to date by the time this returns.
          links_synced: scope === 'shared',
        }
      }),
  )

  server.registerTool(
    'append_note',
    {
      description:
        "Append a dated, attributed entry to a note's '## Log' section, creating the section if it is absent. " +
        'The safe way to add one fact to an existing note — nothing else in the note can be lost. ' +
        "Defaults to your personal space; pass scope:'shared' for the community's context. " +
        `Mentions in the entry create links the same way: ${MENTION_RULE}`,
      inputSchema: {
        community_id: z.string(),
        path: z.string().describe('Path of the existing note to append to'),
        entry: z.string().describe('The entry text — one update. The date and your name are added for you.'),
        scope: scopeArg.describe("Target brain — defaults to 'personal'; pass 'shared' for the community's context"),
      },
    },
    (args, extra) =>
      withCtx(extra, 'append_note', async (ctx) => {
        const scope: BrainScope = args.scope ?? 'personal'
        const { principal, brain } = await resolveTarget(ctx, args.community_id, scope)
        const result = unwrapWrite(
          await appendLogGated(principal, brain, args.path, args.entry, 'agent', 'mcp'),
        )
        return { status: 'applied', scope, path: result.path }
      }),
  )

  // ── Connectors ──────────────────────────────────────────────────────────
  // A connector is a note at connectors/<name>.md whose frontmatter is machine
  // config and whose body is docs — so discovery is just reading the brain,
  // while execution interpolates admin-stored secrets server-side. The model
  // never sees a secret value, only its {{secret:NAME}} reference.

  server.registerTool(
    'list_connectors',
    {
      description:
        "List the community's connectors — admin-configured gateways to external APIs, databases and MCP servers. " +
        'Each entry carries its docs (what the system is and how to use it), its alias, and its allowlist. ' +
        'Use call_connector for alias `http`, query_connector for `postgres` or `mysql`, and ' +
        'list_connector_tools + call_mcp_connector for `mcp`; a connector with an empty allowlist is ' +
        "documentation-only. Executing needs the 'connectors:use' scope.",
      inputSchema: { community_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, 'list_connectors', async (ctx) => {
        const { principal, brain } = await resolveTarget(ctx, args.community_id, 'shared')
        return { connectors: await listConnectors(principal, brain) }
      }),
  )

  server.registerTool(
    'call_connector',
    {
      description:
        'Call an external HTTP API through one of the community\'s connectors (see list_connectors). The call ' +
        "must match the connector's allowlist (method + path); auth headers are filled in server-side from " +
        'admin-stored secrets, so never ask for or supply credentials. Responses are truncated at 256KB.',
      inputSchema: {
        community_id: z.string(),
        connector: z.string().describe("The connector's name, e.g. 'stripe' for connectors/stripe.md"),
        method: z.string().describe('HTTP method, e.g. GET or POST'),
        path: z.string().describe("Request path relative to the connector's base_url, e.g. '/v1/customers'"),
        query: z.record(z.string(), z.string()).optional().describe('Query parameters'),
        body: z.string().optional().describe('Request body for POST/PUT/PATCH'),
      },
    },
    (args, extra) =>
      withCtx(extra, 'call_connector', async (ctx) => {
        const { principal, brain } = await resolveTarget(ctx, args.community_id, 'shared')
        const loaded = await loadConnectorOr404(principal, brain, args.connector)
        if (loaded.config.alias !== 'http') {
          throw new McpError(
            400,
            `'${args.connector}' is a ${loaded.config.alias} connector — use ${
              loaded.config.alias === 'mcp' ? 'call_mcp_connector' : 'query_connector'
            }`,
          )
        }
        try {
          const secrets = await resolveSecretValues(args.community_id, configSecretRefs(loaded.config))
          const result = await executeHttpConnector(loaded.config, secrets, {
            method: args.method,
            path: args.path,
            query: args.query,
            body: args.body,
          })
          auditConnectorCall(principal, loaded.path, `${args.method.toUpperCase()} ${args.path} → ${result.status}`)
          return result
        } catch (e) {
          if (e instanceof ConnectorError) {
            auditConnectorCall(principal, loaded.path, `${args.method.toUpperCase()} ${args.path} → ${e.code}: ${e.message}`)
          }
          throw mapConnectorError(e)
        }
      }),
  )

  server.registerTool(
    'query_connector',
    {
      description:
        "Run one read-only SQL statement against a community's postgres or mysql connector (see list_connectors). " +
        'Only a single SELECT-shaped statement is accepted, executed in a READ ONLY transaction with a ' +
        "statement timeout and a row cap — the connector's docs describe the schema. The connection string " +
        'is resolved server-side from an admin-stored secret; never ask for or supply one.',
      inputSchema: {
        community_id: z.string(),
        connector: z.string().describe("The connector's name, e.g. 'analytics' for connectors/analytics.md"),
        sql: z.string().describe("A single read-only SQL statement, in the connector's dialect"),
      },
    },
    (args, extra) =>
      withCtx(extra, 'query_connector', async (ctx) => {
        const { principal, brain } = await resolveTarget(ctx, args.community_id, 'shared')
        const loaded = await loadConnectorOr404(principal, brain, args.connector)
        if (!isSqlConnector(loaded.config)) {
          throw new McpError(
            400,
            `'${args.connector}' is a ${loaded.config.alias} connector — use ${
              loaded.config.alias === 'mcp' ? 'call_mcp_connector' : 'call_connector'
            }`,
          )
        }
        const config = loaded.config
        try {
          const secrets = await resolveSecretValues(args.community_id, findSecretRefs(config.dsn))
          const interpolated = interpolateSecrets(config.dsn, secrets)
          if (!interpolated.ok) {
            throw new ConnectorError('missing_secret', `Secret ${interpolated.missing.join(', ')} not set`)
          }
          const result =
            config.alias === 'postgres'
              ? await executePostgresQuery(config, interpolated.value, args.sql)
              : await executeMysqlQuery(config, interpolated.value, args.sql)
          auditConnectorCall(principal, loaded.path, `query → ${result.row_count} rows`)
          return result
        } catch (e) {
          if (e instanceof ConnectorError) {
            auditConnectorCall(principal, loaded.path, `query → ${e.code}: ${e.message}`)
          }
          throw mapConnectorError(e)
        }
      }),
  )

  server.registerTool(
    'list_connector_tools',
    {
      description:
        "Discover the tools a community's mcp connector exposes (see list_connectors). Returns each remote " +
        "tool's name, description and input schema, flagged with whether this connector's allowlist permits " +
        'calling it — only allowed tools can be run with call_mcp_connector.',
      inputSchema: {
        community_id: z.string(),
        connector: z.string().describe("The connector's name, e.g. 'linear' for connectors/linear.md"),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, 'list_connector_tools', async (ctx) => {
        const { principal, brain } = await resolveTarget(ctx, args.community_id, 'shared')
        const loaded = await loadConnectorOr404(principal, brain, args.connector)
        if (loaded.config.alias !== 'mcp') {
          throw new McpError(400, `'${args.connector}' is a ${loaded.config.alias} connector — it has no remote tools`)
        }
        try {
          const secrets = await resolveSecretValues(args.community_id, configSecretRefs(loaded.config))
          const tools = await listMcpTools(loaded.config, secrets)
          auditConnectorCall(principal, loaded.path, `tools/list → ${tools.length} tools`)
          return { tools }
        } catch (e) {
          if (e instanceof ConnectorError) {
            auditConnectorCall(principal, loaded.path, `tools/list → ${e.code}: ${e.message}`)
          }
          throw mapConnectorError(e)
        }
      }),
  )

  server.registerTool(
    'call_mcp_connector',
    {
      description:
        "Call one tool on a community's mcp connector — a remote MCP server an admin has configured (see " +
        "list_connectors; list_connector_tools shows the tools and their schemas). The tool must match the " +
        "connector's allowlist; auth headers are filled in server-side from admin-stored secrets, so never " +
        'ask for or supply credentials.',
      inputSchema: {
        community_id: z.string(),
        connector: z.string().describe("The connector's name, e.g. 'linear' for connectors/linear.md"),
        tool: z.string().describe('The remote tool name, exactly as list_connector_tools reports it'),
        arguments: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("The tool's arguments, matching its input schema"),
      },
    },
    (args, extra) =>
      withCtx(extra, 'call_mcp_connector', async (ctx) => {
        const { principal, brain } = await resolveTarget(ctx, args.community_id, 'shared')
        const loaded = await loadConnectorOr404(principal, brain, args.connector)
        if (loaded.config.alias !== 'mcp') {
          throw new McpError(
            400,
            `'${args.connector}' is a ${loaded.config.alias} connector — use ${
              loaded.config.alias === 'http' ? 'call_connector' : 'query_connector'
            }`,
          )
        }
        try {
          const secrets = await resolveSecretValues(args.community_id, configSecretRefs(loaded.config))
          const result = await callMcpTool(loaded.config, secrets, args.tool, args.arguments ?? {})
          auditConnectorCall(principal, loaded.path, `tools/call ${args.tool} → ${result.is_error ? 'error' : 'ok'}`)
          return result
        } catch (e) {
          if (e instanceof ConnectorError) {
            auditConnectorCall(principal, loaded.path, `tools/call ${args.tool} → ${e.code}: ${e.message}`)
          }
          throw mapConnectorError(e)
        }
      }),
  )
}
