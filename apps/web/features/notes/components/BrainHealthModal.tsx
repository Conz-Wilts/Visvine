'use client'

// Brain health: run a light/full hygiene review over the brain (dry-run first,
// then optionally apply the safe auto-fixes), review queued promotion proposals,
// and read the private-folder audit trail. Tab availability by context:
//   personal space      → Review only (no governance in your own space).
//   community, member   → Proposals (own queued shares) + Distill — AI enrichment
//                         that distills YOUR personal notes into THIS community's
//                         brain (server gates on membership + folder write).
//   community, admin    → Review + Proposals + Audit + Distill.

import { useCallback, useEffect, useState } from 'react'
import { notesApi, type ReviewReport } from '../lib/notesApi'
import { formatRelativeTime } from '@/lib/notes/shared/time'
import type { AuditEntry, MoveProposalEntry } from '@/lib/notes/shared/brainTypes'

interface BrainHealthModalProps {
  communityId: string
  /** True when this workspace is the user's personal space. */
  isPersonalSpace: boolean
  aiConfigured: boolean
  /** Community admin (registry `me`) — gates the audit tab. */
  isCommunityAdmin: boolean
  /** Notes changed on the server (fixes applied / proposal approved). */
  onChanged: () => void
  onClose: () => void
}

type Tab = 'review' | 'proposals' | 'audit' | 'distill'

export function BrainHealthModal({
  communityId,
  isPersonalSpace,
  aiConfigured,
  isCommunityAdmin,
  onChanged,
  onClose,
}: BrainHealthModalProps) {
  // Hygiene review touches the whole brain — community-admin territory (the
  // personal space treats you as its admin). Proposals are for everyone: the
  // server filters to your own + folders you admin. Distill is a member action.
  const showReview = isPersonalSpace || isCommunityAdmin
  const showProposals = !isPersonalSpace
  const showAudit = !isPersonalSpace && isCommunityAdmin
  const showDistill = !isPersonalSpace && aiConfigured

  // Non-admin members land on Distill (or Proposals without AI), never an
  // empty Review tab.
  const [tab, setTab] = useState<Tab>(showReview ? 'review' : showDistill ? 'distill' : 'proposals')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Review state
  const [report, setReport] = useState<ReviewReport | null>(null)
  // Proposals + audit (shared brain concerns)
  const [proposals, setProposals] = useState<MoveProposalEntry[] | null>(null)
  const [audit, setAudit] = useState<AuditEntry[] | null>(null)

  const runReview = async (mode: 'light' | 'full') => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const { report: r } = await notesApi.runReview(communityId, mode, false)
      setReport(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed')
    } finally {
      setBusy(false)
    }
  }

  const applyFixes = async () => {
    if (!report) return
    setBusy(true)
    setError(null)
    try {
      const { applied } = await notesApi.runReview(communityId, report.mode, true)
      setNotice(`Applied ${applied} fix${applied === 1 ? '' : 'es'}.`)
      onChanged()
      // Re-run the dry review so the report reflects the post-fix state.
      const { report: r } = await notesApi.runReview(communityId, report.mode, false)
      setReport(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply fixes')
    } finally {
      setBusy(false)
    }
  }

  const enrich = async () => {
    if (!window.confirm("Distill insights runs AI enrichment over your recent personal notes and distills what helps into this community's brain. Continue?")) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const { applied, considered } = await notesApi.runEnrich(communityId)
      setNotice(`Enriched ${applied} of ${considered} note${considered === 1 ? '' : 's'} considered.`)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enrichment failed')
    } finally {
      setBusy(false)
    }
  }

  const loadProposals = useCallback(() => {
    notesApi
      .listProposals(communityId)
      .then(({ proposals: p }) => setProposals(p))
      .catch(() => setProposals([]))
  }, [communityId])

  const loadAudit = useCallback(() => {
    notesApi
      .getAudit(communityId)
      .then(({ entries }) => setAudit(entries))
      .catch((err) => {
        setAudit([])
        setError(err instanceof Error ? err.message : 'Failed to load audit trail')
      })
  }, [communityId])

  useEffect(() => {
    if (tab === 'proposals' && proposals === null) loadProposals()
    if (tab === 'audit' && audit === null) loadAudit()
  }, [tab, proposals, audit, loadProposals, loadAudit])

  const resolveProposal = async (id: string, approve: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await notesApi.resolveProposal(communityId, id, approve)
      loadProposals()
      if (approve) onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve proposal')
    } finally {
      setBusy(false)
    }
  }

  const pendingProposals = (proposals ?? []).filter((p) => p.status === 'pending')

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[10vh]" onMouseDown={onClose}>
      <div
        className="flex max-h-[78vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface-1 shadow-float"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-text-primary">Brain health</h2>
            {(showProposals || showAudit || showDistill) && (
              <div className="flex items-center gap-1 rounded-xl border border-border-default p-0.5">
                {showReview && <TabButton label="Review" active={tab === 'review'} onClick={() => setTab('review')} />}
                {showProposals && (
                  <TabButton label="Proposals" active={tab === 'proposals'} onClick={() => setTab('proposals')} />
                )}
                {showAudit && <TabButton label="Audit" active={tab === 'audit'} onClick={() => setTab('audit')} />}
                {showDistill && <TabButton label="Distill" active={tab === 'distill'} onClick={() => setTab('distill')} />}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary">✕</button>
        </div>

        {error && <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
        {notice && (
          <div className="border-b border-brand-green/30 bg-brand-light-bg px-4 py-2 text-sm text-brand-dark-green">{notice}</div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'distill' && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-secondary">
                Distill insights runs AI enrichment over your recent <span className="font-semibold">personal</span>{' '}
                notes and distills what helps — summaries, tags, links — into this community's brain. Your personal
                originals aren't changed.
              </p>
              <div>
                <button
                  onClick={enrich}
                  disabled={busy}
                  className="rounded-xl bg-brand-green px-4 py-2 text-sm font-semibold text-brand-black hover:brightness-95 disabled:opacity-40"
                >
                  {busy ? 'Distilling…' : '✨ Distill insights'}
                </button>
              </div>
            </div>
          )}

          {tab === 'review' && showReview && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => runReview('light')}
                  disabled={busy}
                  className="rounded-xl border border-border-default px-3 py-2 text-sm font-semibold text-text-secondary transition hover:bg-surface-2 disabled:opacity-40"
                >
                  Run light review
                </button>
                <button
                  onClick={() => runReview('full')}
                  disabled={busy}
                  className="rounded-xl border border-border-default px-3 py-2 text-sm font-semibold text-text-secondary transition hover:bg-surface-2 disabled:opacity-40"
                >
                  Run full review
                </button>
              </div>

              {busy && !report && <div className="py-6 text-center text-sm text-text-muted">Reviewing…</div>}

              {report && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    {Object.entries(report.counts).map(([k, v]) => (
                      <span key={k} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text-secondary">
                        {k}: {v}
                      </span>
                    ))}
                    <span className="ml-auto text-xs text-text-muted">{report.mode} review</span>
                  </div>

                  {report.autoFixes.length > 0 && (
                    <div className="rounded-xl border border-border-subtle p-3">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Safe auto-fixes</span>
                        <button
                          onClick={applyFixes}
                          disabled={busy}
                          className="rounded-xl bg-brand-green px-3 py-1.5 text-xs font-semibold text-brand-black hover:brightness-95 disabled:opacity-40"
                        >
                          {busy ? 'Applying…' : `Apply ${report.autoFixes.length} safe fix${report.autoFixes.length === 1 ? '' : 'es'}`}
                        </button>
                      </div>
                      {report.autoFixes.map((f, i) => (
                        <div key={`${f.path}-${i}`} className="py-1 text-xs">
                          <span className="rounded bg-surface-2 px-1.5 py-0.5 font-semibold text-text-secondary">{f.kind}</span>{' '}
                          <span className="font-mono text-text-primary">{f.path}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {report.issues.length === 0 ? (
                    <div className="py-4 text-center text-sm text-text-muted">No issues found — this brain is healthy.</div>
                  ) : (
                    groupByKind(report.issues).map(([kind, issues]) => (
                      <div key={kind} className="rounded-xl border border-border-subtle p-3">
                        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                          {kind} ({issues.length})
                        </div>
                        {issues.map((issue, i) => (
                          <div key={`${issue.path}-${i}`} className="py-1 text-xs">
                            <span className="font-mono text-text-primary">{issue.path}</span>
                            <span className="text-text-muted"> — {issue.detail}</span>
                          </div>
                        ))}
                      </div>
                    ))
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'proposals' && (
            proposals === null ? (
              <div className="py-6 text-center text-sm text-text-muted">Loading…</div>
            ) : pendingProposals.length === 0 ? (
              <div className="py-6 text-center text-sm text-text-muted">No pending promotion proposals.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {pendingProposals.map((p) => (
                  <div key={p.id} className="flex items-start gap-2 rounded-xl border border-border-subtle p-3">
                    <div className="min-w-0 flex-1 text-xs">
                      <div className="font-mono text-text-primary">
                        {p.fromPath} <span className="text-text-muted">→</span> {p.toPath}
                      </div>
                      <div className="mt-0.5 text-text-muted">
                        proposed by {p.proposerName} · {formatRelativeTime(p.proposedAt, Date.now())}
                      </div>
                    </div>
                    <button
                      onClick={() => resolveProposal(p.id, true)}
                      disabled={busy}
                      className="shrink-0 text-xs font-semibold text-brand-dark-green hover:underline disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => resolveProposal(p.id, false)}
                      disabled={busy}
                      className="shrink-0 text-xs font-semibold text-red-500 hover:underline disabled:opacity-50"
                    >
                      Deny
                    </button>
                  </div>
                ))}
              </div>
            )
          )}

          {tab === 'audit' && (
            audit === null ? (
              <div className="py-6 text-center text-sm text-text-muted">Loading…</div>
            ) : audit.length === 0 ? (
              <div className="py-6 text-center text-sm text-text-muted">No audit entries.</div>
            ) : (
              <div className="flex flex-col">
                {audit.map((e, i) => (
                  <div key={`${e.at}-${i}`} className="flex items-baseline gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-surface-2">
                    <span className="w-24 shrink-0 text-text-muted">{formatRelativeTime(e.at, Date.now())}</span>
                    <span className="w-14 shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-center font-semibold text-text-secondary">
                      {e.action}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-text-primary">{e.name}</span>{' '}
                      <span className="font-mono text-text-muted">{e.path}</span>
                      {e.detail && <span className="text-text-muted"> — {e.detail}</span>}
                    </span>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}

function groupByKind<T extends { kind: string }>(items: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const list = groups.get(item.kind)
    if (list) list.push(item)
    else groups.set(item.kind, [item])
  }
  return [...groups.entries()]
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
        active ? 'bg-brand-green text-white' : 'text-text-muted hover:text-text-secondary'
      }`}
    >
      {label}
    </button>
  )
}
