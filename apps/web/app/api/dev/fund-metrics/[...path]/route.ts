/**
 * A fake "fund administrator API" for exercising connectors end to end with
 * data an actual space would care about: fund-level metrics (committed
 * capital, called, DPI/TVPI/IRR), the position list behind them, and a
 * quarterly time series.
 *
 * Stands in for a real fund-admin vendor: it demands an API key header, so a
 * successful call proves `{{secret:FUND_METRICS_KEY}}` was interpolated
 * server-side inside the sandbox and never appeared in the note.
 *
 * Dev-only, guarded like the rest of /api/dev: 404 unless NODE_ENV=development
 * and ENABLE_DEV_AUTH=true. `/api/dev` is in the proxy's PUBLIC_PATHS under
 * that flag, which is what lets the sandbox reach it without a session cookie.
 *
 * Seed the matching connector + context note + secret with
 * `pnpm db:connectors:funds`.
 */
import { isDevAuthEnabled, devAuthDisabledResponse } from '@/lib/dev-auth'

/** Must match what `scripts/seed/connectors.ts` stores as FUND_METRICS_KEY. */
const FUND_KEY = process.env.CONNECTOR_FUND_METRICS_KEY || 'sk_fundmetrics_local_dev'

const KEY_HEADER = 'x-fund-key'

interface Fund {
  id: string
  name: string
  vintage: number
  currency: string
  strategy: string
  committed_usd: number
  called_usd: number
  distributed_usd: number
  nav_usd: number
  dpi: number
  tvpi: number
  net_irr_pct: number
  as_of: string
}

const FUNDS: Fund[] = [
  {
    id: 'fund_bb3',
    name: 'Kereru Fund III',
    vintage: 2019,
    currency: 'USD',
    strategy: 'Early-stage venture',
    committed_usd: 250_000_000,
    called_usd: 212_500_000,
    distributed_usd: 96_000_000,
    nav_usd: 431_000_000,
    dpi: 0.45,
    tvpi: 2.48,
    net_irr_pct: 27.4,
    as_of: '2026-06-30',
  },
  {
    id: 'fund_bb4',
    name: 'Kereru Fund IV',
    vintage: 2022,
    currency: 'USD',
    strategy: 'Early-stage venture',
    committed_usd: 400_000_000,
    called_usd: 148_000_000,
    distributed_usd: 0,
    nav_usd: 189_500_000,
    dpi: 0.0,
    tvpi: 1.28,
    net_irr_pct: 11.9,
    as_of: '2026-06-30',
  },
  {
    id: 'fund_bbg1',
    name: 'Kereru Growth I',
    vintage: 2023,
    currency: 'USD',
    strategy: 'Growth',
    committed_usd: 300_000_000,
    called_usd: 81_000_000,
    distributed_usd: 0,
    nav_usd: 92_400_000,
    dpi: 0.0,
    tvpi: 1.14,
    net_irr_pct: 8.2,
    as_of: '2026-06-30',
  },
]

interface Position {
  fund_id: string
  company: string
  sector: string
  invested_usd: number
  fair_value_usd: number
  ownership_pct: number
  status: 'active' | 'exited' | 'written_off'
}

const POSITIONS: Position[] = [
  { fund_id: 'fund_bb3', company: 'Lumenfold', sector: 'Software', invested_usd: 18_000_000, fair_value_usd: 214_000_000, ownership_pct: 3.1, status: 'active' },
  { fund_id: 'fund_bb3', company: 'Paddock Sense', sector: 'Agtech', invested_usd: 12_500_000, fair_value_usd: 88_000_000, ownership_pct: 7.4, status: 'active' },
  { fund_id: 'fund_bb3', company: 'Harbour Pay', sector: 'Fintech', invested_usd: 9_000_000, fair_value_usd: 41_500_000, ownership_pct: 5.2, status: 'active' },
  { fund_id: 'fund_bb3', company: 'Skylark Drones', sector: 'Drones', invested_usd: 7_500_000, fair_value_usd: 0, ownership_pct: 0, status: 'written_off' },
  { fund_id: 'fund_bb4', company: 'Cookpath AI', sector: 'Software', invested_usd: 22_000_000, fair_value_usd: 61_000_000, ownership_pct: 9.8, status: 'active' },
  { fund_id: 'fund_bb4', company: 'Inferly', sector: 'AI', invested_usd: 15_000_000, fair_value_usd: 74_000_000, ownership_pct: 6.6, status: 'active' },
  { fund_id: 'fund_bbg1', company: 'Green Pasture Foods', sector: 'Foodtech', invested_usd: 20_000_000, fair_value_usd: 24_800_000, ownership_pct: 11.2, status: 'active' },
]

/** Quarterly NAV/TVPI series per fund — enough points to chart or aggregate. */
const SERIES: Record<string, Array<{ quarter: string; nav_usd: number; tvpi: number }>> = {
  fund_bb3: [
    { quarter: '2025-Q3', nav_usd: 388_000_000, tvpi: 2.21 },
    { quarter: '2025-Q4', nav_usd: 402_500_000, tvpi: 2.33 },
    { quarter: '2026-Q1', nav_usd: 419_000_000, tvpi: 2.41 },
    { quarter: '2026-Q2', nav_usd: 431_000_000, tvpi: 2.48 },
  ],
  fund_bb4: [
    { quarter: '2025-Q3', nav_usd: 151_000_000, tvpi: 1.12 },
    { quarter: '2025-Q4', nav_usd: 164_800_000, tvpi: 1.18 },
    { quarter: '2026-Q1', nav_usd: 177_200_000, tvpi: 1.23 },
    { quarter: '2026-Q2', nav_usd: 189_500_000, tvpi: 1.28 },
  ],
  fund_bbg1: [
    { quarter: '2025-Q3', nav_usd: 71_000_000, tvpi: 1.02 },
    { quarter: '2025-Q4', nav_usd: 79_300_000, tvpi: 1.06 },
    { quarter: '2026-Q1', nav_usd: 86_100_000, tvpi: 1.1 },
    { quarter: '2026-Q2', nav_usd: 92_400_000, tvpi: 1.14 },
  ],
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

async function handle(req: Request, segments: string[]): Promise<Response> {
  if (!isDevAuthEnabled()) return devAuthDisabledResponse()

  const url = new URL(req.url)
  const path = '/' + segments.join('/')
  const method = req.method.toUpperCase()

  // The whole point of the key check: if `{{secret:FUND_METRICS_KEY}}` didn't
  // resolve inside the sandbox, you get a 401 here rather than a quiet success.
  if (req.headers.get(KEY_HEADER) !== FUND_KEY) {
    return json(
      {
        error: 'unauthorized',
        message: `Send the API key as the ${KEY_HEADER} header. A connector supplies it from {{secret:FUND_METRICS_KEY}}.`,
      },
      401,
    )
  }

  // GET /funds — the fund list with headline metrics. ?vintage= filters.
  if (method === 'GET' && path === '/funds') {
    const vintage = Number(url.searchParams.get('vintage'))
    const funds = Number.isFinite(vintage) && vintage > 0 ? FUNDS.filter((f) => f.vintage === vintage) : FUNDS
    return json({ funds, total: funds.length, as_of: '2026-06-30' })
  }

  // GET /funds/{id}/metrics — one fund's headline metrics.
  if (method === 'GET' && segments[0] === 'funds' && segments[2] === 'metrics' && segments.length === 3) {
    const fund = FUNDS.find((f) => f.id === segments[1])
    if (!fund) return json({ error: 'not_found', id: segments[1] }, 404)
    return json({ metrics: fund })
  }

  // GET /funds/{id}/positions — the holdings behind those metrics.
  if (method === 'GET' && segments[0] === 'funds' && segments[2] === 'positions' && segments.length === 3) {
    const positions = POSITIONS.filter((p) => p.fund_id === segments[1])
    if (positions.length === 0 && !FUNDS.some((f) => f.id === segments[1])) {
      return json({ error: 'not_found', id: segments[1] }, 404)
    }
    return json({ fund_id: segments[1], positions, total: positions.length })
  }

  // GET /funds/{id}/series — quarterly NAV/TVPI history.
  if (method === 'GET' && segments[0] === 'funds' && segments[2] === 'series' && segments.length === 3) {
    const series = SERIES[segments[1]]
    if (!series) return json({ error: 'not_found', id: segments[1] }, 404)
    return json({ fund_id: segments[1], series })
  }

  // GET /whoami — reflects the key back, so redaction can be proven.
  if (method === 'GET' && path === '/whoami') {
    return json({
      seen_headers: Object.fromEntries(req.headers),
      note: `The ${KEY_HEADER} value above should read [redacted] by the time an agent sees it.`,
    })
  }

  return json(
    {
      error: 'not_found',
      method,
      path,
      routes: [
        'GET /funds?vintage=',
        'GET /funds/{id}/metrics',
        'GET /funds/{id}/positions',
        'GET /funds/{id}/series',
        'GET /whoami',
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
