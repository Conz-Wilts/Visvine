// Pure 3-way merge decision for pulling a shared-context note back into the owner's personal copy.
// Three inputs: `base` (the content at the owner's last push/pull — the common ancestor),
// `ours` (the owner's current personal note), and `theirs` (the shared-context instance, possibly
// edited by a member). No Node/DOM imports so both the main process and the renderer (and the
// hermetic unit tests) can use it.
//
// Only the 'conflict' case needs the AI merge; the others resolve deterministically here.

type MergeStatus =
  | 'in-sync' // ours === theirs already — nothing to do
  | 'up-to-date' // the context copy is unchanged since base — nothing to pull
  | 'fast-forward' // only the member changed; accept theirs wholesale
  | 'conflict' // both sides changed — reconcile (AI) and let the owner confirm

export interface MergeDecision {
  status: MergeStatus
  /** The content to adopt for 'fast-forward'/'in-sync'; null when a 'conflict' needs reconciling. */
  resolved: string | null
}

// Compare note bodies ignoring trailing-whitespace / line-ending noise, so a cosmetic save
// doesn't read as a real divergence.
function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd()
}

/**
 * Decide how to pull `theirs` into `ours` given their common ancestor `base`.
 * - ours === theirs           → in-sync (no change)
 * - theirs unchanged vs base  → up-to-date (nothing to pull)
 * - ours unchanged vs base    → fast-forward (take theirs)
 * - both changed              → conflict (needs AI reconciliation)
 */
export function decideMerge(base: string, ours: string, theirs: string): MergeDecision {
  const b = normalize(base)
  const o = normalize(ours)
  const t = normalize(theirs)

  if (o === t) return { status: 'in-sync', resolved: ours }
  if (t === b) return { status: 'up-to-date', resolved: ours }
  if (o === b) return { status: 'fast-forward', resolved: theirs }
  return { status: 'conflict', resolved: null }
}
