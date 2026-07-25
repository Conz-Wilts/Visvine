'use client'

// The request-access dead-end card, shared by every surface that denies a read:
// the notes workspace and profile Context tab when the brain ROOT gate is closed
// (scope 'brain'), and a single note/folder the viewer can't open (scope 'path').
//
// The 'path' copy is deliberately existence-neutral — a hidden note and a deleted
// one are indistinguishable by design (lib/notes/brainService.ts#readVisible), so
// the card must not become the oracle that tells them apart. Requesting records
// the path either way; an admin resolving it knows whether anything is there.

import { useState } from 'react'
import { Textarea } from '@/components/ui'

interface AccessRequestCardProps {
  scope: 'brain' | 'path'
  communityName: string
  /** What this community calls its context. Defaults to the generic word —
   *  /api/notes/settings is admin-only, so a gated viewer can't know the real one. */
  contextName?: string
  /** Whether this exact resource already has an open request from the viewer. */
  pending: boolean
  requesting: boolean
  error?: string | null
  onRequest: (message?: string) => void
}

export function AccessRequestCard({
  scope,
  communityName,
  contextName = 'context',
  pending,
  requesting,
  error,
  onRequest,
}: AccessRequestCardProps) {
  const [composing, setComposing] = useState(false)
  const [message, setMessage] = useState('')

  const heading =
    scope === 'brain' ? `${communityName}'s ${contextName} is private` : 'You can’t open this note'
  const body =
    scope === 'brain'
      ? `Access to ${communityName}'s shared notes is limited. Request access and an admin will review it.`
      : 'It may have been moved or deleted, or you may not have access to it. Request access and whoever manages it will review.'

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-2xl border border-border-subtle bg-surface-1 px-8 py-10 text-center shadow-float">
      <span className="text-3xl" aria-hidden="true">
        🔒
      </span>
      <h2 className="text-base font-semibold text-text-primary">{heading}</h2>
      <p className="text-sm text-text-secondary">{body}</p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {pending ? (
        <span className="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-text-muted">
          Request pending — an admin will review it
        </span>
      ) : composing ? (
        // Progressive disclosure: the note is optional, so it only costs a
        // second click for the people who want to explain themselves.
        <div className="mt-1 flex w-full flex-col gap-2 text-left">
          <Textarea
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1000}
            placeholder="Add a note for the admin (optional)"
            className="!min-h-20 text-sm"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => {
                setComposing(false)
                setMessage('')
              }}
              disabled={requesting}
              className="rounded-xl px-3 py-2 text-sm font-semibold text-text-secondary hover:bg-surface-2 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={() => onRequest(message.trim() || undefined)}
              disabled={requesting}
              className="rounded-xl bg-brand-green px-4 py-2 text-sm font-semibold text-brand-black hover:brightness-95 disabled:opacity-40"
            >
              {requesting ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setComposing(true)}
          disabled={requesting}
          className="rounded-xl bg-brand-green px-4 py-2 text-sm font-semibold text-brand-black hover:brightness-95 disabled:opacity-40"
        >
          Request access
        </button>
      )}
    </div>
  )
}
