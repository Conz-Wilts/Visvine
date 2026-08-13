'use client'

// The request-access dead end, shared by every surface that denies a read:
// the notes workspace and profile Context tab when the context ROOT gate is closed
// (scope 'context'), and a single note/folder the viewer can't open (scope 'path').
//
// The 'path' heading is deliberately existence-neutral — a hidden note and a
// deleted one are indistinguishable by design (lib/notes/contextService.ts#readVisible),
// so this must not become the oracle that tells them apart. Keep any copy added
// here neutral too. Requesting records the path either way; an admin resolving it
// knows whether anything is there.

import { useState } from 'react'
import { Lock } from 'lucide-react'
import { Textarea } from '@/components/ui'

interface AccessRequestCardProps {
  scope: 'context' | 'path'
  spaceName: string
  /** What this space calls its context. Defaults to the generic word —
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
  spaceName,
  contextName = 'context',
  pending,
  requesting,
  error,
  onRequest,
}: AccessRequestCardProps) {
  const [composing, setComposing] = useState(false)
  const [message, setMessage] = useState('')

  const heading =
    scope === 'context' ? `${spaceName}'s ${contextName} is private` : 'You can’t open this note'
  // 'path' carries no body: the heading plus the request button already say the
  // whole thing. 'context' keeps its line — that heading names a gate the viewer
  // has no other way to understand.
  const body =
    scope === 'context'
      ? `Access to ${spaceName}'s shared notes is limited. Request access and an admin will review it.`
      : null

  return (
    // Deliberately chrome-less: this is a dead end inside the context surface,
    // not a dialog over it. A card + shadow read as a modal the viewer could
    // dismiss, so the state sits flat on the context background instead.
    <div className="flex w-full max-w-md flex-col items-center gap-3 px-8 py-10 text-center">
      <Lock className="h-6 w-6 text-text-muted" aria-hidden="true" strokeWidth={1.5} />
      <h2 className="text-base font-semibold text-text-primary">{heading}</h2>
      {body && <p className="text-sm text-text-secondary">{body}</p>}

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
              className="rounded-xl bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-40"
            >
              {requesting ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setComposing(true)}
          disabled={requesting}
          className="rounded-xl bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-40"
        >
          Request access
        </button>
      )}
    </div>
  )
}
