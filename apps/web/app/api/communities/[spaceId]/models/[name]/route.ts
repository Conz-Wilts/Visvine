import { NextRequest, NextResponse } from 'next/server'
import { bad, requireAgentsAccess } from '@/lib/agents/route'
import { readVisible, writeGated } from '@/lib/notes/contextService'
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import { validateCustomEndpoint } from '@/lib/agents/providers'
import { PROVIDERS } from '@/lib/agents/registry'
import { parseModel } from '@/lib/models/config'
import { describeModel, modelHistory, modelUsage } from '@/lib/models/service'

/**
 * One model, for its page: the note's facts, whether its key is stored, what
 * running on its provider cost (the last six months of the ledger), and who
 * ran on it (the recent run rows, named). Admins only, like the Usage section
 * — the bill is the space's, and a member reads the note on the Context tab.
 *
 * PATCH writes the settable fields back as a frontmatter merge, so the body,
 * unknown keys and key order survive and Raw stays the escape hatch.
 */
async function admin(spaceId: string) {
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  if (!ctx.resolved.isAdmin) return bad('Admins only', 403)
  return ctx
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string; name: string }> }) {
  const { spaceId, name: raw } = await params
  const ctx = await admin(spaceId)
  if (ctx instanceof Response) return ctx
  const name = decodeURIComponent(raw)
  const model = await describeModel(ctx.principal, ctx.resolved, name)
  if (!model) return bad('Model not found', 404)
  const provider = model.info?.provider ?? null
  const [usage, history] = provider
    ? await Promise.all([modelUsage(spaceId, provider), modelHistory(spaceId, provider)])
    : [{ months: [], currentMonth: new Date().toISOString() }, { runs: [], users: [] }]
  return NextResponse.json({ model, usage, history })
}

interface PatchBody {
  /** The off switch — false writes `enabled: false`, true deletes the key. */
  enabled?: unknown
  description?: unknown
  provider?: unknown
  /** `provider: custom` only: the OpenAI-compatible base URL. */
  baseUrl?: unknown
  /** The model id this note runs. */
  model?: unknown
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ spaceId: string; name: string }> }) {
  const { spaceId, name: raw } = await params
  const ctx = await admin(spaceId)
  if (ctx instanceof Response) return ctx
  const name = decodeURIComponent(raw)

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return bad('Invalid JSON body')
  }

  const current = await describeModel(ctx.principal, ctx.resolved, name)
  if (!current) return bad('Model not found', 404)
  const content = await readVisible(ctx.principal, ctx.resolved, current.path)
  if (content === null) return bad('Model not found', 404)
  const fm = parseFrontmatter(content)

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') return bad('Enabled must be true or false')
    if (body.enabled) delete fm.enabled
    else fm.enabled = false
  }
  if (body.description !== undefined) {
    const description = typeof body.description === 'string' ? body.description.trim() : ''
    if (description) fm.description = description
    else delete fm.description
  }
  if (body.provider !== undefined) {
    if (typeof body.provider !== 'string' || !PROVIDERS.some((p) => p.id === body.provider)) {
      return bad(`Provider must be one of ${PROVIDERS.map((p) => p.id).join(', ')}`)
    }
    fm.provider = body.provider
  }
  if (body.model !== undefined) {
    if (typeof body.model !== 'string') return bad('Model must be a string')
    if (body.model.trim()) fm.model = body.model.trim()
    else delete fm.model
  }
  // The URL is the one thing in a model note that decides where the space's
  // context goes, so it gets the same treatment as a connector's host:
  // shape-checked by the parser, routability-checked here before it is
  // written. Switching to a pinned provider drops it.
  if (body.baseUrl !== undefined) {
    if (typeof body.baseUrl !== 'string') return bad('Base URL must be a string')
    if (body.baseUrl.trim()) {
      try {
        fm.base_url = await validateCustomEndpoint(body.baseUrl)
      } catch (err) {
        return bad(err instanceof Error ? err.message : 'Invalid base URL')
      }
    } else {
      delete fm.base_url
    }
  }
  if (fm.provider !== 'custom') delete fm.base_url

  const parsed = parseModel(fm)
  if (!parsed.ok) return bad(parsed.error)
  const written = await writeGated(ctx.principal, ctx.resolved, current.path, joinFrontmatter(fm, splitFrontmatter(content).body))
  if (written.status === 'denied') return bad(written.reason, 403)
  return NextResponse.json({ ok: true })
}
