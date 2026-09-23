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

import { useEffect, useRef, useState } from 'react'
import { LockIcon } from '@/features/shared/icons';
import { Textarea } from '@/components/ui'

/** Height that puts this block's MIDDLE on the viewport's middle. The block
 *  starts wherever the pane's chrome leaves it — below the shell band and the
 *  tab row, and that offset is different on every surface this card serves — so
 *  a block that simply fills what is left below centres on the middle of the
 *  REMAINDER, which reads low. Doubling the distance from the viewport's centre
 *  down to that top edge puts the centre back where the eye looks for it.
 *
 *  Measured rather than derived: what stands above the block is host chrome, and
 *  a formula for it goes stale the first time any of it changes. 0 until
 *  measured, which is the one frame before the effect runs.
 */
function useCenteredHeight() {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      // Clamped at 0: a block reached while the page was scrolled reads a top
      // above the fold, which would ask for a block taller than the screen.
      const top = Math.max(0, el.getBoundingClientRect().top)
      setHeight(Math.max(240, window.innerHeight - top * 2))
    }
    // Three times, because the chrome above settles after this block first
    // lands: the frame after mount catches layout, and the timeout outlasts the
    // tab bar's 0.3s tray transition. Re-measuring is free when nothing moved.
    measure()
    const frame = requestAnimationFrame(measure)
    const settled = setTimeout(measure, 350)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(settled)
      window.removeEventListener('resize', measure)
    }
  }, [])
  return { ref, height }
}

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
  const { ref, height } = useCenteredHeight()

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
    // Centred on the screen, both ways: this is the whole surface for as long
    // as it is up, not a banner at the top of an empty one. The height is what
    // puts the card on the viewport's own middle (see useCenteredHeight), and
    // it stops short of the fold, so the page never scrolls to show a dead end.
    <div
      ref={ref}
      className="flex w-full items-center justify-center"
      style={height ? { height } : undefined}
    >
      {/* Deliberately chrome-less: this is a dead end inside the context
          surface, not a dialog over it. A card + shadow read as a modal the
          viewer could dismiss, so the state sits flat on the context
          background instead. */}
      <div className="flex w-full max-w-md flex-col items-center gap-3 px-8 py-10 text-center">
        <LockIcon className="h-6 w-6 text-fg-muted" aria-hidden="true" strokeWidth={1.5} />
        <h2 className="text-base font-semibold text-fg">{heading}</h2>
        {body && <p className="text-sm text-fg-secondary">{body}</p>}

        {error && <p className="text-sm text-danger">{error}</p>}

        {pending ? (
          <span className="rounded-full bg-surface-subtle px-3 py-1.5 text-xs font-semibold text-fg-muted">
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
                className="rounded-xl px-3 py-2 text-sm font-semibold text-fg-secondary hover:bg-surface-subtle disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={() => onRequest(message.trim() || undefined)}
                disabled={requesting}
                className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-40"
              >
                {requesting ? 'Sending…' : 'Send request'}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setComposing(true)}
            disabled={requesting}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-40"
          >
            Request access
          </button>
        )}
      </div>
    </div>
  )
}
