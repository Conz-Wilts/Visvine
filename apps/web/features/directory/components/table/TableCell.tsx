'use client';

// One cell of the Directory table: its value as text, and — for a column
// that takes edits — the input that replaces it on click. The cell owns
// nothing but its draft; the row's data and the save go through the table.
//
// The editor matches the column's kind (a date picker for a date, a select
// for a select, a checkbox that toggles in place) so a value can only be
// typed the way it will be stored. Enter or blur saves, Escape drops the
// draft. A refused value (a number that isn't one) stays in the editor with
// the reason under the pointer rather than being written as text and sorting
// two ways.

import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import Chip from '@/components/ui/Chip';
import { ExternalLinkIcon } from '@/features/shared/icons';
import { tagPalette } from '@/lib/tagColors';
import { cellHref, editValue, formatCell, parseCellInput, type TableColumn } from '@/lib/directory/table';

interface TableCellProps {
  column: TableColumn;
  value: unknown;
  /** Colour for an alias chip. */
  aliasColor?: string | null;
  tagColors?: Record<string, string> | null;
  /** Absent when the viewer can't edit here (a global record, say). */
  onSave?: (value: unknown) => Promise<void>;
  /** Open in the editor rather than waiting for a click (the name cell's rename). */
  autoEdit?: boolean;
  /** The editor closed — by a save or an escape. */
  onDone?: () => void;
}

const INPUT_CLASS =
  'h-8 w-full rounded-md bg-surface-1 px-2 text-sm text-text-primary outline-none ring-1 ring-border-default';

export default function TableCell({ column, value, aliasColor, tagColors, onSave, autoEdit = false, onDone }: TableCellProps) {
  const [draft, setDraft] = useState<string | null>(autoEdit ? editValue(value, column) : null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);
  const editable = column.editable && !!onSave;

  useEffect(() => {
    if (draft !== null) inputRef.current?.focus();
  }, [draft]);

  const begin = () => {
    if (!editable || saving) return;
    setError(null);
    setDraft(editValue(value, column));
  };

  const cancel = () => {
    setDraft(null);
    setError(null);
    onDone?.();
  };

  const commit = async (raw: string) => {
    if (!onSave) return;
    const parsed = parseCellInput(raw, column);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    // Nothing changed: leave without a write.
    if (editValue(parsed.value, column) === editValue(value, column)) {
      cancel();
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed.value);
      setDraft(null);
      setError(null);
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  // A checkbox is the one kind with no draft: the click is the edit.
  if (column.kind === 'checkbox') {
    const checked = value === true || value === 'true';
    return (
      <div className="flex h-full items-center px-3">
        <input
          type="checkbox"
          checked={checked}
          disabled={!editable || saving}
          onChange={() => {
            if (!onSave) return;
            setSaving(true);
            onSave(!checked)
              .catch((e) => setError(e instanceof Error ? e.message : 'Could not save'))
              .finally(() => setSaving(false));
          }}
          aria-label={column.label}
          title={error ?? undefined}
          className="h-4 w-4 cursor-pointer accent-[var(--color-brand-green)] disabled:cursor-default"
        />
      </div>
    );
  }

  if (draft !== null) {
    const shared = {
      ref: inputRef as React.RefObject<HTMLInputElement & HTMLSelectElement>,
      value: draft,
      disabled: saving,
      title: error ?? undefined,
      className: clsx(INPUT_CLASS, error && 'ring-red-500'),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void commit(draft);
        }
        if (e.key === 'Escape') cancel();
      },
      onBlur: () => void commit(draft),
    };
    return (
      <div className="flex h-full flex-col justify-center px-1.5">
        {column.kind === 'select' ? (
          <select
            {...shared}
            onChange={(e) => {
              setDraft(e.target.value);
              void commit(e.target.value);
            }}
          >
            <option value="">—</option>
            {(column.options ?? []).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        ) : (
          <input
            {...shared}
            type={column.kind === 'date' ? 'date' : column.kind === 'number' ? 'text' : column.kind === 'email' ? 'email' : 'text'}
            inputMode={column.kind === 'number' ? 'decimal' : undefined}
            placeholder={column.kind === 'tags' ? 'tag, tag' : undefined}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
          />
        )}
        {error && <span className="mt-0.5 truncate text-[11px] text-red-600">{error}</span>}
      </div>
    );
  }

  const text = formatCell(value, column);
  const href = cellHref(value, column);

  let body: React.ReactNode;
  if (column.kind === 'alias') {
    body = text ? <Chip color={aliasColor ?? undefined} size="xs">{text}</Chip> : null;
  } else if (column.kind === 'tags' && Array.isArray(value) && value.length > 0) {
    body = (
      <span className="flex min-w-0 items-center gap-1 overflow-hidden">
        {value.map((t) => (
          <Chip key={String(t)} color={tagPalette(String(t), tagColors ?? null).base} size="xs">{String(t)}</Chip>
        ))}
      </span>
    );
  } else if (column.kind === 'select' && text) {
    body = <Chip size="xs">{text}</Chip>;
  } else if (href) {
    body = (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex min-w-0 items-center gap-1 truncate text-text-primary hover:underline"
      >
        <span className="truncate">{text}</span>
        <ExternalLinkIcon className="h-3 w-3 shrink-0 text-text-muted" />
      </a>
    );
  } else {
    body = <span className={clsx('truncate', column.kind === 'number' && 'tabular-nums')}>{text}</span>;
  }

  return (
    <div
      role={editable ? 'button' : undefined}
      tabIndex={editable ? 0 : undefined}
      onClick={editable ? begin : undefined}
      onKeyDown={editable ? (e) => { if (e.key === 'Enter') begin(); } : undefined}
      title={error ?? (editable ? undefined : text || undefined)}
      className={clsx(
        'flex h-full min-w-0 items-center px-3 text-sm text-text-primary',
        column.kind === 'number' && 'justify-end',
        editable && 'cursor-text rounded-md outline-none focus-visible:ring-1 focus-visible:ring-border-default',
        saving && 'opacity-60',
      )}
    >
      {body}
    </div>
  );
}
