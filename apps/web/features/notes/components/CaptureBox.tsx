'use client'

// Quick capture: a lightweight modal that appends a thought to the user's
// PERSONAL daily log — always, regardless of which community's Context page is
// open. Inline #tags are parsed out of the text and sent alongside it. On
// success we show the log path; when the workspace IS the personal space we
// also offer "Open log" (the note lives in the current brain), otherwise we
// just note that it landed in the user's personal space.

import { useEffect, useMemo, useRef, useState } from 'react'
import { notesApi } from '../lib/notesApi'

interface CaptureBoxProps {
  communityId: string
  /** True when this workspace is the user's personal space. */
  personal: boolean
  /** Open the captured log note here (only offered in the personal space). */
  onOpenLog?: (path: string) => void
  onClose: () => void
}

/** Inline `#tag` tokens (letters/digits/-/_//), deduped, without the '#'. */
function parseTags(text: string): string[] {
  const tags = new Set<string>()
  for (const m of text.matchAll(/(?:^|\s)#([\w/-]+)/g)) tags.add(m[1])
  return [...tags]
}

export function CaptureBox({ communityId, personal, onOpenLog, onClose }: CaptureBoxProps) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [capturedPath, setCapturedPath] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [capturedPath])

  const tags = useMemo(() => parseTags(text), [text])

  const submit = async () => {
    const trimmed = text.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const { path } = await notesApi.capture(communityId, trimmed, undefined, tags.length ? tags : undefined)
      setCapturedPath(path)
      setText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to capture')
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[15vh]" onMouseDown={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border-subtle bg-surface-1 shadow-float"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2 className="text-base font-semibold text-text-primary">Quick capture</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary">✕</button>
        </div>

        {error && <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

        {capturedPath && (
          <div className="flex items-center justify-between gap-2 border-b border-brand-green/30 bg-brand-light-bg px-4 py-2 text-sm text-brand-dark-green">
            <span className="min-w-0 truncate">
              Captured to <span className="font-mono">{capturedPath}</span>
              {!personal && <span> — in your personal space</span>}
            </span>
            {personal && onOpenLog && (
              <button
                onClick={() => {
                  onOpenLog(capturedPath)
                  onClose()
                }}
                className="shrink-0 text-xs font-semibold underline hover:no-underline"
              >
                Open log
              </button>
            )}
          </div>
        )}

        <div className="p-4">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jot a thought… use #tags to tag it"
            rows={3}
            className="w-full resize-none rounded-xl border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-brand-green"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              {tags.map((t) => (
                <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-text-muted">
                  #{t}
                </span>
              ))}
            </div>
            <button
              onClick={submit}
              disabled={busy || !text.trim()}
              title="⌘⏎"
              className="shrink-0 rounded-xl bg-brand-green px-4 py-2 text-sm font-semibold text-brand-black hover:brightness-95 disabled:opacity-40"
            >
              {busy ? 'Capturing…' : capturedPath ? 'Capture another' : 'Capture'}
            </button>
          </div>
          <p className="mt-2 text-xs text-text-muted">Saved to your personal daily log.</p>
        </div>
      </div>
    </div>
  )
}
