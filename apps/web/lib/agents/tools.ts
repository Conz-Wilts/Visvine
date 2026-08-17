/**
 * The tools a Space agent gets — the feature's ceiling, since capability lives
 * in OUR tool surface rather than a vendor's proprietary model feature.
 *
 * Every tool routes through the same layers a human or an MCP client uses —
 * `readVisible`/`visibleVault`/`searchContext` for reads, `writeGated` /
 * `appendLogGated` (origin `agent`) for writes, `loadConnector` →
 * `executeConnectorScript` for connectors — under the run's principal (the
 * brief's author). So an agent provably cannot exceed what its author can do,
 * `writeDenial` and Freeze-for-AI apply unchanged, and `agents/` itself is
 * frozen for AI: an agent can never rewrite itself or its siblings.
 *
 * Names mirror the MCP tools (list/search/read/write/append_context,
 * run_connector) so there is one vocabulary. Connector reach is DECLARED — only
 * the names in the brief's `connectors:` are offered — and `fetch_url` /
 * `run_code` appear only when the brief asks (`tools: [web]` / `[sandbox]`).
 */
import { RUN_OUTPUT_CAP_CHARS, toolFetchUrl } from '@/lib/connectors/agent'
import { ConnectorError } from '@/lib/connectors/config'
import { executeConnectorScript, loadConnector } from '@/lib/connectors/service'
import {
  appendLogGated,
  readVisible,
  searchContext,
  visibleVault,
  writeGated,
} from '@/lib/notes/contextService'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { Context } from '@/lib/notes/store'
import type { ToolHandler } from '@/lib/notes/toolLoop'
import type { AgentBrief } from './config'
import { sandboxProvider } from './sandbox'

const READ_CAP_CHARS = 40_000
const LIST_CAP = 400
const SEARCH_CAP = 20

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
}

const clip = (s: string, cap = RUN_OUTPUT_CAP_CHARS) => (s.length > cap ? s.slice(0, cap) + '\n…[truncated]' : s)

function str(v: unknown): string {
  return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v)
}

/** The revision `model` stamp for everything this agent writes: traceable, revertable. */
function agentModelStamp(agentName: string): string {
  return `agent:${agentName}`
}

export function agentTools(ctx: AgentToolContext): ToolHandler[] {
  const { principal, context, spaceId, brief } = ctx
  const stamp = agentModelStamp(ctx.agentName)

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
          'Create or overwrite a note at a path with full markdown (frontmatter optional). Writes go through the same permission gate as a human edit; some folders may refuse. Never write under agents/.',
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
        const result = await writeGated(principal, context, path, content, 'agent', stamp)
        return result.status === 'applied' ? `written ${result.path}` : `error: write denied — ${result.reason}`
      },
    },
    {
      spec: {
        name: 'append_context',
        description:
          'Append a dated entry to a note\'s "## Log" section (creating it if absent). Good for journals and running records without rewriting the whole note.',
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
        const result = await appendLogGated(principal, context, path, text, 'agent', stamp)
        return result.status === 'applied' ? `appended to ${result.path}` : `error: append denied — ${result.reason}`
      },
    },
  ]

  const runnable = ctx.runnableConnectors ?? brief.connectors
  if (runnable.length > 0) {
    const allowed = new Set(runnable)
    tools.push({
      spec: {
        name: 'run_connector',
        description: `Run JavaScript inside one of this agent's declared connectors (${runnable.join(', ')}). The code is the body of an async function with \`fetch\`, \`sql\`, \`mcp\` and \`env\` available; network is limited to the connector's hosts. Read the connector note (connectors/<name>.md) first for its documented API and env names.`,
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: `one of: ${runnable.join(', ')}` },
            code: { type: 'string' },
          },
          required: ['name', 'code'],
        },
      },
      describe: (a) => `${str(a.name)}: ${str(a.code).slice(0, 120)}`,
      run: async (a) => {
        const name = str(a.name).trim()
        const code = str(a.code)
        if (!allowed.has(name)) return `error: connector "${name}" is not declared in this agent's brief (or is a model connector, which is not runnable)`
        try {
          const loaded = await loadConnector(principal, context, name)
          if (!loaded) return 'error: no such connector (or not visible to this agent)'
          const result = await executeConnectorScript(principal, context, spaceId, loaded, code)
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
      run: (a) => toolFetchUrl(str(a.url)),
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

  return tools
}
