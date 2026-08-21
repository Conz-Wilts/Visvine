/**
 * The connector creation agent — "describe it and it builds the note".
 *
 * A server-side tool loop (lib/notes/ai.ts chatWithTools, the same
 * OpenAI-compatible backend as every other AI pass) with four tools: fetch a
 * public docs page, read/write the connector note, and run a probe script in
 * the connector's isolate. Everything flows through the SAME layers a human
 * admin or an MCP agent uses — writeGated for the note, executeConnectorScript
 * for runs — so the agent can't do anything the console can't.
 *
 * Secret VALUES never enter this loop: the agent writes `{{secret:NAME}}`
 * references and reports which names an admin must store. Probes only make
 * sense once secrets are stored, and the loop is told which are.
 */
import prisma from '@/lib/prisma'
import { aiConfigured, chatWithTools, type ToolSpec } from '@/lib/notes/ai'
import { runToolLoop, type ChatFn, type ToolHandler } from '@/lib/notes/toolLoop'
import { readVisible, writeGated } from '@/lib/notes/contextService'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import type { Context } from '@/lib/notes/store'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import { ConnectorError, parseConnectorPerimeter, perimeterSecretRefs } from './config'
import { executeConnectorScript, loadConnector } from './service'
import { fetchPublicText } from './publicFetch'

export type AgentEvent =
  | { type: 'assistant'; text: string }
  | { type: 'tool'; tool: string; detail: string }
  | { type: 'done'; summary: string; connector: string | null }
  | { type: 'error'; message: string }

const MAX_TURNS = 16
export const RUN_OUTPUT_CAP_CHARS = 12_000
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

const SYSTEM_PROMPT = `You build "connectors" — notes that let AI agents call an external service by writing JavaScript in a sandboxed isolate. You are given a description of what to connect; produce a working connector note.

A connector is a markdown note at connectors/<name>.md. Its YAML frontmatter declares the security perimeter; its body teaches agents how to call the service in JavaScript. Example:

---
type: connector
title: "Stripe"
description: "Stripe billing account"
hosts:
  - api.stripe.com
env:
  STRIPE_KEY: "{{secret:STRIPE_KEY}}"
timeout_ms: 30000
---
Stripe billing. List customers:

    const res = await fetch('https://api.stripe.com/v1/customers', {
      headers: { Authorization: \`Bearer \${env.STRIPE_KEY}\` },
    })
    return JSON.parse(res.body).data

Customers, charges and invoices are readable. Amounts are in cents.

The runtime, exactly:
- Code is the body of an async function. \`return\` the answer; top-level await works.
- \`fetch(url, init)\` resolves to { status, ok, headers, body, truncated, hops }. \`body\` is a STRING — call JSON.parse yourself; there is no .json(). Redirects are NOT followed by default; a 3xx comes back with \`location\`. Pass \`follow: n\` (1..3) in init to follow, each hop re-checked against hosts/allow.
- \`sql(dsn, query)\` runs ONE read-only Postgres/MySQL statement, e.g. \`await sql(env.DATABASE_URL, 'select count(*) from users')\`.
- \`mcp(url).listTools()\` and \`mcp(url).callTool(name, args)\` for MCP servers.
- \`env\` holds the connector's values. \`console.log\` is captured.
- \`visvine.crypto\` for signing: \`hmac(alg, key, data, { keyEncoding?, encoding? })\` (alg sha256|sha1|sha512; encodings hex|base64), \`hash(alg, data)\`, \`randomHex(n)\`, \`base64.encode(s)\` / \`base64.decode(s)\`, \`timingSafeEqual(a, b)\`, and \`sigv4({ accessKeyEnv, secretEnv, sessionTokenEnv?, region, service, method, url, headers?, body? })\` → { headers } for AWS — it reads the keys from env by NAME (e.g. accessKeyEnv: 'AWS_ACCESS_KEY_ID'), so pass the returned headers straight to fetch. All async; strings in and out.
- \`visvine.state.get(key)\` / \`visvine.state.set(key, value)\` remember small values between runs (cursors, etags; 64KB a value, 100 keys; set null to clear).
- Optional \`actions:\` in the frontmatter names fixed entry points: \`actions: { list_customers: { description: "...", params: { limit: { type: "integer" } }, code: "const r = await fetch(...); return JSON.parse(r.body)" } }\`. Action code sees \`args\` (frozen). Callers run them by name instead of writing code — prefer declaring the common calls as actions.
- There is NO filesystem, no process, no require/import, no shell, and no curl. \`Promise.all\` works if you want calls to overlap.

Rules:
- hosts: bare hostnames (or host:port), written literally. The isolate can ONLY reach these. Include every host the code needs (API host, auth host).
- env: values may be literals or {{secret:NAME}} references (UPPER_SNAKE names). NEVER write a real credential value anywhere — if the service needs a key, reference a secret and tell the admin to store it.
- Optional allow: list of "METHOD /path" rules (trailing * = prefix). These ARE enforced on every call, including HTTPS. Omit for host-gated only.
- Optional identity: only when the upstream applies PER-USER permissions and has agreed to verify an assertion from us. Shape: \`identity: { audience: <what the upstream checks>, secret: "{{secret:NAME}}", hosts: [only these], ttl_s: 120 }\`. The RUNTIME signs a short-lived statement naming whoever triggered the run and stamps it on matching requests — your code cannot read the key, set that header, or choose the name, which is exactly what makes the upstream able to trust it. Omit it for every ordinary connector; a service that authenticates only the caller does not want it.
- The body is the ONLY documentation agents get. Write working example code using the env var names, list useful endpoints/tables, note formats and gotchas. Be concise and concrete.

Workflow:
1. If a docs/OpenAPI URL is given or obvious, fetch_url it to learn real endpoints and auth. Don't guess URLs wildly — one or two fetches at most.
2. write_connector the note. Fix and rewrite if it reports errors.
3. The write result says which referenced secrets are stored. If ALL are stored (or none are needed), probe with run_connector (a cheap read-only call from your docs) and fix the note until a probe succeeds. If secrets are missing, skip probing.
4. Finish with a short plain-text summary: what the connector does, whether a probe succeeded, and exactly which secret names the admin still has to store (if any). No markdown headings.`

const TOOLS: ToolSpec[] = [
  {
    name: 'fetch_url',
    description: 'Fetch a public https page (API docs, an OpenAPI spec). Returns the text, truncated.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Absolute https URL' } },
      required: ['url'],
    },
  },
  {
    name: 'write_connector',
    description:
      'Write the connector note (full markdown, frontmatter included) to connectors/<name>.md. Validates first; returns parse errors, warnings, and which referenced secrets are stored.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Connector name — lowercase letters, digits, - and _' },
        content: { type: 'string', description: 'The complete note: --- frontmatter --- then the docs body' },
      },
      required: ['name', 'content'],
    },
  },
  {
    name: 'read_connector',
    description: 'Read back the current note at connectors/<name>.md and its parse status.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'run_connector',
    description:
      "Run JavaScript in the connector's isolate — network limited to its hosts, values available as `env`. Use to probe that the connector works.",
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        code: {
          type: 'string',
          description:
            'e.g. const r = await fetch("https://api…", { headers: { Authorization: `Bearer ${env.API_KEY}` } }); return JSON.parse(r.body)',
        },
      },
      required: ['name', 'code'],
    },
  },
]

/** Which of these secret names are stored for the space — names only. */
async function storedSecretNames(spaceId: string, names: string[]): Promise<Set<string>> {
  if (names.length === 0) return new Set()
  const rows = await prisma.connectorSecret.findMany({
    where: { spaceId, name: { in: names } },
    select: { name: true },
  })
  return new Set(rows.map((r) => r.name))
}

interface AgentContext {
  principal: ContextPrincipal
  context: Context
  spaceId: string
}

/**
 * Fetch a public https page for an agent — SSRF-gated per hop, capped. Shared
 * with Space agents' `fetch_url` tool (lib/agents/tools.ts). The gate itself
 * lives in ./publicFetch so tests can run it without this module's DB imports.
 */
export async function toolFetchUrl(rawUrl: string): Promise<string> {
  return fetchPublicText(rawUrl)
}

async function toolWriteConnector(ctx: AgentContext, name: string, content: string): Promise<string> {
  if (!NAME_RE.test(name)) return 'error: bad name — lowercase letters, digits, - and _'
  const fm = parseFrontmatter(content)
  if (typeof fm.type !== 'string' || fm.type.trim().toLowerCase() !== 'connector') {
    return 'error: frontmatter must include `type: connector`'
  }
  const parsed = parseConnectorPerimeter(fm)
  if (!parsed.ok) return `error: ${parsed.error}`

  const written = await writeGated(ctx.principal, ctx.context, `connectors/${name}.md`, content)
  if (written.status === 'denied') return `error: write denied — ${written.reason}`

  const secrets = perimeterSecretRefs(parsed.perimeter)
  const stored = await storedSecretNames(ctx.spaceId, secrets)
  const secretLines = secrets.map((s) => `${s}: ${stored.has(s) ? 'stored' : 'NOT STORED'}`)
  return [
    `written to connectors/${name}.md`,
    `hosts: ${parsed.perimeter.hosts.join(', ') || '(none — no network)'}`,
    secrets.length > 0 ? `secrets — ${secretLines.join(', ')}` : 'secrets — none referenced',
    ...parsed.warnings.map((w) => `warning: ${w}`),
  ].join('\n')
}

async function toolReadConnector(ctx: AgentContext, name: string): Promise<string> {
  if (!NAME_RE.test(name)) return 'error: bad name'
  const content = await readVisible(ctx.principal, ctx.context, `connectors/${name}.md`)
  if (content === null) return 'error: no such connector'
  const parsed = parseConnectorPerimeter(parseFrontmatter(content))
  return `${parsed.ok ? 'parses ok' : `INVALID: ${parsed.error}`}\n---\n${content}`
}

async function toolRunConnector(ctx: AgentContext, name: string, code: string): Promise<string> {
  try {
    const loaded = await loadConnector(ctx.principal, ctx.context, name)
    if (!loaded) return 'error: no such connector'
    const result = await executeConnectorScript(ctx.principal, ctx.context, ctx.spaceId, loaded, code)
    const clip = (s: string) =>
      s.length > RUN_OUTPUT_CAP_CHARS ? s.slice(0, RUN_OUTPUT_CAP_CHARS) + '\n…[truncated]' : s
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
}

/** Bind the four tools to a context; `onWritten` tracks the last note written. */
function toolHandlers(ctx: AgentContext, onWritten: (name: string) => void): ToolHandler[] {
  const spec = (name: string) => TOOLS.find((t) => t.name === name)!
  return [
    {
      spec: spec('fetch_url'),
      describe: (args) => String(args.url ?? ''),
      run: (args) => toolFetchUrl(String(args.url ?? '')),
    },
    {
      spec: spec('write_connector'),
      describe: (args) => String(args.name ?? ''),
      run: async (args) => {
        const result = await toolWriteConnector(ctx, String(args.name ?? ''), String(args.content ?? ''))
        if (result.startsWith('written')) onWritten(String(args.name))
        return result
      },
    },
    {
      spec: spec('read_connector'),
      describe: (args) => String(args.name ?? ''),
      run: (args) => toolReadConnector(ctx, String(args.name ?? '')),
    },
    {
      spec: spec('run_connector'),
      describe: (args) => `${args.name}: ${String(args.code ?? '').slice(0, 120)}`,
      run: (args) => toolRunConnector(ctx, String(args.name ?? ''), String(args.code ?? '')),
    },
  ]
}

/**
 * Run the creation loop, emitting progress events as it goes. Resolves when
 * the agent finishes (or the turn budget runs out) — the final 'done'/'error'
 * event is also emitted before resolving. `chatFn` exists for tests: the loop
 * mechanics run against a scripted model, no API key involved.
 */
export async function runConnectorAgent(
  ctx: AgentContext,
  prompt: string,
  onEvent: (event: AgentEvent) => void,
  chatFn: ChatFn = chatWithTools,
): Promise<void> {
  if (chatFn === chatWithTools && !aiConfigured()) {
    onEvent({ type: 'error', message: 'AI is not configured on this server' })
    return
  }

  let lastWritten: string | null = null
  const result = await runToolLoop({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    tools: toolHandlers(ctx, (name) => {
      lastWritten = name
    }),
    maxTurns: MAX_TURNS,
    chatFn,
    onEvent: (event) => {
      if (event.type === 'assistant') onEvent({ type: 'assistant', text: event.text })
      else if (event.type === 'tool') onEvent({ type: 'tool', tool: event.tool, detail: event.detail })
    },
  })

  switch (result.reason) {
    case 'error':
      onEvent({ type: 'error', message: result.error?.message ?? 'AI request failed' })
      return
    case 'finished':
      onEvent({
        type: 'done',
        summary: result.finalText ?? 'Finished, but the model gave no summary.',
        connector: lastWritten,
      })
      return
    default:
      onEvent({
        type: 'done',
        summary: 'Ran out of turns. The last written note (if any) is saved — check its page.',
        connector: lastWritten,
      })
  }
}
