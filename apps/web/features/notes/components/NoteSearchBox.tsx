'use client'

// A floating search box for the notes graph: type to match notes, arrow/Enter to
// open. Client-side fuzzy title/path matching answers instantly; when the caller
// supplies `serverSearch`, the query is also sent (debounced) to the fused
// full-text search endpoint, whose snippet-bearing results replace the fuzzy list
// once they arrive. A failed server call silently keeps the fuzzy results.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { NoteMeta } from '@/lib/notes/shared/types'
import type { FusedResult } from '@/lib/notes/shared/retrieval'

interface NoteSearchBoxProps {
  notes: NoteMeta[]
  onOpen: (path: string) => void
  placeholder: string
  /** Debounced full-text search against the server; results carry snippets. */
  serverSearch?: (query: string) => Promise<FusedResult[]>
}

const SERVER_DEBOUNCE_MS = 250

const MAX_RESULTS = 8

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

export function NoteSearchBox({ notes, onOpen, placeholder, serverSearch }: NoteSearchBoxProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  // Server (fused full-text) results for the CURRENT query; null = not arrived
  // (or failed) → the client-side fuzzy list carries the dropdown instead.
  const [serverResults, setServerResults] = useState<FusedResult[] | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchSeq = useRef(0)

  // Fuzzy results over title and path; the better of the two scores wins.
  const fuzzyResults = useMemo(() => {
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

  // Debounced server search. Stale responses are dropped (seq guard); a failed
  // request leaves serverResults null so the fuzzy list keeps working.
  useEffect(() => {
    const seq = ++searchSeq.current
    setServerResults(null)
    const q = query.trim()
    if (!serverSearch || !q) return
    const t = setTimeout(() => {
      serverSearch(q)
        .then((results) => {
          if (searchSeq.current === seq) setServerResults(results)
        })
        .catch(() => {
          /* fall back to client-side fuzzy results */
        })
    }, SERVER_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query, serverSearch])

  // What the dropdown shows: server results (with snippets) once they land,
  // otherwise the instant fuzzy matches. Fuzzy also covers an empty server hit
  // list so quick title/path switching never goes dark mid-flight.
  const results = useMemo(
    () =>
      serverResults && serverResults.length > 0
        ? serverResults.map((r) => ({ path: r.path, title: r.title, snippet: r.snippet }))
        : fuzzyResults.map((m) => ({ path: m.path, title: m.title, snippet: undefined as string | undefined })),
    [serverResults, fuzzyResults],
  )

  useEffect(() => {
    setActive(0)
  }, [query])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setQuery('')
      return
    }
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
    }
  }

  const searching = query.trim() !== ''

  return (
    <div className="relative">
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-muted">
          <SearchIcon />
        </span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="h-14 w-full rounded-2xl border border-border-default bg-surface-1 pl-12 pr-10 text-base text-text-primary shadow-float outline-none transition placeholder:text-text-muted focus:border-brand-green"
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

      {searching && (
        <ul className="absolute inset-x-0 top-full z-20 mt-2 flex max-h-[60vh] flex-col overflow-y-auto rounded-2xl border border-border-default bg-surface-1 p-1 shadow-float">
          {results.length > 0 ? (
            results.map((m, i) => (
              <li key={m.path}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onOpen(m.path)}
                  className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                    i === active ? 'bg-surface-2' : 'hover:bg-surface-2'
                  }`}
                >
                  <span className="mt-0.5 text-text-muted">
                    <SearchIcon />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-3">
                      <span className="truncate text-sm font-medium text-text-primary">{m.title}</span>
                      <span className="ml-auto truncate text-xs text-text-muted">{m.path}</span>
                    </span>
                    {m.snippet && (
                      <span className="mt-0.5 line-clamp-2 block text-xs text-text-muted">{m.snippet}</span>
                    )}
                  </span>
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-6 text-center text-sm text-text-muted">No notes match “{query.trim()}”</li>
          )}
        </ul>
      )}
    </div>
  )
}
