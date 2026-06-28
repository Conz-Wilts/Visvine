'use client'

// A small modal for creating a note or a folder: a name and a parent folder.
// The caller turns the (name, folder) into a path + default content.

import { useEffect, useRef, useState } from 'react'

interface CreateModalProps {
  kind: 'note' | 'folder'
  folders: string[]
  defaultFolder?: string
  onSubmit: (name: string, folder: string) => void
  onClose: () => void
}

export function CreateModal({ kind, folders, defaultFolder = '', onSubmit, onClose }: CreateModalProps) {
  const [name, setName] = useState('')
  const [folder, setFolder] = useState(defaultFolder)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSubmit(trimmed, folder)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[18vh] px-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border-subtle bg-surface-1 p-5 shadow-float"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-text-primary">
          {kind === 'note' ? 'New note' : 'New folder'}
        </h2>
        <label className="mt-4 block text-xs font-medium text-text-secondary">
          {kind === 'note' ? 'Title' : 'Folder name'}
        </label>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onClose()
          }}
          placeholder={kind === 'note' ? 'Untitled' : 'Folder'}
          className="mt-1 w-full rounded-xl border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-primary focus:border-brand-green focus:outline-none"
        />

        <label className="mt-3 block text-xs font-medium text-text-secondary">In folder</label>
        <select
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          className="mt-1 w-full rounded-xl border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-primary focus:border-brand-green focus:outline-none"
        >
          <option value="">(root)</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-3 py-2 text-sm font-semibold text-text-muted transition hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim()}
            className="rounded-xl bg-brand-green px-4 py-2 text-sm font-semibold text-brand-black transition hover:brightness-95 disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
