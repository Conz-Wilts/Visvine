'use client'

import { Tabs, type TabOption } from '@visvine/ui'

export type NoteMode = 'wysiwyg' | 'raw'

// The Editor/Raw pill for the profile Context tab's note editor.
const MODE_OPTIONS: TabOption<NoteMode>[] = [
  {
    id: 'wysiwyg',
    label: 'Editor',
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    ),
  },
  {
    id: 'raw',
    label: 'Raw',
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
  },
]

export function NoteModeToggle({
  value,
  onChange,
  size = 'sm',
}: {
  value: NoteMode
  onChange: (mode: NoteMode) => void
  size?: 'md' | 'sm'
}) {
  return <Tabs options={MODE_OPTIONS} value={value} onChange={onChange} size={size} />
}
