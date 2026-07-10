'use client'

// Per-note revision history modal: every saved snapshot (newest first) with who
// saved it, when, and how (edit / AI refactor / restore / baseline). Restore
// reverts the note to that snapshot (recorded as a new 'restore' revision).

import { useEffect, useState } from 'react'
import { notesApi } from '../lib/notesApi'
import { formatRelativeTime } from '@/lib/notes/shared/time'
import type { NoteRevision } from '@/lib/notes/shared/types'

interface RevisionHistoryProps {
  communityId: string
  path: string
  onRestored: () => void
  onClose: () => void
}

const ORIGIN_LABEL: Record<string, string> = {
  edit: 'Edit',
  'ai-refactor': 'AI refactor',
  restore: 'Restore',
  baseline: 'Baseline',
}

export function RevisionHistory({ communityId, path, onRestored, onClose }: RevisionHistoryProps) {
  const [revisions, setRevisions] = useState<NoteRevision[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    notesApi.history(communityId, path).then(({ revisions: r }) => setRevisions(r)).catch(() => setRevisions([]))
  }, [communityId, path])

  const restore = async (id: string) => {
    setBusy(true)
    try {
      await notesApi.restoreRevision(communityId, path, id)
      onRestored()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[10vh]" onMouseDown={onClose}>
      <div
        className="flex max-h-[78vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface-1 shadow-float"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2 className="text-base font-semibold text-text-primary">Version history</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary">✕</button>
        </div>
        <div className="overflow-y-auto p-2">
          {revisions === null ? (
            <div className="px-3 py-6 text-center text-sm text-text-muted">Loading…</div>
          ) : revisions.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-text-muted">No history yet.</div>
          ) : (
            revisions.map((rev) => (
              <div key={rev.id} className="rounded-xl border border-border-subtle p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                      {ORIGIN_LABEL[rev.origin] ?? rev.origin}
                    </span>
                    <span className="text-xs text-text-secondary">{rev.editor}</span>
                    <span className="text-xs text-text-muted">{formatRelativeTime(rev.at, Date.now())}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setExpanded((e) => (e === rev.id ? null : rev.id))}
                      className="text-xs text-text-muted hover:text-text-secondary"
                    >
                      {expanded === rev.id ? 'Hide' : 'Preview'}
                    </button>
                    <button
                      onClick={() => restore(rev.id)}
                      disabled={busy}
                      className="text-xs font-semibold text-brand-dark-green hover:underline disabled:opacity-50"
                    >
                      Restore
                    </button>
                  </div>
                </div>
                {expanded === rev.id && (
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-2 font-mono text-[11px] text-text-secondary">
                    {rev.content}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
