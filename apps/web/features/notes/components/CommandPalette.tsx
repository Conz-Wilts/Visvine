'use client'

// Ctrl/Cmd-Shift-P command palette: a filterable list of workspace actions.
// The caller supplies the command list; this is pure presentation + keyboarding.

import { useEffect, useMemo, useRef, useState } from 'react'

export interface Command {
  id: string
  label: string
  hint?: string
  run: () => void
}

interface CommandPaletteProps {
  commands: Command[]
  onClose: () => void
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) => c.label.toLowerCase().includes(q))
  }, [commands, query])

  useEffect(() => setActive(0), [query])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault()
      results[active].run()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[15vh]"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border-subtle bg-surface-1 shadow-float"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a command…"
          className="w-full border-b border-border-subtle bg-transparent px-4 py-3 text-base text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-text-muted">No commands</div>
          ) : (
            results.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={c.run}
                className={`flex w-full items-center justify-between px-4 py-2 text-left transition ${
                  i === active ? 'bg-surface-3' : 'hover:bg-surface-2'
                }`}
              >
                <span className="text-sm text-text-primary">{c.label}</span>
                {c.hint && <span className="text-xs text-text-muted">{c.hint}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
