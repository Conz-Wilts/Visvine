'use client'

// The property block under a context note's title: a Type row, the node type's
// own fields (email, location, website…), and a Tags row. One component serves
// both the draft surface (/directory/new, everything editable, Type is a menu)
// and a committed entity's Context tab (fields editable, Type a read-only chip),
// so the two never drift apart visually — the create flow IS the destination.
//
// It is deliberately dumb about persistence. The draft holds values in local
// state until commit; the entity panel PATCHes on blur. Both pass `onChange`
// (every keystroke) and `onCommit` (blur / picked a value), and the Type and
// Tags rows are passed in as nodes — that keeps TagCombobox, the optimistic tag
// rollback and the tag-colour registry where they already live and work.

import React, { useRef } from 'react'
import { LocationAutocomplete } from '@/components/create/CreateModalForms'
import { fieldsForType, type TypeFieldDef } from '@/lib/create/typeFields'

const LABEL_CLASS = 'text-[10px] font-semibold uppercase tracking-wide text-text-muted'

// Label above its value, matching NoteMetaRows — the one layout every surface
// that shows a note's type and tags shares.
const ROW_CLASS = 'flex flex-col gap-1'

const INPUT_CLASS =
  'w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[14px] text-text-primary ' +
  'transition placeholder:text-text-muted hover:border-border-subtle focus:border-[color:var(--accent)] ' +
  'focus:bg-surface-1 focus:outline-none'

export interface PropertyRowsProps {
  /** Node type (or the draft's picked type) — drives which fields render. */
  type: string | null | undefined
  values: Record<string, string>
  onChange?: (key: string, value: string) => void
  /** Blur / picked a value — the moment a persisting caller should save. */
  onCommit?: (key: string, value: string) => void
  editable?: boolean
  /** The Type row's control: a read-only chip, or the draft's type menu. */
  typeRow?: React.ReactNode
  /** The Tags row's control, supplied whole so tag logic stays with its owner. */
  tagsRow?: React.ReactNode
  /** Accent for focus rings — the entity's alias/type colour. */
  accent?: string
  /** Called with the file a user picked for an image field (Photo / Logo). */
  onImageRequest?: (file: File) => void
  /** Shown in the image row while a pre-commit crop is held locally. */
  imagePreviewUrl?: string | null
  className?: string
}

export function PropertyRows({
  type,
  values,
  onChange,
  onCommit,
  editable = false,
  typeRow,
  tagsRow,
  accent,
  onImageRequest,
  imagePreviewUrl,
  className = '',
}: PropertyRowsProps) {
  const fields = fieldsForType(type)
  const style = accent ? ({ ['--accent' as string]: accent } as React.CSSProperties) : undefined

  // A field with no value and no way to add one is just an empty label, so hide
  // it in the read-only case. In the editable case every row shows — the point
  // of the surface is telling you what there is to fill in.
  const visible = editable ? fields : fields.filter((f) => values[f.key])

  if (!typeRow && !tagsRow && visible.length === 0) return null

  return (
    <div className={`mt-5 space-y-3 ${className}`} style={style}>
      {typeRow && (
        <div className={ROW_CLASS}>
          <span className={LABEL_CLASS}>Type</span>
          <div className="min-w-0">{typeRow}</div>
        </div>
      )}

      {visible.map((field) => (
        <div key={field.key} className={ROW_CLASS}>
          <span className={LABEL_CLASS}>{field.label}</span>
          <div className="min-w-0">
            <PropertyField
              field={field}
              value={values[field.key] ?? ''}
              editable={editable}
              onChange={onChange}
              onCommit={onCommit}
              onImageRequest={onImageRequest}
              imagePreviewUrl={imagePreviewUrl}
            />
          </div>
        </div>
      ))}

      {tagsRow && (
        <div className={ROW_CLASS}>
          <span className={LABEL_CLASS}>Tags</span>
          <div className="min-w-0">{tagsRow}</div>
        </div>
      )}
    </div>
  )
}

function PropertyField({
  field,
  value,
  editable,
  onChange,
  onCommit,
  onImageRequest,
  imagePreviewUrl,
}: {
  field: TypeFieldDef
  value: string
  editable: boolean
  onChange?: (key: string, value: string) => void
  onCommit?: (key: string, value: string) => void
  onImageRequest?: (file: File) => void
  imagePreviewUrl?: string | null
}) {
  if (field.kind === 'image') {
    return (
      <ImageField
        value={imagePreviewUrl ?? value}
        editable={editable}
        label={field.label}
        onPick={onImageRequest}
      />
    )
  }

  if (!editable) return <ReadOnlyValue field={field} value={value} />

  if (field.kind === 'location') {
    return (
      <LocationField
        value={value}
        placeholder={field.placeholder}
        onChange={(v) => onChange?.(field.key, v)}
        onCommit={(v) => onCommit?.(field.key, v)}
      />
    )
  }

  return (
    <input
      className={INPUT_CLASS}
      type={field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : 'text'}
      inputMode={field.kind === 'email' ? 'email' : undefined}
      placeholder={field.placeholder ?? 'Empty'}
      value={value}
      onChange={(e) => onChange?.(field.key, e.target.value)}
      onBlur={(e) => onCommit?.(field.key, e.target.value)}
      aria-label={field.label}
    />
  )
}

/**
 * LocationAutocomplete owns its own input and has no blur hook, so the commit
 * fires from a wrapper that watches for the value settling — a picked
 * suggestion and a typed-then-blurred string both need to save.
 */
function LocationField({
  value,
  placeholder,
  onChange,
  onCommit,
}: {
  value: string
  placeholder?: string
  onChange: (v: string) => void
  onCommit: (v: string) => void
}) {
  const committed = useRef(value)
  return (
    <div
      onBlur={() => {
        if (committed.current === value) return
        committed.current = value
        onCommit(value)
      }}
    >
      <LocationAutocomplete value={value} onChange={onChange} placeholder={placeholder ?? 'Empty'} />
    </div>
  )
}

function ReadOnlyValue({ field, value }: { field: TypeFieldDef; value: string }) {
  if (!value) return null
  if (field.kind === 'url') {
    const href = /^https?:\/\//i.test(value) ? value : `https://${value}`
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="truncate text-[14px] text-text-primary underline decoration-border-default underline-offset-2 transition hover:decoration-current"
      >
        {value}
      </a>
    )
  }
  if (field.kind === 'email') {
    return (
      <a href={`mailto:${value}`} className="truncate text-[14px] text-text-primary underline decoration-border-default underline-offset-2 transition hover:decoration-current">
        {value}
      </a>
    )
  }
  return <span className="block truncate px-2 py-1 text-[14px] text-text-primary">{value}</span>
}

function ImageField({
  value,
  editable,
  label,
  onPick,
}: {
  value: string
  editable: boolean
  label: string
  onPick?: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  if (!editable) {
    if (!value) return null
    return (
      <img src={value} alt={label} className="h-12 w-12 rounded-lg border border-border-subtle object-cover" />
    )
  }

  return (
    <div className="flex items-center gap-2">
      {value && (
        <img src={value} alt={label} className="h-12 w-12 rounded-lg border border-border-subtle object-cover" />
      )}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="rounded-md border border-dashed border-border-default px-2.5 py-1 text-[13px] font-medium text-text-muted transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
      >
        {value ? 'Replace' : `Add ${label.toLowerCase()}`}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Reset first: picking the same file twice in a row fires no change
          // event otherwise, and a re-crop of one photo is a normal thing to do.
          e.target.value = ''
          if (file) onPick?.(file)
        }}
      />
    </div>
  )
}
