/**
 * The tools a Space agent gets — the feature's ceiling, since capability lives
 * in OUR tool surface rather than a vendor's proprietary model feature.
 *
 * Every tool routes through the same layers a human or an MCP client uses —
 * `readVisible`/`visibleVault`/`searchContext` for reads, `writeGated` /
 * `appendLogGated` (origin `agent`) for writes, `loadConnector` →
 * `executeConnectorScript` for connectors, `createEntity` / `upsertLink` for
 * the directory, `sendMessage` for channels, `notify` for people — under the
 * run's principal (the brief's author). So an agent provably cannot exceed
 * what its author can do, `writeDenial` and Freeze-for-AI apply unchanged,
 * and `agents/` itself is frozen for AI: an agent can never rewrite itself or
 * its siblings.
 *
 * Names mirror the MCP tools (list/search/read/write/append_context,
 * run_connector) so there is one vocabulary. Connector reach is DECLARED — only
 * the names in the brief's `connectors:` are offered — and the extras appear
 * only when the brief asks: `fetch_url` (`tools: [web]`), `run_code`
 * (`[sandbox]`), channel posts from `notify` (`[messages]`), `create_node` /
 * `link_nodes` (`[directory]`), `run_agent` (`agents: [...]`). `notify` and
 * `ask_human` are always on, capped per run.
 *
 * `dry_run: true` in the brief turns every WRITE (notes, nodes, links, channel
 * posts, chained runs) into a transcript line — "DRY RUN — would …" — while
 * reads and notifications to people still happen, so a brief can be rehearsed
 * end to end without touching the space.
 *
 * Side effects go through `AgentToolDeps` so the handlers can be exercised
 * against fakes (tests/agents-tools.test.ts); the defaults are the real
 * services.
 */
import prisma from '@/lib/prisma'
import { fetchPublicText } from '@/lib/connectors/publicFetch'
import { ConnectorError } from '@/lib/connectors/config'
import { executeConnectorScript, loadConnector, type ConnectorActionSummary } from '@/lib/connectors/service'
import { createEntity, type CreateEntityInput, type CreateEntityResult } from '@/lib/directory/createEntity'
import { spaceAdminUserIds } from '@/lib/auth'
import { listChannelsForSpace } from '@/lib/messages/conversationService'
import { sendMessage } from '@/lib/messages/messageService'
import { publishToUsers } from '@/lib/messages/realtime'
import {
  appendLogGated,
  readVisible,
  searchContext,
  visibleVault,
  writeGated,
} from '@/lib/notes/contextService'
import { upsertLink } from '@/lib/notes/context/links'
import type { ResolvedContext } from '@/lib/notes/resolve'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import { SHARED_OWNER_KEY, type Context } from '@/lib/notes/store'
import type { ToolHandler } from '@/lib/notes/toolLoop'
import { notify, type NotifyInput } from '@/lib/notifications/service'
import { agentPageHref, type AgentBrief } from './config'
import type { RunNowResult } from './schedule'
import { sandboxProvider } from './sandbox'

const READ_CAP_CHARS = 40_000
const LIST_CAP = 400
const SEARCH_CAP = 20
/** `notify` calls one run may make (people or channels); the next returns an error string. */
export const NOTIFY_PER_RUN_CAP = 5
/** `ask_human` calls one run may make. */
export const ASK_PER_RUN_CAP = 2
/** A run at this chain depth may not `run_agent` further (root run = 0). */
export const MAX_CHAIN_DEPTH = 2
const NOTIFY_MESSAGE_MAX = 2_000
const ASK_QUESTION_MAX = 1_000
const NOTIFY_TITLE_MAX = 120


/** Everything the tools do to the world outside the note store — swappable for tests. */
export interface AgentToolDeps {
  writeGated: typeof writeGated
  appendLogGated: typeof appendLogGated
  notify: (userIds: string[], n: NotifyInput) => Promise<{ created: number }>
  spaceAdminUserIds: (spaceId: string) => Promise<string[]>
  /** Channels in the space visible to `userId` (name → id). */
  listChannels: (userId: string, spaceId: string) => Promise<{ id: string; name: string }[]>
  /** Post `text` to a channel as `userId` (membership enforced inside) and fan it out. */
  postToChannel: (userId: string, conversationId: string, text: string) => Promise<void>
  claimManualRun: (
    spaceId: string,
    name: string,
    startedBy: string,
    opts: { chain: { parent: string; depth: number } },
  ) => Promise<RunNowResult & { dispatch?: Promise<unknown> }>
  createEntity: (context: ResolvedContext, input: CreateEntityInput) => Promise<CreateEntityResult>
  /** Both ids must be nodes of the space; returns an error string or null. */
  linkNodes: (input: { spaceId: string; from: string; to: string; relationship: string; note: string | null; createdBy: string }) => Promise<string | null>
}

function defaultDeps(): AgentToolDeps {
  return {
    writeGated,
    appendLogGated,
    notify,
    spaceAdminUserIds,
    listChannels: async (userId, spaceId) => (await listChannelsForSpace(userId, spaceId)).map((c) => ({ id: c.id, name: c.name })),
    postToChannel: async (userId, conversationId, text) => {
      const { message, memberIds } = await sendMessage(userId, conversationId, { text })
      publishToUsers(memberIds, { type: 'message.new', conversationId, message })
      publishToUsers(memberIds, { type: 'conversation.updated', conversationId })
    },
    // Dynamic: schedule → dispatch → runner → tools would otherwise be an eval-time cycle.
    claimManualRun: async (spaceId, name, startedBy, opts) => (await import('./schedule')).claimManualRun(spaceId, name, startedBy, new Date(), opts),
    createEntity,
    linkNodes: async ({ spaceId, from, to, relationship, note, createdBy }) => {
      const rows = await prisma.node.findMany({ where: { id: { in: [from, to] }, spaceId }, select: { id: true } })
      const found = new Set(rows.map((r) => r.id))
      const missing = [from, to].filter((id) => !found.has(id))
      if (missing.length) return `no such node in this space: ${missing.join(', ')}`
      await upsertLink({
        spaceId,
        sourceId: from,
        targetId: to,
        relationship,
        origin: 'manual',
        createdBy,
        metadata: note ? { note } : {},
      })
      return null
    },
  }
}

export interface AgentToolContext {
  principal: ContextPrincipal
  context: Context
  spaceId: string
  agentName: string
  brief: AgentBrief
  /**
   * The subset of `brief.connectors` a run_connector tool is offered for —
   * `kind: model` connectors are declared reach for the model, not runnable
   * (see runnableConnectorNames). Defaults to every declared name.
   */
  runnableConnectors?: readonly string[]
  /**
   * The named `actions:` each runnable connector declares (connectorActionsFor),
   * so the run_connector description can list them and the model can call one
   * by name with `args` instead of writing code. Optional: absent means the
   * description simply doesn't enumerate them.
   */
  connectorActions?: Readonly<Record<string, readonly ConnectorActionSummary[]>>
  /** The run these tools serve (chain parent, notification bookkeeping). */
  runId?: string
  /** The brief's author — where `to: author` notifications go. Defaults to the principal. */
  authorUserId?: string
  /** How deep in a run_agent chain this run is (root = 0). */
  chainDepth?: number
  /** Called with every note path write_context / append_context changed (or would have, under dry_run). */
  onWrite?: (path: string) => void
  deps?: Partial<AgentToolDeps>
}

const RUN_OUTPUT_CAP_CHARS = 12_000
const clip = (s: string, cap = RUN_OUTPUT_CAP_CHARS) => (s.length > cap ? s.slice(0, cap) + '\n…[truncated]' : s)

function str(v: unknown): string {
  return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v)
}

/** The revision `model` stamp for everything this agent writes: traceable, revertable. */
function agentModelStamp(agentName: string): string {
  return `agent:${agentName}`
}

/** A ResolvedContext for createEntity from the run's principal — same facts principalOf() would derive. */
function resolvedContextOf(principal: ContextPrincipal, spaceId: string): ResolvedContext {
  return {
    spaceId,
    ownerKey: SHARED_OWNER_KEY,
    scope: 'shared',
    isAdmin: principal.spaceAdmin,
    isPersonalSpace: false,
    actor: { id: principal.userId, name: principal.name, email: principal.email },
  }
}

export function agentTools(ctx: AgentToolContext): ToolHandler[] {
  const { principal, context, spaceId, brief } = ctx
  const deps: AgentToolDeps = { ...defaultDeps(), ...(ctx.deps ?? {}) }
  const stamp = agentModelStamp(ctx.agentName)
  const title = brief.title || ctx.agentName
  const href = agentPageHref(ctx.agentName)
  const authorId = ctx.authorUserId ?? principal.userId
  const dry = brief.dryRun
  const noteWritten = (path: string) => ctx.onWrite?.(path)
  const bytes = (s: string) => Buffer.byteLength(s, 'utf8')
  let notifies = 0
  let asks = 0

  const recipientsFor = async (to: 'author' | 'admins'): Promise<string[]> =>
    to === 'admins' ? await deps.spaceAdminUserIds(spaceId) : [authorId]

  const tools: ToolHandler[] = [
    {
      spec: {
        name: 'list_context',
        description:
          'List notes in the space context, optionally under one folder. Returns paths and titles. Use it to find where things live before reading or writing.',
        parameters: {
          type: 'object',
          properties: { folder: { type: 'string', description: 'Folder path like "reports" — omit for everything' } },
        },
      },
      describe: (a) => str(a.folder) || '(all)',
      run: async (a) => {
        const folder = str(a.folder).replace(/^\/+|\/+$/g, '')
        const { metas } = await visibleVault(principal, context)
        const rows = metas
          .filter((m) => !folder || m.path === `${folder}` || m.path.startsWith(`${folder}/`))
          .sort((x, y) => x.path.localeCompare(y.path))
        const shown = rows.slice(0, LIST_CAP)
        return [
          `${rows.length} note${rows.length === 1 ? '' : 's'}${rows.length > LIST_CAP ? ` (showing ${LIST_CAP})` : ''}`,
          ...shown.map((m) => `- ${m.path} — ${m.title}`),
        ].join('\n')
      },
    },
    {
      spec: {
        name: 'search_context',
        description: 'Search the space context by keyword. Returns the best-matching notes with a snippet each.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'integer', description: `1..${SEARCH_CAP}, default 10` },
          },
          required: ['query'],
        },
      },
      describe: (a) => str(a.query),
      run: async (a) => {
        const query = str(a.query).trim()
        if (!query) return 'error: query is required'
        const limit = Math.min(SEARCH_CAP, Math.max(1, Number(a.limit) || 10))
        const result = await searchContext(principal, context, query, {}, limit)
        if (result.hits.length === 0) return 'no matches'
        return result.hits
          .slice(0, limit)
          .map((h) => `- ${h.path} — ${h.title}${h.snippet ? `\n  ${h.snippet.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`)
          .join('\n')
      },
    },
    {
      spec: {
        name: 'read_context',
        description: 'Read one note by its path (e.g. "reports/weekly.md"). Returns the full markdown including frontmatter.',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
      describe: (a) => str(a.path),
      run: async (a) => {
        const path = str(a.path).trim()
        if (!path) return 'error: path is required'
        const content = await readVisible(principal, context, path)
        if (content === null) return 'error: no such note (or not visible to this agent)'
        return clip(content, READ_CAP_CHARS)
      },
    },
    {
      spec: {
        name: 'write_context',
        description:
          'Create or overwrite a note at a path with full markdown (frontmatter optional). Writes go through the same permission gate as a human edit; some folders may refuse. Never write under agents/.' +
          (dry ? ' THIS IS A DRY RUN: the write is recorded, not applied.' : ''),
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'e.g. "reports/weekly.md"' },
            content: { type: 'string', description: 'The complete note' },
          },
          required: ['path', 'content'],
        },
      },
      describe: (a) => str(a.path),
      run: async (a) => {
        const path = str(a.path).trim()
        const content = str(a.content)
        if (!path.endsWith('.md')) return 'error: path must end in .md'
        if (!content.trim()) return 'error: content is empty'
        if (dry) {
          noteWritten(path)
          return `DRY RUN — would write ${path} (${bytes(content)} bytes)`
        }
        const result = await deps.writeGated(principal, context, path, content, 'agent', stamp)
        if (result.status !== 'applied') return `error: write denied — ${result.reason}`
        noteWritten(result.path)
        return `written ${result.path}`
      },
    },
    {
      spec: {
        name: 'append_context',
        description:
          'Append a dated entry to a note\'s "## Log" section (creating it if absent). Good for journals and running records without rewriting the whole note.' +
          (dry ? ' THIS IS A DRY RUN: the append is recorded, not applied.' : ''),
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' }, text: { type: 'string' } },
          required: ['path', 'text'],
        },
      },
      describe: (a) => str(a.path),
      run: async (a) => {
        const path = str(a.path).trim()
        const text = str(a.text).trim()
        if (!path || !text) return 'error: path and text are required'
        if (dry) {
          noteWritten(path)
          return `DRY RUN — would append to ${path} (${bytes(text)} bytes)`
        }
        const result = await deps.appendLogGated(principal, context, path, text, 'agent', stamp)
        if (result.status !== 'applied') return `error: append denied — ${result.reason}`
        noteWritten(result.path)
        return `appended to ${result.path}`
      },
    },
  ]

  const runnable = ctx.runnableConnectors ?? brief.connectors
  if (runnable.length > 0) {
    const allowed = new Set(runnable)
    const actionLines = runnable
      .map((name) => {
        const actions = ctx.connectorActions?.[name] ?? []
        if (actions.length === 0) return null
        return `${name}: ${actions.map((a) => `${a.name}${a.description ? ` (${a.description})` : ''}`).join(', ')}`
      })
      .filter((line): line is string => line !== null)
    tools.push({
      spec: {
        name: 'run_connector',
        description:
          `Run one of this agent's declared connectors (${runnable.join(', ')}) — either a named action with \`args\`, or JavaScript in \`code\` (exactly one of the two). Code is the body of an async function with \`fetch\`, \`sql\`, \`mcp\`, \`env\`, \`visvine.crypto\` and \`visvine.state\` available; network is limited to the connector's hosts. Read the connector note (connectors/<name>.md) first for its documented API and env names.` +
          (actionLines.length > 0 ? ` Declared actions — ${actionLines.join('; ')}.` : ''),
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: `one of: ${runnable.join(', ')}` },
            code: { type: 'string', description: 'JavaScript to run (omit when passing action)' },
            action: { type: 'string', description: 'a declared action name (omit when passing code)' },
            args: { type: 'object', description: 'arguments for the action' },
          },
          required: ['name'],
        },
      },
      describe: (a) => `${str(a.name)}: ${str(a.action) ? `action ${str(a.action)}` : str(a.code).slice(0, 120)}`,
      run: async (a) => {
        const name = str(a.name).trim()
        const code = str(a.code)
        const action = str(a.action).trim()
        if (!allowed.has(name)) return `error: connector "${name}" is not declared in this agent's brief (or is a model connector, which is not runnable)`
        if ((code.trim().length > 0) === (action.length > 0)) return 'error: pass exactly one of code or action'
        try {
          const loaded = await loadConnector(principal, context, name)
          if (!loaded) return 'error: no such connector (or not visible to this agent)'
          const run = action
            ? { action, args: a.args !== null && typeof a.args === 'object' ? a.args : {} }
            : { code }
          const result = await executeConnectorScript(principal, context, spaceId, loaded, run)
          const rendered = result.value === undefined ? '' : clip(JSON.stringify(result.value, null, 2) ?? '')
          return [
            result.timedOut ? 'TIMED OUT' : result.ok ? 'ok' : `error: ${result.error?.message ?? 'unknown'}`,
            result.denials.length > 0 ? `denials:\n${result.denials.join('\n')}` : null,
            rendered ? `returned:\n${rendered}` : null,
            result.logs ? `logs:\n${clip(result.logs)}` : null,
          ]
            .filter(Boolean)
            .join('\n')
        } catch (e) {
          if (e instanceof ConnectorError) return `error (${e.code}): ${e.message}`
          throw e
        }
      },
    })
  }

  if (brief.tools.includes('web')) {
    tools.push({
      spec: {
        name: 'fetch_url',
        description: 'Fetch a public https page and return its text (truncated).',
        parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      },
      describe: (a) => str(a.url),
      run: (a) => fetchPublicText(str(a.url)),
    })
  }

  const sandbox = brief.tools.includes('sandbox') ? sandboxProvider() : null
  if (sandbox) {
    tools.push({
      spec: {
        name: 'run_code',
        description:
          'Run code on a disposable computer (no credentials, no network except package registries). Returns stdout/stderr and any files written to ./out. Save results you want to keep with write_context.',
        parameters: {
          type: 'object',
          properties: {
            language: { type: 'string', enum: ['python', 'node', 'bash'] },
            code: { type: 'string' },
          },
          required: ['language', 'code'],
        },
      },
      describe: (a) => `${str(a.language)}: ${str(a.code).slice(0, 120)}`,
      run: async (a) => {
        const language = str(a.language) as 'python' | 'node' | 'bash'
        const result = await sandbox.run({ language, code: str(a.code) })
        return [
          `exit ${result.exitCode}`,
          result.stdout ? `stdout:\n${clip(result.stdout)}` : null,
          result.stderr ? `stderr:\n${clip(result.stderr)}` : null,
          result.files.length ? `files:\n${result.files.map((f) => `- ${f.path} (${f.content.length} chars)`).join('\n')}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      },
    })
  }

  // ── People ─────────────────────────────────────────────────────────────────

  const channels = brief.tools.includes('messages')
  tools.push({
    spec: {
      name: 'notify',
      description:
        `Tell a person something now (a bell notification, emailed too). \`to\` is "author" (default — whoever wrote this brief) or "admins" (the space admins)` +
        (channels ? ', or "channel:<name>" to post the message into a space channel as the agent\'s author' : '') +
        `. At most ${NOTIFY_PER_RUN_CAP} per run — summarise, don't stream. Not for questions: use ask_human.`,
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: `plain text, ≤${NOTIFY_MESSAGE_MAX} chars` },
          to: { type: 'string', description: channels ? 'author | admins | channel:<name>' : 'author | admins' },
          title: { type: 'string', description: 'optional one-line title (defaults to the agent title)' },
        },
        required: ['message'],
      },
    },
    describe: (a) => `${str(a.to) || 'author'}: ${str(a.message).slice(0, 120)}`,
    run: async (a) => {
      const message = str(a.message).trim()
      if (!message) return 'error: message is required'
      if (message.length > NOTIFY_MESSAGE_MAX) return `error: message is longer than ${NOTIFY_MESSAGE_MAX} characters`
      if (notifies >= NOTIFY_PER_RUN_CAP) return `error: notify cap reached (${NOTIFY_PER_RUN_CAP} per run) — put the rest in your summary or a note`
      const to = (str(a.to).trim() || 'author').toLowerCase()
      const customTitle = str(a.title).trim().slice(0, NOTIFY_TITLE_MAX)
      if (to.startsWith('channel:')) {
        if (!channels) return 'error: posting to channels needs `tools: [messages]` in the brief'
        const channelName = to.slice('channel:'.length).trim().replace(/^#/, '')
        if (!channelName) return 'error: channel name is required (to: "channel:<name>")'
        const list = await deps.listChannels(principal.userId, spaceId)
        const channel = list.find((c) => c.name.toLowerCase() === channelName.toLowerCase())
        if (!channel) return `error: no channel named "${channelName}" (known: ${list.map((c) => c.name).join(', ') || 'none'})`
        notifies++
        const text = `${customTitle || title}: ${message}`
        if (dry) return `DRY RUN — would post to #${channel.name} (${bytes(text)} bytes)`
        try {
          await deps.postToChannel(principal.userId, channel.id, text)
        } catch (e) {
          return `error: could not post to #${channel.name} — ${e instanceof Error ? e.message : String(e)}`
        }
        return `posted to #${channel.name}`
      }
      if (to !== 'author' && to !== 'admins') return 'error: `to` must be author, admins' + (channels ? ' or channel:<name>' : '')
      notifies++
      const recipients = await recipientsFor(to)
      if (recipients.length === 0) return `error: nobody to notify (${to})`
      const { created } = await deps.notify(recipients, {
        spaceId,
        kind: 'agent_notify',
        title: customTitle || title,
        body: message,
        href,
      })
      return `notified ${to} (${created} recipient${created === 1 ? '' : 's'})`
    },
  })

  tools.push({
    spec: {
      name: 'ask_human',
      description:
        `Ask the author (or the admins) a question. It reaches them as a notification with a reply box; the answer does NOT arrive in this run — it wakes your NEXT run as a "reply" event whose payload holds the question and the reply. Ask, note what you are waiting on, and finish. At most ${ASK_PER_RUN_CAP} per run.`,
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: `plain text, ≤${ASK_QUESTION_MAX} chars` },
          to: { type: 'string', description: 'author (default) | admins' },
        },
        required: ['question'],
      },
    },
    describe: (a) => `${str(a.to) || 'author'}: ${str(a.question).slice(0, 120)}`,
    run: async (a) => {
      const question = str(a.question).trim()
      if (!question) return 'error: question is required'
      if (question.length > ASK_QUESTION_MAX) return `error: question is longer than ${ASK_QUESTION_MAX} characters`
      if (asks >= ASK_PER_RUN_CAP) return `error: ask_human cap reached (${ASK_PER_RUN_CAP} per run) — finish this run and wait for the answers`
      const to = (str(a.to).trim() || 'author').toLowerCase()
      if (to !== 'author' && to !== 'admins') return 'error: `to` must be author or admins'
      asks++
      const recipients = await recipientsFor(to)
      if (recipients.length === 0) return `error: nobody to ask (${to})`
      const { created } = await deps.notify(recipients, {
        spaceId,
        kind: 'agent_question',
        title: `${title} asks`,
        body: question,
        href,
      })
      return `asked ${to} (${created} recipient${created === 1 ? '' : 's'}) — the reply arrives as a "reply" event on a later run`
    },
  })

  // ── Chaining ───────────────────────────────────────────────────────────────

  if (brief.agents.length > 0) {
    const allowedAgents = new Set(brief.agents)
    const depth = ctx.chainDepth ?? 0
    tools.push({
      spec: {
        name: 'run_agent',
        description:
          `Start another agent of this space now (one of: ${brief.agents.join(', ')}). It runs on its own — this call returns its run id at once and does not wait. Chains are at most ${MAX_CHAIN_DEPTH} deep; the target must be active and idle.`,
        parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      },
      describe: (a) => str(a.name),
      run: async (a) => {
        const name = str(a.name).trim()
        if (!allowedAgents.has(name)) return `error: "${name}" is not in this brief's \`agents:\` list`
        if (name === ctx.agentName) return 'error: an agent cannot start itself'
        if (depth >= MAX_CHAIN_DEPTH) return `error: chain depth limit (${MAX_CHAIN_DEPTH}) reached — this run was itself started by run_agent`
        if (dry) return `DRY RUN — would start agent ${name}`
        const res = await deps.claimManualRun(spaceId, name, principal.userId, {
          chain: { parent: ctx.runId ?? 'unknown', depth: depth + 1 },
        })
        if (!res.ok) return `error (${res.code}): ${res.message}`
        res.dispatch?.catch(() => {})
        return `started agent ${name} — run ${res.runId}`
      },
    })
  }

  // ── Directory ──────────────────────────────────────────────────────────────

  if (brief.tools.includes('directory')) {
    tools.push({
      spec: {
        name: 'create_node',
        description:
          'Add a directory entity — a person, space (organisation), resource or event — with its context note. A "space" creates a real space inside this one (its record is the card), so search first. Refuses duplicates (the error names the existing node).',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['person', 'space', 'resource', 'event'] },
            name: { type: 'string' },
            description: { type: 'string', description: 'one line (role / tagline)' },
            tags: { type: 'array', items: { type: 'string' } },
            url: { type: 'string', description: 'website / link (space, resource)' },
          },
          required: ['type', 'name'],
        },
      },
      describe: (a) => `${str(a.type)} ${str(a.name)}`,
      run: async (a) => {
        const type = str(a.type).trim().toLowerCase()
        const name = str(a.name).trim()
        if (!type || !name) return 'error: type and name are required'
        const tags = Array.isArray(a.tags) ? a.tags.filter((t): t is string => typeof t === 'string') : []
        const description = str(a.description).trim()
        const url = str(a.url).trim()
        if (dry) return `DRY RUN — would create ${type} "${name}"`
        // Stamped like write_context: held to Freeze-for-AI, and the note it
        // creates never wakes this agent (no self-loops through create_node).
        const result = await deps.createEntity(resolvedContextOf(principal, spaceId), {
          type,
          name,
          tags,
          fields: { ...(description ? { subtitle: description } : {}), ...(url ? { url } : {}) },
          stamp: { origin: 'agent', model: stamp },
        })
        if (!result.ok) {
          return `error: ${result.error}${result.existingNodeId ? ` (existing node: ${result.existingNodeId}${result.existingPath ? `, note ${result.existingPath}` : ''})` : ''}`
        }
        if (result.notePath) noteWritten(result.notePath)
        return `created ${result.node.id}${result.notePath ? ` (note ${result.notePath})` : ''}${result.noteError ? ` — note not written: ${result.noteError}` : ''}`
      },
    })
    tools.push({
      spec: {
        name: 'link_nodes',
        description:
          'Connect two directory nodes by id (e.g. "person:jane-doe" → "space:halter"). `type` is the relationship word (default "related"); `note` is a short reason kept on the link.',
        parameters: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'source node id' },
            to: { type: 'string', description: 'target node id' },
            type: { type: 'string', description: 'relationship, e.g. works_at, invested_in, related' },
            note: { type: 'string' },
          },
          required: ['from', 'to'],
        },
      },
      describe: (a) => `${str(a.from)} → ${str(a.to)}${str(a.type) ? ` (${str(a.type)})` : ''}`,
      run: async (a) => {
        const from = str(a.from).trim()
        const to = str(a.to).trim()
        if (!from || !to) return 'error: from and to are required'
        if (from === to) return 'error: from and to must differ'
        const relationship = str(a.type).trim() || 'related'
        const note = str(a.note).trim().slice(0, 500) || null
        if (dry) return `DRY RUN — would link ${from} → ${to} (${relationship})`
        const problem = await deps.linkNodes({ spaceId, from, to, relationship, note, createdBy: principal.userId })
        return problem ? `error: ${problem}` : `linked ${from} → ${to} (${relationship})`
      },
    })
  }

  return tools
}
