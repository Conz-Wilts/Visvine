'use client'

// The read-only preview behind a trash row.
//
// A trashed note is soft-deleted: the row, and its content, are still there, and
// only `deletedAt` marks it gone. So there is no live path to navigate to, but
// there IS something to show, and showing it is the point. "Restore" and
// "Delete forever" are a fork you cannot take honestly without seeing what is
// in the note, and the row's name alone is rarely enough once a few notes have
// piled up in there.
//
// Read-only by construction, not by a flag: nothing here can write. The note
// comes back over a GET, the body renders as its stored markdown, and the two
// actions are the ones the row already offered, moved next to the content they
// act on.

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui'
import { notesApi } from '@/features/notes/lib/notesApi'
import { TRASH_RETENTION_DAYS, type TrashEntry } from '@/lib/notes/shared/types'

/** Whole days left before the server purges the entry (0 = within the day). */
function daysLeft(deletedAt: number): number {
  const ms = deletedAt + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000 - Date.now()
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

export function TrashPreview({
  spaceId,
  entry,
  onRestore,
  onPurge,
  onClose,
}: {
  spaceId: string
  entry: TrashEntry
  onRestore?: (id: string) => void
  onPurge?: (id: string) => void
  onClose: () => void
}) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setContent(null)
    setError(null)
    notesApi
      .readTrash(spaceId, entry.id)
      .then((r) => {
        if (live) setContent(r.content)
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : 'Could not read this note')
      })
    return () => {
      live = false
    }
  }, [spaceId, entry.id])

  const left = daysLeft(entry.deletedAt)

  return (
    <Modal
      onClose={onClose}
      size="lg"
      ariaLabel={`Preview ${entry.title || entry.name}`}
      title={
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{entry.title || entry.name}</span>
          <span className="truncate text-[11px] font-normal text-text-muted">
            {entry.path} · in Trash · {left === 0 ? 'purges today' : `purges in ${left}d`}
          </span>
        </span>
      }
      footer={
        <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
          {onPurge && (
            <button
              type="button"
              onClick={() => {
                onPurge(entry.id)
                onClose()
              }}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-surface-2"
            >
              Delete forever
            </button>
          )}
          {onRestore && (
            <button
              type="button"
              onClick={() => {
                onRestore(entry.id)
                onClose()
              }}
              className="rounded-lg bg-brand-green px-3 py-1.5 text-sm font-semibold text-brand-black transition hover:opacity-90"
            >
              Restore
            </button>
          )}
        </div>
      }
    >
      {error ? (
        <p className="px-1 py-6 text-sm text-red-500">{error}</p>
      ) : content === null ? (
        <div className="animate-pulse space-y-2 py-4">
          <div className="h-4 w-2/3 rounded bg-surface-2" />
          <div className="h-4 w-full rounded bg-surface-2" />
          <div className="h-4 w-5/6 rounded bg-surface-2" />
        </div>
      ) : (
        // The stored markdown, as stored. A deleted note is being identified,
        // not read for pleasure: showing the source (frontmatter included) is
        // the honest view, and it is what the note's own Raw tab would show.
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 font-mono text-[13px] leading-relaxed text-text-primary">
          {content}
        </pre>
      )}
    </Modal>
  )
}
