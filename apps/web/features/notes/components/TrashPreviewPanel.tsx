'use client'

// The standalone view of a trashed note (/directory/trash/<id>): the note
// itself, read-only, in the same surface an ordinary note gets — Context and
// Raw, the docked context tree beside it, its title leading the page.
//
// A trashed note is soft-deleted: the row and its content are still there and
// only `deletedAt` marks it gone. So it is still a note to read; what it has
// lost is its place — it is out of the tree, the directory and search until it
// is restored. Reading it the way every other note reads is the point: what a
// note holds is exactly what "Restore" or "Delete forever" is a decision about,
// and a markdown dump is a poor way to make it.
//
// Read-only by construction, not by a flag: the content comes back over a GET,
// and nothing here can write. In place of the chrome a live note carries
// (Connections, Share — both about a note that is in the graph) the tab row
// carries the two acts left: Restore, and Delete forever.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSpaceRouter } from '@/features/shared/hooks/useSpaceRouter'
import { ConfirmDialog, PageError } from '@visvine/ui';
import { RotateCcwIcon, Trash2Icon } from '@/features/shared/icons'
import { useContextPanel } from '@/features/shared/contexts/ContextPanelContext'
import { useSpace } from '@/features/shared/contexts/SpaceContext'
import { noteHref } from '@/lib/notes/entities'
import { TRASH_RETENTION_DAYS } from '@/lib/notes/shared/types'
import { notesApi } from '../lib/notesApi'
import { NoteEditor } from './NoteEditor'
import type { NoteMode } from './NoteModeToggle'
import '../notes.css'
import { XIcon } from '@/features/shared/icons';

type TrashedNote = { path: string; title: string; content: string; deletedAt: number }

/** Whole days left before the server purges the entry (0 = within the day). */
function daysLeft(deletedAt: number): number {
  const ms = deletedAt + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000 - Date.now()
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

const noop = () => {}

export function TrashPreviewPanel({ id, mode = 'wysiwyg' }: { id: string; mode?: NoteMode }) {
  const router = useSpaceRouter()
  const { currentSpace } = useSpace()
  const { tabTrailHost } = useContextPanel()
  const spaceId = currentSpace?.id ?? null

  const [note, setNote] = useState<TrashedNote | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmPurge, setConfirmPurge] = useState(false)

  useEffect(() => {
    if (!spaceId) return
    let live = true
    setLoading(true)
    setNote(null)
    setError(null)
    notesApi
      .readTrash(spaceId, id)
      .then((r) => {
        if (!live) return
        setNote(r)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (!live) return
        setError(e instanceof Error ? e.message : 'Could not read this note')
        setLoading(false)
      })
    return () => {
      live = false
    }
  }, [spaceId, id])

  // Restoring puts the note back at its original path, so the view follows it
  // there — the trash entry this page is about no longer exists.
  const restore = async () => {
    if (!spaceId) return
    setBusy(true)
    setError(null)
    try {
      const { path } = await notesApi.restoreTrash(spaceId, id)
      router.push(noteHref(path))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed')
      setBusy(false)
    }
  }

  const purge = async () => {
    if (!spaceId) return
    setBusy(true)
    setError(null)
    try {
      await notesApi.purgeTrash(spaceId, id)
      setConfirmPurge(false)
      router.push(noteHref('index.md'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      setBusy(false)
    }
  }

  if (!spaceId || loading) {
    return (
      <div className="mx-auto max-w-3xl animate-pulse space-y-3 py-6">
        <div className="h-4 w-2/3 rounded bg-surface-subtle" />
        <div className="h-4 w-full rounded bg-surface-subtle" />
        <div className="h-4 w-1/2 rounded bg-surface-subtle" />
      </div>
    )
  }

  if (!note) {
    return <PageError size="inline" message="Couldn't load this note." onRetry={() => window.location.reload()} />
  }

  const left = daysLeft(note.deletedAt)
  const name = (note.path.split('/').pop() ?? note.path).replace(/\.md$/i, '')
  const title = note.title?.trim() || name

  // Where a live note's own actions sit: the right end of the tab row, styled
  // like a tab (see useShareAction). Without a bar to portal into — a narrow
  // pane, or the panel rendered without chrome — they fall back to a row under
  // the title, so the fork is never unavailable.
  const actions = (inBar: boolean) => (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={restore}
        title="Put this note back where it was"
        className={
          inBar
            ? 'flex h-12 shrink-0 items-center gap-1.5 px-4 text-sm font-medium whitespace-nowrap text-fg-muted outline-none transition-colors duration-150 hover:text-fg disabled:opacity-50'
            : 'flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-fg-secondary transition hover:bg-surface-subtle disabled:opacity-50'
        }
      >
        <RotateCcwIcon className={inBar ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
        Restore
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setConfirmPurge(true)}
        title="Delete this note permanently"
        className={
          inBar
            ? 'flex h-12 shrink-0 items-center gap-1.5 px-4 text-sm font-medium whitespace-nowrap text-fg-muted outline-none transition-colors duration-150 hover:text-danger disabled:opacity-50'
            : 'flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-danger transition hover:bg-surface-subtle disabled:opacity-50'
        }
      >
        <Trash2Icon className={inBar ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
        Delete forever
      </button>
    </>
  )

  // The note's own header, exactly as the live surface draws it — plus the one
  // thing that is true here and nowhere else: this note is in the trash, and
  // for how much longer.
  const headerCard = (
    <div className="mx-auto mb-1 w-full max-w-[760px] px-7 pt-10">
      {/* leading-[1.25]: `truncate` hides overflow, so a tighter line box would
          shave the font's descenders off the title. */}
      <h2 className="min-w-0 truncate text-[2.5rem] font-semibold leading-[1.25] tracking-[-0.02em] text-fg font-open-sauce">
        {title}
      </h2>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
        <span className="rounded-md bg-surface-subtle px-2 py-px text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
          In Trash
        </span>
        <span className="min-w-0 truncate">{note.path}</span>
        <span aria-hidden>·</span>
        <span>{left === 0 ? 'deleted for good today' : `deleted for good in ${left}d`}</span>
      </div>
      {!tabTrailHost && <div className="mt-4 flex items-center gap-2">{actions(false)}</div>}
    </div>
  )

  return (
    <div className="pb-10">
      {error && (
        <div className="mx-auto mb-3 flex max-w-3xl items-center justify-between border-l-2 border-danger-bright pl-3 py-1 text-sm text-danger-strong">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss"
                  className="ml-2 text-danger-bright hover:text-danger">
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {/* The ordinary note surface, read-only: Context renders the markdown,
          Raw shows it as stored. `canEdit={false}` is what makes it read-only —
          nothing in the editor writes without it — and the tabs above drive the
          mode, so no mode toggle rides the toolbar. */}
      <NoteEditor
        key={note.path}
        variant="embedded"
        headerSlot={headerCard}
        path={note.path}
        meta={null}
        notes={[]}
        initialContent={note.content}
        canEdit={false}
        mode={mode}
        references={null}
        onSave={noop}
        onOpenNote={noop}
      />
      {tabTrailHost && createPortal(actions(true), tabTrailHost)}
      <ConfirmDialog
        open={confirmPurge}
        title={`Permanently delete "${title}"?`}
        body="This cannot be undone."
        confirmLabel="Delete forever"
        destructive
        onConfirm={purge}
        onClose={() => setConfirmPurge(false)}
      />
    </div>
  )
}
