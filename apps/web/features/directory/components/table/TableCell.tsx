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
import { Chip } from '@visvine/ui';
import { ExternalLinkIcon } from '@/features/shared/icons';
import { tagPalette } from '@/lib/tagColors';
import { cellHref, editValue, formatCell, parseCellInput, type TableColumn } from '@/lib/directory/table';

interface TableCellProps {
  column: TableColumn;
  value: unknown;
  /** Colour for the Type chip. */
  aliasColor?: string | null;
  /** What the row's type is called, for a row wearing no alias. */
  typeLabel?: string | null;
  tagColors?: Record<string, string> | null;
  /** Absent when the viewer can't edit here (a global record, say). */
  onSave?: (value: unknown) => Promise<void>;
  /** For an empty select cell: the option the row's note suggests, marked in the menu for the person to pick. */
  suggest?: () => Promise<string | null>;
  /** Open in the editor rather than waiting for a click (the name cell's rename). */
  autoEdit?: boolean;
  /** The editor closed — by a save or an escape. */
  onDone?: () => void;
}

// The editor fills the cell it opens in, with the text where the value was,
// and the ring inside the cell's own edges: the cell lights up, nothing
// floats over the grid.
const INPUT_CLASS =
  'h-full w-full bg-surface px-4 text-sm text-fg outline-none ring-1 ring-inset ring-[var(--vv-color-accent)]';

export default function TableCell({ column, value, aliasColor, typeLabel, tagColors, onSave, suggest, autoEdit = false, onDone }: TableCellProps) {
  const [draft, setDraft] = useState<string | null>(autoEdit ? editValue(value, column) : null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [suggested, setSuggested] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);
  const editable = column.editable && !!onSave;

  useEffect(() => {
    if (draft !== null) inputRef.current?.focus();
  }, [draft]);

  const begin = () => {
    if (!editable || saving) return;
    setError(null);
    setDraft(editValue(value, column));
    if (column.kind === 'select' && suggest && !editValue(value, column)) {
      void suggest().then(setSuggested, () => undefined);
    }
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
      <div className="flex h-full items-center px-4">
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
          className="h-4 w-4 cursor-pointer accent-[var(--vv-color-accent)] disabled:cursor-default"
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
      className: clsx(INPUT_CLASS, error && 'ring-danger-bright'),
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
      <div className="h-full">
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
              <option key={o} value={o}>{o === suggested ? `${o} · suggested` : o}</option>
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
      </div>
    );
  }

  const text = formatCell(value, column);
  const href = cellHref(value, column);

  let body: React.ReactNode;
  if (column.kind === 'alias') {
    // The alias the space gave the row — Founder, Portfolio Company — or, for
    // a row wearing none, what its type is called. The column is Type either
    // way, so it is never blank.
    const label = text || typeLabel;
    body = label ? <Chip color={aliasColor ?? undefined} size="sm">{label}</Chip> : null;
  } else if (column.kind === 'tags' && Array.isArray(value) && value.length > 0) {
    body = (
      <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        {value.map((t) => (
          <Chip key={String(t)} color={tagPalette(String(t), tagColors ?? null).base} size="sm">{String(t)}</Chip>
        ))}
      </span>
    );
  } else if (column.kind === 'select' && text) {
    // A select option wears a steady colour the way a tag does — hashed from
    // its own text, so every row's "Won" is the same pill.
    body = <Chip color={tagPalette(text, null).base} size="sm">{text}</Chip>;
  } else if (href) {
    // A mail or web cell wears a standing underline, the way an address in a
    // CRM row does: it is the one kind of cell that leaves the app, and a
    // hover-only underline makes a column of them read as plain text. The
    // arrow is the confirmation that it opens elsewhere and only appears
    // under the pointer, where it can't crowd every row's value.
    body = (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="group/link inline-flex min-w-0 items-center gap-1 truncate text-fg underline decoration-line decoration-1 underline-offset-[3px] transition-colors hover:decoration-fg-muted"
      >
        <span className="truncate">{text}</span>
        <ExternalLinkIcon className="h-3 w-3 shrink-0 text-fg-muted opacity-0 transition-opacity group-hover/link:opacity-100" />
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
        'flex h-full min-w-0 items-center px-4 text-sm text-fg',
        column.kind === 'number' && 'justify-end',
        editable && 'cursor-text rounded-md outline-none focus-visible:ring-1 focus-visible:ring-line',
        saving && 'opacity-60',
      )}
    >
      {body}
    </div>
  );
}
