'use client'

// Trash modal: soft-deleted notes for the brain. Restore brings a note back to
// its original path (suffixed on collision); Empty trash permanently purges it
// (admin-only in the shared brain, enforced server-side).

import { useEffect, useState } from 'react'
import { notesApi, type Scope } from '../lib/notesApi'
import { formatRelativeTime } from '@/lib/notes/shared/time'
import type { TrashEntry } from '@/lib/notes/shared/types'

interface TrashModalProps {
  communityId: string
  scope: Scope
  onChanged: () => void
  onClose: () => void
}

export function TrashModal({ communityId, scope, onChanged, onClose }: TrashModalProps) {
  const [entries, setEntries] = useState<TrashEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = () =>
    notesApi.trash(communityId, scope).then(({ trash }) => setEntries(trash)).catch(() => setEntries([]))

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, scope])

  const restore = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      await notesApi.restoreTrash(communityId, scope, id)
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore')
    } finally {
      setBusy(false)
    }
  }

  const empty = async () => {
    setBusy(true)
    setError(null)
    try {
      await notesApi.emptyTrash(communityId, scope)
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to empty trash')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        className="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface-1 shadow-float"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2 className="text-base font-semibold text-text-primary">Trash</h2>
          <div className="flex items-center gap-3">
            {entries && entries.length > 0 && (
              <button
                onClick={empty}
                disabled={busy}
                className="text-xs font-semibold text-red-500 hover:underline disabled:opacity-50"
              >
                Empty trash
              </button>
            )}
            <button onClick={onClose} className="text-text-muted hover:text-text-secondary">✕</button>
          </div>
        </div>
        {error && <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
        <div className="overflow-y-auto p-2">
          {entries === null ? (
            <div className="px-3 py-6 text-center text-sm text-text-muted">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-text-muted">Trash is empty.</div>
          ) : (
            entries.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 hover:bg-surface-2">
                <div className="min-w-0">
                  <div className="truncate text-sm text-text-primary">{e.path || e.name}</div>
                  <div className="text-xs text-text-muted">deleted {formatRelativeTime(e.deletedAt, Date.now())}</div>
                </div>
                <button
                  onClick={() => restore(e.id)}
                  disabled={busy}
                  className="shrink-0 text-xs font-semibold text-brand-dark-green hover:underline disabled:opacity-50"
                >
                  Restore
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
