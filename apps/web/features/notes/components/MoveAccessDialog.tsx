'use client'

// What a drop in the context tree asks before it happens — and only when it
// has something to say. Access is inherited from the folder a note sits in, so
// filing it somewhere else swaps who can see it; a plain move never opens this
// (useContextTree#confirmedMove). The answer is read off the server's preview
// of the move (/api/notes/move-preview), so it names exactly the people, teams
// and boundaries the move will change rather than warning in general.

import ConfirmDialog from '@/components/ui/ConfirmDialog'
import type { MoveAsk } from '../lib/useContextTree'
import type { MovePreviewSubject } from '../lib/notesApi'

const LEVEL_LABEL = { view: 'can view', edit: 'can edit' } as const

function SubjectList({ title, tone, subjects, detail }: {
  title: string
  tone: 'gain' | 'loss' | 'neutral'
  subjects: MovePreviewSubject[]
  detail: (s: MovePreviewSubject) => string
}) {
  if (subjects.length === 0) return null
  const mark = tone === 'gain' ? 'bg-brand-green' : tone === 'loss' ? 'bg-red-500' : 'bg-text-muted'
  return (
    <div>
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
        <span className={`h-1.5 w-1.5 rounded-full ${mark}`} />
        {title}
      </p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {subjects.map((s) => (
          <li
            key={`${s.subjectType}:${s.subjectId}`}
            className="flex items-baseline justify-between gap-3 rounded-lg bg-surface-2 px-3 py-1.5"
          >
            <span className="min-w-0 truncate font-medium text-text-primary">{s.name}</span>
            <span className="shrink-0 text-xs text-text-muted">{detail(s)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function MoveAccessDialog({ ask }: { ask: MoveAsk | null }) {
  if (!ask) return null
  const { preview, labels, kind } = ask
  const it = kind === 'folder' ? 'this folder and everything in it' : 'this note'

  const notes: string[] = []
  if (preview.entersRestricted !== null) {
    notes.push(`“${labels.dest}” is inside a restricted folder — only people given access there will see ${it}.`)
  }
  if (preview.leavesRestricted !== null) {
    notes.push(`It leaves a restricted folder, so it takes on the access of “${labels.dest}”.`)
  }
  if (preview.lockedAfter && !preview.lockedBefore) notes.push('It will be frozen for AI there — agents and AI edits can’t change it.')
  if (preview.lockedBefore && !preview.lockedAfter) notes.push('It will no longer be frozen for AI — agents and AI edits can change it.')
  if (preview.sharedDown === 'stops') notes.push('It will stop being shared with sub-spaces.')
  if (preview.sharedDown === 'starts') notes.push('It will start being shared with sub-spaces.')

  return (
    <ConfirmDialog
      open
      title={`Move “${labels.item}” to “${labels.dest}”?`}
      confirmLabel="Move"
      onConfirm={ask.confirm}
      onClose={ask.cancel}
      body={
        <div className="flex flex-col gap-4">
          <p>Access comes from where something is filed, so moving {it} changes who can see it.</p>
          <SubjectList
            title="Will lose access"
            tone="loss"
            subjects={preview.lost}
            detail={(s) => (s.before ? `${LEVEL_LABEL[s.before]} now` : '')}
          />
          <SubjectList
            title="Will gain access"
            tone="gain"
            subjects={preview.gained}
            detail={(s) => (s.after ? LEVEL_LABEL[s.after] : '')}
          />
          <SubjectList
            title="Access changes"
            tone="neutral"
            subjects={preview.changed}
            detail={(s) => `${s.before ? LEVEL_LABEL[s.before] : 'no access'} → ${s.after ? LEVEL_LABEL[s.after] : 'no access'}`}
          />
          {notes.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {notes.map((n) => (
                <li key={n} className="border-l-2 border-border-default pl-3">{n}</li>
              ))}
            </ul>
          )}
          <p className="text-xs text-text-muted">Anything shared directly on it keeps its sharing. Space admins always have access.</p>
        </div>
      }
    />
  )
}
