'use client'

// The search-first landing screen for the notes workspace: a big type-to-search
// box over fuzzy title/path matching, with Recent + Pinned cards below when the
// box is empty. Ported from blackbird-brain's Home, restyled to Visvine tokens.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { NoteMeta } from '@/lib/notes/shared/types'

interface NoteSearchHomeProps {
  notes: NoteMeta[]
  pinned: string[]
  onOpen: (path: string) => void
  onNew: () => void
  // Shown in the search placeholder and heading copy.
  heading: string
}

const MAX_RESULTS = 8
const MAX_RECENT = 6

// Subsequence fuzzy match: every char of the lowercased query must appear in
// order in the target. Returns a score (lower = better) favouring early,
// contiguous matches, or null when the query isn't a subsequence.
function fuzzyScore(query: string, target: string): number | null {
  if (query === '') return 0
  const t = target.toLowerCase()
  let score = 0
  let ti = 0
  let prev = -1
  for (const ch of query) {
    const idx = t.indexOf(ch, ti)
    if (idx === -1) return null
    score += prev === -1 ? idx : idx - prev - 1
    prev = idx
    ti = idx + 1
  }
  return score
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

export function NoteSearchHome({ notes, pinned, onOpen, onNew, heading }: NoteSearchHomeProps) {
  const isShared = heading !== 'My notes'
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Land with the cursor in the search box, so the whole screen is type-to-search.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const pinnedSet = useMemo(() => new Set(pinned), [pinned])

  const recent = useMemo(
    () =>
      [...notes]
        .filter((m) => !pinnedSet.has(m.path))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, MAX_RECENT)
        .map((m) => ({ path: m.path, title: m.title })),
    [notes, pinnedSet],
  )

  const pinnedNotes = useMemo(
    () =>
      pinned
        .map((p) => notes.find((m) => m.path === p))
        .filter((m): m is NoteMeta => !!m)
        .map((m) => ({ path: m.path, title: m.title })),
    [pinned, notes],
  )

  // Fuzzy results over title and path; the better of the two scores wins.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const scored = notes
      .map((m) => {
        const titleScore = fuzzyScore(q, m.title)
        const pathScore = fuzzyScore(q, m.path)
        const best =
          titleScore === null ? pathScore : pathScore === null ? titleScore : Math.min(titleScore, pathScore)
        return best === null ? null : { meta: m, score: best }
      })
      .filter((x): x is { meta: NoteMeta; score: number } => x !== null)
    scored.sort((a, b) => (a.score !== b.score ? a.score - b.score : a.meta.title.localeCompare(b.meta.title)))
    return scored.slice(0, MAX_RESULTS).map((x) => x.meta)
  }, [notes, query])

  useEffect(() => {
    setActive(0)
  }, [query])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const path = results[active]?.path
      if (path) onOpen(path)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setQuery('')
    }
  }

  const searching = query.trim() !== ''

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto px-4 pt-6">
      <div className="w-full max-w-2xl">
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-muted">
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={isShared ? `Search ${heading}…` : 'Search your notes…'}
            className="w-full rounded-2xl bg-surface-2 py-3.5 pl-12 pr-10 text-base text-text-primary outline-none transition placeholder:text-text-muted focus:bg-surface-3"
          />
          {searching && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
            >
              ✕
            </button>
          )}
        </div>

        {searching ? (
          <ul className="mt-3 flex flex-col">
            {results.length > 0 ? (
              results.map((m, i) => (
                <li key={m.path}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => onOpen(m.path)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                      i === active ? 'bg-surface-2' : 'hover:bg-surface-2'
                    }`}
                  >
                    <span className="text-text-muted">
                      <SearchIcon />
                    </span>
                    <span className="truncate text-sm font-medium text-text-primary">{m.title}</span>
                    <span className="ml-auto truncate text-xs text-text-muted">{m.path}</span>
                  </button>
                </li>
              ))
            ) : (
              <li className="px-3 py-6 text-center text-sm text-text-muted">
                No notes match “{query.trim()}”
              </li>
            )}
          </ul>
        ) : (
          <div className="mt-8 flex flex-col gap-7">
            {recent.length > 0 && (
              <Section title="Recent" items={recent} onOpen={onOpen} />
            )}
            {pinnedNotes.length > 0 && (
              <Section title="Pinned" items={pinnedNotes} onOpen={onOpen} />
            )}
            {recent.length === 0 && pinnedNotes.length === 0 && (
              isShared ? (
                <p className="pt-8 text-center text-sm text-text-muted">No notes in {heading} yet.</p>
              ) : (
                <div className="pt-8 text-center">
                  <button
                    type="button"
                    onClick={onNew}
                    className="rounded-xl bg-brand-green px-4 py-2 text-sm font-semibold text-brand-black transition hover:brightness-95"
                  >
                    Create your first note
                  </button>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Section({
  title,
  items,
  onOpen,
}: {
  title: string
  items: { path: string; title: string }[]
  onOpen: (path: string) => void
}) {
  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{title}</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((n) => (
          <button
            key={n.path}
            type="button"
            onClick={() => onOpen(n.path)}
            className="flex flex-col gap-0.5 rounded-xl bg-surface-2 px-3 py-2.5 text-left transition hover:bg-surface-3"
          >
            <span className="truncate text-sm font-medium text-text-primary">{n.title}</span>
            <span className="truncate text-xs text-text-muted">{n.path}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
