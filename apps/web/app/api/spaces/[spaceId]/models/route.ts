import { NextRequest, NextResponse } from 'next/server'
import { requireAgentsAccess } from '@/lib/agents/route'
import { spaceModels } from '@/lib/agents/spaceModels'
import { localRuntimesEnabled } from '@/lib/agents/local'

/**
 * The space's models — every parseable note under models/ (and, until
 * `db:models:migrate` has run, the legacy `kind: model` connectors), with
 * whether each can run and why not. Any member may read it: a member authors
 * briefs and needs to know what they will run on, and the list carries names
 * and booleans only — the key never leaves the secret store. `canManage` says
 * whether the caller is an admin; every write behind Add and Manage gates
 * itself, so this is only what the dialog shows.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const models = await spaceModels(spaceId)
  return NextResponse.json({
    canManage: ctx.resolved.isAdmin,
    // Which of a member's own plans this deployment lets the desktop app run
    // on — the kill switch, read here so the dialog and the brief's picker
    // agree (lib/agents/local.ts).
    localRuntimes: localRuntimesEnabled(),
    models: models.map((m) => ({
      name: m.name,
      path: m.path,
      title: m.title,
      recipe: m.recipe,
      provider: m.provider.id,
      providerLabel: m.provider.label,
      modelId: m.modelId,
      ref: m.ref,
      enabled: m.enabled,
      keyStored: m.keyStored,
      keyFrom: m.keyFrom ?? null,
      sharedFrom: m.sharedFrom ?? null,
      problem: m.problem,
      legacy: !m.path.startsWith('models/'),
    })),
  })
}
