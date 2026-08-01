/**
 * A fake "external API" for exercising the connectors feature end to end,
 * without pointing a connector at somebody's real Stripe account.
 *
 * It stands in for the third-party service an `alias: http` connector calls: it
 * demands an API key in a header (so you can prove `{{secret:NAME}}` is
 * interpolated server-side), and offers one route per interesting behaviour in
 * lib/connectors/http.ts — segment wildcards, query passing, request bodies,
 * timeouts, the 256 KB body cap, and refused redirects.
 *
 * Dev-only, guarded exactly like the rest of /api/dev: 404 unless both
 * NODE_ENV=development and ENABLE_DEV_AUTH=true. `/api/dev` is already in
 * middleware's PUBLIC_PATHS under that same flag, which is what lets the
 * connector's own fetch reach it without a session cookie.
 *
 * Seed the matching connector + secret with `pnpm db:connectors:demo`.
 */
import { isDevAuthEnabled, devAuthDisabledResponse } from '@/lib/dev-auth'

/**
 * Must match what `scripts/add-connector-demo.ts` stores as the SANDBOX_KEY
 * secret. Not exported: a route module may only export Next's own fields.
 */
const SANDBOX_KEY = process.env.CONNECTOR_SANDBOX_KEY || 'sk_sandbox_local_dev'

const KEY_HEADER = 'x-sandbox-key'
const MAX_SLEEP_MS = 60_000
const MAX_PAYLOAD_KB = 2_048

const WIDGETS = [
  { id: 'wid_001', name: 'Sprocket', status: 'active', price_cents: 4900, tags: ['metal'] },
  { id: 'wid_002', name: 'Flange', status: 'active', price_cents: 12900, tags: ['metal', 'heavy'] },
  { id: 'wid_003', name: 'Grommet', status: 'archived', price_cents: 250, tags: ['rubber'] },
  { id: 'wid_004', name: 'Bushing', status: 'active', price_cents: 1750, tags: ['rubber'] },
  { id: 'wid_005', name: 'Gasket', status: 'draft', price_cents: 900, tags: ['rubber', 'seal'] },
]

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** A bounded positive integer from a query param, or the fallback. */
function intParam(url: URL, name: string, fallback: number, max: number): number {
  const raw = Number(url.searchParams.get(name))
  if (!Number.isFinite(raw) || raw <= 0) return fallback
  return Math.min(max, Math.floor(raw))
}

async function handle(req: Request, segments: string[]): Promise<Response> {
  if (!isDevAuthEnabled()) return devAuthDisabledResponse()

  const url = new URL(req.url)
  const path = '/' + segments.join('/')
  const method = req.method.toUpperCase()

  // Stand-in for a real API key check. This is the whole point of the sandbox:
  // if the connector's `{{secret:SANDBOX_KEY}}` didn't resolve, you get a 401
  // here rather than a confusing success.
  if (req.headers.get(KEY_HEADER) !== SANDBOX_KEY) {
    return json(
      {
        error: 'unauthorized',
        message: `Send the API key as the ${KEY_HEADER} header. A connector supplies it from {{secret:SANDBOX_KEY}}.`,
      },
      401,
    )
  }

  // GET /widgets — collection, with ?q= and ?limit= so you can see query params
  // survive the trip through call_connector's `query` argument.
  if (method === 'GET' && path === '/widgets') {
    const q = (url.searchParams.get('q') || '').toLowerCase()
    const limit = intParam(url, 'limit', WIDGETS.length, WIDGETS.length)
    const matched = q
      ? WIDGETS.filter((w) => w.name.toLowerCase().includes(q) || w.tags.some((t) => t.includes(q)))
      : WIDGETS
    return json({ widgets: matched.slice(0, limit), total: matched.length, query: { q, limit } })
  }

  // GET /widgets/:id — the single-segment wildcard case (`GET /widgets/*`).
  if (method === 'GET' && segments[0] === 'widgets' && segments.length === 2) {
    const widget = WIDGETS.find((w) => w.id === segments[1])
    if (!widget) return json({ error: 'not_found', id: segments[1] }, 404)
    return json({ widget })
  }

  // POST /widgets — echoes the body back, so a write-shaped call proves the
  // request body reaches upstream intact.
  if (method === 'POST' && path === '/widgets') {
    const raw = await req.text()
    let parsed: unknown = null
    try {
      parsed = raw ? JSON.parse(raw) : null
    } catch {
      return json({ error: 'bad_json', received: raw.slice(0, 200) }, 400)
    }
    return json({ created: true, id: `wid_${String(WIDGETS.length + 1).padStart(3, '0')}`, echo: parsed }, 201)
  }

  // DELETE /widgets/:id — real here, but deliberately left OUT of the seeded
  // connector's allowlist, so call_connector refuses it before any request is
  // made. If you ever see this response, the allowlist isn't doing its job.
  if (method === 'DELETE' && segments[0] === 'widgets' && segments.length === 2) {
    return json({ deleted: segments[1], warning: 'the seeded connector should never have allowed this' })
  }

  // GET /whoami — echoes back the headers it received, key and all. The
  // redaction probe: the connector resolves SANDBOX_KEY into the request, this
  // reflects it, and lib/connectors/http.ts must scrub it back out of the
  // response before the model ever sees it. Expect "[redacted]".
  if (method === 'GET' && path === '/whoami') {
    return json({
      seen_headers: Object.fromEntries(req.headers),
      seen_query: Object.fromEntries(url.searchParams),
      note: `The ${KEY_HEADER} value above should read [redacted] by the time an agent sees it.`,
    })
  }

  // GET /slow?ms= — outlasts the connector's timeout_ms to prove the abort path.
  if (method === 'GET' && path === '/slow') {
    const ms = intParam(url, 'ms', 5_000, MAX_SLEEP_MS)
    await sleep(ms)
    return json({ slept_ms: ms })
  }

  // GET /big?kb= — over 256 KB exercises the response cap + `truncated: true`.
  if (method === 'GET' && path === '/big') {
    const kb = intParam(url, 'kb', 512, MAX_PAYLOAD_KB)
    return new Response('x'.repeat(kb * 1024), {
      headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
    })
  }

  // GET /redirect — the connector fetches with `redirect: 'error'`, so this
  // surfaces as an upstream error rather than silently following.
  if (method === 'GET' && path === '/redirect') {
    return new Response(null, { status: 302, headers: { location: '/api/dev/connector-sandbox/widgets' } })
  }

  return json(
    {
      error: 'not_found',
      method,
      path,
      routes: [
        'GET /widgets?q=&limit=',
        'GET /widgets/{id}',
        'POST /widgets',
        'DELETE /widgets/{id}',
        'GET /whoami',
        'GET /slow?ms=',
        'GET /big?kb=',
        'GET /redirect',
      ],
    },
    404,
  )
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: Request, ctx: Ctx) {
  return handle(req, (await ctx.params).path)
}
export async function POST(req: Request, ctx: Ctx) {
  return handle(req, (await ctx.params).path)
}
export async function PUT(req: Request, ctx: Ctx) {
  return handle(req, (await ctx.params).path)
}
export async function PATCH(req: Request, ctx: Ctx) {
  return handle(req, (await ctx.params).path)
}
export async function DELETE(req: Request, ctx: Ctx) {
  return handle(req, (await ctx.params).path)
}
