'use client'

// Inline tag picker for the context-note header: a text field with a dropdown of
// the community's existing tags (each shown in its own colour) plus a "Create"
// flow where you pick the new tag's colour from a swatch palette. Selecting an
// existing tag calls onAdd; creating calls onCreate with the chosen colour.
// blur / Escape / empty-selection calls onClose.

import { useMemo, useRef, useState } from 'react'
import { TAG_SWATCHES, resolveTagBase, tagPalette } from '@/lib/tagColors'

interface TagComboboxProps {
  /** Community tags not already on this entity, sorted. */
  suggestions: string[]
  /** Lower-cased tags already on this entity, to suppress a redundant "Create". */
  existing: Set<string>
  /** Community tag → base-colour registry, for colouring suggestions. */
  registry: Record<string, string>
  /** Entity accent (input focus ring). */
  accentBase: string
  onAdd: (tag: string) => void
  onCreate: (tag: string, color: string) => void
  onClose: () => void
}

export function TagCombobox({
  suggestions, existing, registry, accentBase, onAdd, onCreate, onClose,
}: TagComboboxProps) {
  const [draft, setDraft] = useState('')
  const [highlight, setHighlight] = useState(0)
  // Ignore the blur that immediately follows a mousedown-driven selection.
  const selecting = useRef(false)

  const query = draft.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!query) return suggestions.slice(0, 8)
    return suggestions.filter((t) => t.toLowerCase().includes(query)).slice(0, 8)
  }, [suggestions, query])

  const trimmed = draft.trim()
  const showCreate =
    !!trimmed &&
    !existing.has(query) &&
    !suggestions.some((t) => t.toLowerCase() === query)

  // Keyboard-selectable rows: matching suggestions, then the optional Create.
  const rows: Array<{ kind: 'tag' | 'create'; value: string }> = [
    ...matches.map((value) => ({ kind: 'tag' as const, value })),
    ...(showCreate ? [{ kind: 'create' as const, value: trimmed }] : []),
  ]
  const active = Math.min(highlight, rows.length - 1)

  const commit = (row: { kind: 'tag' | 'create'; value: string } | undefined) => {
    if (!row) { onClose(); return }
    if (row.kind === 'create') onCreate(row.value, resolveTagBase(row.value, registry))
    else onAdd(row.value)
    onClose()
  }

  return (
    <div className="relative">
      <input
        autoFocus
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setHighlight(0) }}
        onMouseDown={() => { selecting.current = false }}
        onBlur={() => { if (!selecting.current) onClose() }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, rows.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)) }
          else if (e.key === 'Enter') {
            e.preventDefault()
            if (rows.length) commit(rows[active])
            else if (trimmed) { onCreate(trimmed, resolveTagBase(trimmed, registry)); onClose() }
            else onClose()
          } else if (e.key === 'Escape') { e.preventDefault(); onClose() }
        }}
        placeholder="Search or create…"
        maxLength={40}
        className="h-[30px] w-44 rounded-full border border-border-default bg-surface-1 px-3 text-[13px] text-text-primary outline-none focus:border-[color:var(--accent)]"
        style={{ ['--accent' as string]: accentBase }}
      />

      {(rows.length > 0 || showCreate) && (
        <div className="absolute left-0 top-[34px] z-20 w-56 overflow-hidden rounded-xl border border-border-subtle bg-surface-1 shadow-lg">
          <ul role="listbox" className="max-h-52 overflow-auto py-1">
            {rows.map((row, i) => {
              const pal = row.kind === 'tag' ? tagPalette(row.value, registry) : null
              return (
                <li key={`${row.kind}:${row.value}`} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseDown={() => { selecting.current = true }}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => commit(row)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition ${
                      i === active ? 'bg-surface-2' : ''
                    }`}
                  >
                    {row.kind === 'create' ? (
                      <>
                        <span className="text-text-muted">+</span>
                        <span className="text-text-secondary">Create</span>
                        <span className="ml-1 truncate font-medium text-text-primary">“{row.value}”</span>
                      </>
                    ) : (
                      <span className="rounded-full px-2 py-0.5 text-[12px] font-medium"
                            style={{ background: pal!.light, color: pal!.dark }}>
                        {row.value}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>

          {showCreate && (
            <div className="border-t border-border-subtle px-3 py-2">
              <div className="mb-1.5 text-[11px] font-medium text-text-muted">Pick a colour</div>
              <div className="flex flex-wrap gap-1.5">
                {TAG_SWATCHES.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Create “${trimmed}” in this colour`}
                    onMouseDown={() => { selecting.current = true }}
                    onClick={() => { onCreate(trimmed, color); onClose() }}
                    className="h-5 w-5 rounded-full border border-black/10 transition hover:scale-110"
                    style={{ background: color }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
