// The review agent runner — the port of blackbird-brain's src/server/review.ts.
// Runs the pure checks over a brain, applies the allow-listed reversible
// auto-fixes through the revision-recording write path (attributed to the
// maintenance actor), and returns the report for the UI. Locked folders are
// frozen — their notes are reported but never auto-fixed.

import * as store from './store'
import { SHARED_OWNER_KEY, type Brain } from './store'
import { buildNoteIndex } from './shared/graph'
import {
  applyAutoFix,
  buildReviewReport,
  DEFAULT_THRESHOLDS,
  type ReviewReport,
} from './shared/review'
import { folderById } from './shared/permissions'
import { folderIdOfPath } from './shared/placement'
import type { BrainPrincipal } from './shared/brainTypes'

const MAINTENANCE_ACTOR = { id: 'system', name: 'Review agent' }

export interface ReviewRunResult {
  report: ReviewReport
  applied: number
}

/**
 * Run a review pass over the brain. `apply` = also write the auto-fixes (the
 * caller has already checked authority: community admin for the shared brain,
 * the owner for a personal brain).
 */
export async function runReview(
  p: BrainPrincipal,
  brain: Brain,
  mode: 'light' | 'full',
  apply: boolean,
): Promise<ReviewRunResult> {
  const raws = await store.listRaw(brain)
  const metas = buildNoteIndex(raws)
  const frozen =
    brain.ownerKey === SHARED_OWNER_KEY
      ? (path: string) => folderById(p.folders, folderIdOfPath(path))?.locked === true
      : () => false

  const report = buildReviewReport({
    raws,
    metas,
    now: Date.now(),
    thresholds: DEFAULT_THRESHOLDS,
    mode,
    frozen,
  })

  let applied = 0
  if (apply) {
    const byPath = new Map(raws.map((r) => [r.path, r.content]))
    for (const fix of report.autoFixes) {
      const current = byPath.get(fix.path)
      if (current === undefined) continue
      const next = applyAutoFix(current, fix)
      if (next === current) continue
      await store.writeNote(brain, fix.path, next, MAINTENANCE_ACTOR)
      byPath.set(fix.path, next) // later fixes on the same note compose
      applied++
    }
  }
  return { report, applied }
}
