// The role-aware clean pass behind the MCP clean_context tool — the DB half of
// lib/notes/shared/clean.ts. Reuses the review agent's pure checks
// (shared/review.ts) unchanged and scopes their output to the caller's reach:
// a MEMBER cleans the notes they authored (SpaceNote.createdBy) inside the
// paths they can write; an ADMIN or personal-space owner cleans everything
// under the target. The tool never rewrites content itself beyond the review
// allow-list — judgment work comes back as a worklist for the calling agent.
//
// Unlike reviewRun (which reads the raw corpus and writes as the system
// actor), this pass reads through the VISIBILITY LENS (a member's analysis
// must not leak restricted notes) and applies fixes AS THE CALLER, origin
// 'maintenance', so revision history shows who ran the clean.

import prisma from '@/lib/prisma'
import * as store from './store'
import type { Context } from './store'
import { visibleVault, writeDenialFull, writeDenial, lockedDenial } from './contextService'
import { logAudit } from './audit'
import { canRemove, type ResolvedContext } from './resolve'
import { applyAutoFix, buildReviewReport, DEFAULT_THRESHOLDS, type AutoFix } from './shared/review'
import {
  buildCleanScope,
  buildWorklist,
  filterCleanFixes,
  folderStats,
  scopeIssues,
  type CleanRole,
  type CleanScope,
  type FolderStructure,
  type WorklistGroup,
} from './shared/clean'
import { isLockedPath } from './shared/authz'
import type { ContextPrincipal } from './shared/contextTypes'

export interface CleanOptions {
  role: CleanRole
  targetPath?: string
  mode: 'light' | 'full'
  limit: number
}

export interface CleanAnalysis {
  role: CleanRole
  mode: 'light' | 'full'
  target_path: string
  analyzed_notes: number
  in_scope_notes: number
  safe_fixes: { count: number; sample: AutoFix[]; apply_with: string }
  worklist: WorklistGroup[]
  structure?: FolderStructure
  truncated?: boolean
  next_steps: string
}

/** Full mode's duplicate check is O(n²)-flavoured — bound it for the 60s route budget. */
const FULL_MODE_NOTE_CAP = 1500

async function ownedPathSet(p: ContextPrincipal, context: Context): Promise<Set<string>> {
  const rows = await prisma.contextNote.findMany({
    where: {
      spaceId: context.spaceId,
      ownerKey: context.ownerKey,
      deletedAt: null,
      createdBy: p.userId,
    },
    select: { path: true },
  })
  return new Set(rows.map((r) => r.path))
}

async function scopeFor(p: ContextPrincipal, context: Context, opts: CleanOptions): Promise<CleanScope> {
  return buildCleanScope({
    role: opts.role,
    ownedPaths: opts.role === 'member' ? await ownedPathSet(p, context) : undefined,
    targetPath: opts.targetPath,
    canWrite: (path) => writeDenial(p, context, path) === null,
  })
}

interface AnalysisInternals {
  analysis: CleanAnalysis
  fixes: AutoFix[]
  contentByPath: Map<string, string>
}

async function analyze(
  p: ContextPrincipal,
  context: Context,
  opts: CleanOptions,
): Promise<AnalysisInternals> {
  const scope = await scopeFor(p, context, opts)
  const { raws, metas } = await visibleVault(p, context)

  // Full mode gets expensive with the corpus size; cap deterministically and
  // say so, rather than blowing the MCP route's 60s budget.
  let analyzedRaws = raws
  let analyzedMetas = metas
  let truncated = false
  if (opts.mode === 'full' && metas.length > FULL_MODE_NOTE_CAP) {
    const keep = new Set(
      [...metas].sort((a, b) => a.path.localeCompare(b.path)).slice(0, FULL_MODE_NOTE_CAP).map((m) => m.path),
    )
    analyzedMetas = metas.filter((m) => keep.has(m.path))
    analyzedRaws = raws.filter((r) => keep.has(r.path))
    truncated = true
  }

  const report = buildReviewReport({
    raws: analyzedRaws,
    metas: analyzedMetas,
    now: Date.now(),
    thresholds: DEFAULT_THRESHOLDS,
    mode: opts.mode,
    // Locked folders AND out-of-scope notes are "frozen": the fixes that come
    // back are exactly the ones this caller may apply.
    frozen: (path) => isLockedPath(p.access.locked, path) || !scope.inScope(path),
  })
  const fixes = filterCleanFixes(report.autoFixes)
  const issues = scopeIssues(report.issues, scope)

  const analysis: CleanAnalysis = {
    role: opts.role,
    mode: opts.mode,
    target_path: opts.targetPath || '(everything you can reach)',
    analyzed_notes: analyzedMetas.length,
    in_scope_notes: analyzedMetas.filter((m) => scope.inScope(m.path)).length,
    safe_fixes: {
      count: fixes.length,
      sample: fixes.slice(0, opts.limit),
      apply_with: "clean_context with action:'apply_fixes' applies all of these mechanically",
    },
    worklist: buildWorklist(issues, opts.limit),
    ...(truncated ? { truncated: true } : {}),
    next_steps:
      fixes.length || issues.length
        ? "Run action:'apply_fixes' for the safe fixes, then work the worklist with read/edit/append/move_context, then re-analyze to confirm."
        : 'Nothing to clean in your scope — the context is in good shape.',
  }
  // Structure data is for whoever can act on the whole target — admins and
  // personal-space owners. The agent reasons over it; nothing is applied here.
  if (opts.role !== 'member') {
    const folders = (await store.listFolders(context)).filter(
      (f) => !opts.targetPath || f === opts.targetPath || f.startsWith(`${opts.targetPath}/`),
    )
    analysis.structure = folderStats(analyzedMetas, folders)
  }
  return { analysis, fixes, contentByPath: new Map(analyzedRaws.map((r) => [r.path, r.content])) }
}

export async function runClean(
  p: ContextPrincipal,
  context: Context,
  opts: CleanOptions,
): Promise<CleanAnalysis> {
  return (await analyze(p, context, opts)).analysis
}

export interface ApplyResult {
  applied: number
  skipped: Array<{ path: string; reason: string }>
  remaining_issue_counts: Record<string, number>
}

/**
 * Apply the safe allow-listed fixes from a fresh analysis, attributed to the
 * CALLER with origin 'maintenance' — a deliberate divergence from reviewRun's
 * system actor, so history answers "who cleaned this".
 */
export async function applyCleanFixes(
  p: ContextPrincipal,
  context: Context,
  opts: CleanOptions,
): Promise<ApplyResult> {
  const { analysis, fixes, contentByPath } = await analyze(p, context, opts)
  let applied = 0
  const skipped: Array<{ path: string; reason: string }> = []
  for (const fix of fixes) {
    const current = contentByPath.get(fix.path)
    if (current === undefined) continue
    // Belt and braces: the frozen callback scoped the fixes already, but the
    // replica block is async-only and cheap to re-check per write.
    const denial = await writeDenialFull(p, context, fix.path)
    if (denial) {
      skipped.push({ path: fix.path, reason: denial })
      continue
    }
    const next = applyAutoFix(current, fix)
    if (next === current) continue
    await store.writeNote(
      context,
      fix.path,
      next,
      { id: p.userId, name: p.name, email: p.email || null },
      'maintenance',
      'mcp',
    )
    contentByPath.set(fix.path, next) // later fixes on the same note compose
    if (context.ownerKey === 'shared' && !context.spaceId.startsWith('me:')) {
      void logAudit(p.spaceId, {
        userId: p.userId,
        name: p.name,
        action: 'write',
        path: fix.path,
        detail: `clean: ${fix.kind}`,
      })
    }
    applied++
  }
  const counts: Record<string, number> = {}
  for (const group of analysis.worklist) counts[group.kind] = group.count
  return { applied, skipped, remaining_issue_counts: counts }
}

export interface TrashResult {
  path: string
  status: 'trashed' | 'denied'
  reason?: string
}

/**
 * Soft-delete notes as part of a clean (7-day restore window). Authority per
 * note: the author, an admin, or FULL access at the path (canRemove), plus the
 * ordinary write gate and the "Freeze for AI" lock.
 */
export async function trashNotes(
  p: ContextPrincipal,
  context: Context,
  resolved: ResolvedContext | null,
  paths: string[],
): Promise<TrashResult[]> {
  const out: TrashResult[] = []
  for (const path of paths) {
    const createdBy = await store.getNoteCreatedBy(context, path)
    if (createdBy === null) {
      out.push({ path, status: 'denied', reason: 'No such note' })
      continue
    }
    // `resolved` is null only for the personal scope, where the caller owns
    // everything (resolveTarget checked membership already).
    const removable = resolved
      ? canRemove(resolved, createdBy, { principal: p, path })
      : true
    if (!removable) {
      out.push({ path, status: 'denied', reason: 'Only the author, an admin, or full access at this path can remove it' })
      continue
    }
    const denial = writeDenial(p, context, path) ?? lockedDenial(p, context, path, 'maintenance')
    if (denial) {
      out.push({ path, status: 'denied', reason: denial })
      continue
    }
    await store.deleteNote(context, path)
    if (resolved && !resolved.isPersonalSpace) {
      void logAudit(p.spaceId, {
        userId: p.userId,
        name: p.name,
        action: 'delete',
        path,
        detail: 'clean: trash (restorable 7 days)',
      })
    }
    out.push({ path, status: 'trashed' })
  }
  return out
}
