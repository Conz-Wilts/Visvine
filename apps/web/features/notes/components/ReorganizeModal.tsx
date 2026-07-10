'use client'

// AI reorganize: asks the model to propose a cleaner folder structure for the
// brain, shows the proposed moves for review, and applies the accepted ones via
// note renames. Nothing moves until the user clicks Apply.

import { useEffect, useState } from 'react'
import { notesApi } from '../lib/notesApi'
import type { MoveProposal } from '@/lib/notes/shared/types'

interface ReorganizeModalProps {
  communityId: string
  onApplied: () => void
  onClose: () => void
}

export function ReorganizeModal({ communityId, onApplied, onClose }: ReorganizeModalProps) {
  const [summary, setSummary] = useState('')
  const [moves, setMoves] = useState<MoveProposal[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    notesApi
      .reorganize(communityId)
      .then(({ plan }) => {
        setSummary(plan.summary)
        setMoves(plan.moves)
        setSelected(new Set(plan.moves.map((_, i) => i)))
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Reorganize failed'))
      .finally(() => setLoading(false))
  }, [communityId])

  const toggle = (i: number) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  const apply = async () => {
    setApplying(true)
    setError(null)
    try {
      for (let i = 0; i < moves.length; i++) {
        if (!selected.has(i)) continue
        await notesApi.rename(communityId, moves[i].from, moves[i].to)
      }
      onApplied()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply moves')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[10vh]" onMouseDown={onClose}>
      <div
        className="flex max-h-[78vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface-1 shadow-float"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2 className="text-base font-semibold text-text-primary">Reorganize notes</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary">✕</button>
        </div>
        <div className="overflow-y-auto p-4">
          {loading ? (
            <div className="py-8 text-center text-sm text-text-muted">Analyzing your notes…</div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          ) : moves.length === 0 ? (
            <div className="py-6 text-center text-sm text-text-muted">{summary || 'Nothing to reorganize.'}</div>
          ) : (
            <>
              <p className="mb-3 text-sm text-text-secondary">{summary}</p>
              <div className="flex flex-col gap-2">
                {moves.map((m, i) => (
                  <label
                    key={`${m.from}-${i}`}
                    className="flex cursor-pointer items-start gap-2 rounded-xl border border-border-subtle p-3 hover:bg-surface-2"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(i)}
                      onChange={() => toggle(i)}
                      className="mt-0.5 accent-brand-green"
                    />
                    <div className="min-w-0 text-xs">
                      <div className="font-mono text-text-primary">
                        {m.from} <span className="text-text-muted">→</span> {m.to}
                      </div>
                      {m.reason && <div className="mt-0.5 text-text-muted">{m.reason}</div>}
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
        {!loading && moves.length > 0 && (
          <div className="flex justify-end gap-2 border-t border-border-subtle px-4 py-3">
            <button onClick={onClose} className="rounded-xl px-3 py-2 text-sm font-semibold text-text-muted hover:bg-surface-2">
              Cancel
            </button>
            <button
              onClick={apply}
              disabled={applying || selected.size === 0}
              className="rounded-xl bg-brand-green px-4 py-2 text-sm font-semibold text-brand-black hover:brightness-95 disabled:opacity-40"
            >
              {applying ? 'Applying…' : `Apply ${selected.size} move${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
