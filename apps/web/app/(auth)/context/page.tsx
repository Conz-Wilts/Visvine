'use client'

/**
 * Notes — a community-scoped, DB-backed markdown knowledge surface. Each
 * community has a shared "Community brain" (all members) and each member has a
 * personal brain; the workspace toggles between them. Notes are markdown with
 * YAML frontmatter, OKF [[links]], a force-directed link graph, backlinks,
 * related-notes, revision history, trash, and optional AI assist — ported from
 * the blackbird-brain app into Visvine's design system. See lib/notes/* for the
 * store + pure logic and app/api/notes/* for the REST surface.
 */

import { Suspense } from 'react'
import { NotesWorkspace } from '@/features/notes/components/NotesWorkspace'

export default function NotesPage() {
  // Suspense boundary: NotesWorkspace reads useSearchParams (the ?new=note hand-off
  // from the global "Create new → Context" tile).
  return (
    <Suspense fallback={null}>
      <NotesWorkspace />
    </Suspense>
  )
}
