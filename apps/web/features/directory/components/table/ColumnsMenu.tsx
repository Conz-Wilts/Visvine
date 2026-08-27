'use client';

// The table's "Columns" menu: every column the type has, in the viewer's
// order, each with a switch and a nudge up or down — and, for an admin, the
// place a type grows a field.
//
// Two audiences share the one menu because they are looking at the same
// list. What a viewer does here (hide, reorder) is theirs and stays in their
// browser; what an admin does (add a field, remove one) changes what the
// space tracks and lands on the space record, so those rows say so with a
// "tracked" mark and a remove that asks first.

import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { useClickOutside } from '@/features/shared/hooks/useClickOutside';
import {
  DROPDOWN_TRIGGER_CLASS,
  DROPDOWN_MENU_CLASS,
  DROPDOWN_TRIGGER_IDLE_STYLE,
} from '@/components/ui/Dropdown';
import { Alert, Button, ConfirmDialog, Input } from '@/components/ui';
import Select from '@/components/ui/Select';
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, XIcon } from '@/features/shared/icons';
import { TRACKED_FIELD_KINDS, isHidden, type TableColumn, type TableView } from '@/lib/directory/table';
import type { TrackedFieldKind } from '@/lib/types';

interface ColumnsMenuProps {
  /** The type's display name, for the add form ("Add a Person field"). */
  typeName: string;
  arranged: TableColumn[];
  view: TableView;
  onToggle: (key: string) => void;
  onMove: (key: string, dir: -1 | 1) => void;
  onReset: () => void;
  /** Present for admins: the field editor. */
  fields?: {
    saving: boolean;
    error: string | null;
    clearError: () => void;
    add: (input: { label: string; kind: TrackedFieldKind; options?: string[] }) => Promise<boolean>;
    remove: (key: string) => Promise<boolean>;
  };
}

export default function ColumnsMenu({ typeName, arranged, view, onToggle, onMove, onReset, fields }: ColumnsMenuProps) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<TableColumn | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => {
    if (!removing) setOpen(false);
  });

  useEffect(() => {
    if (!open) {
      setAdding(false);
      fields?.clearError();
    }
    // The menu resets its own state on close; clearError is stable enough
    // not to be a dependency worth re-running this for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const hiddenCount = arranged.filter((c) => isHidden(view, c.key)).length;
  const customised = view.order.length > 0 || view.hidden.length > 0 || Object.keys(view.widths).length > 0;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={DROPDOWN_TRIGGER_CLASS}
        style={DROPDOWN_TRIGGER_IDLE_STYLE}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ChevronDownIcon className={clsx('h-4 w-4 transition-transform duration-200', open && 'rotate-180')} />
        <span>Columns</span>
        {hiddenCount > 0 && <span className="text-text-muted">{hiddenCount} hidden</span>}
      </button>

      {open && (
        <div className={clsx(DROPDOWN_MENU_CLASS, 'left-auto right-0 w-[320px]')} role="menu">
          <div className="max-h-[360px] overflow-y-auto overscroll-contain custom-scrollbar py-1">
            {arranged.map((column, index) => {
              const shown = !isHidden(view, column.key);
              return (
                <div
                  key={column.key}
                  className="group flex items-center gap-2 py-1.5 pl-4 pr-2 text-sm transition-colors hover:bg-surface-2"
                >
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={shown}
                    onClick={() => onToggle(column.key)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
                      style={
                        shown
                          ? { backgroundColor: 'var(--color-brand-green)', border: '1.5px solid var(--color-brand-green)' }
                          : { border: '1.5px solid var(--color-border-default)', backgroundColor: 'var(--color-surface-1)' }
                      }
                    >
                      {shown && (
                        <svg className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span className={clsx('truncate', shown ? 'text-text-primary' : 'text-text-secondary')}>
                      {column.label}
                    </span>
                    {column.origin === 'tracked' && (
                      <span className="shrink-0 text-[11px] text-text-muted">tracked</span>
                    )}
                  </button>
                  <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => onMove(column.key, -1)}
                      disabled={index === 0}
                      aria-label={`Move ${column.label} up`}
                      className="rounded p-1 text-text-muted hover:text-text-primary disabled:opacity-30"
                    >
                      <ChevronUpIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMove(column.key, 1)}
                      disabled={index === arranged.length - 1}
                      aria-label={`Move ${column.label} down`}
                      className="rounded p-1 text-text-muted hover:text-text-primary disabled:opacity-30"
                    >
                      <ChevronDownIcon className="h-3.5 w-3.5" />
                    </button>
                    {fields && column.origin === 'tracked' && (
                      <button
                        type="button"
                        onClick={() => setRemoving(column)}
                        aria-label={`Stop tracking ${column.label}`}
                        className="rounded p-1 text-text-muted hover:text-red-600"
                      >
                        <XIcon className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="border-t border-border-subtle px-4 py-2">
            {fields && adding ? (
              <AddFieldForm
                typeName={typeName}
                saving={fields.saving}
                error={fields.error}
                onCancel={() => { setAdding(false); fields.clearError(); }}
                onAdd={async (input) => {
                  const ok = await fields.add(input);
                  if (ok) setAdding(false);
                }}
              />
            ) : (
              <div className="flex items-center justify-between gap-3">
                {fields ? (
                  <button
                    type="button"
                    onClick={() => setAdding(true)}
                    className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-dark-green hover:underline"
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                    Track a field
                  </button>
                ) : (
                  <span className="text-[12px] text-text-muted">An admin can add fields to {typeName}.</span>
                )}
                {customised && (
                  <button
                    type="button"
                    onClick={onReset}
                    className="text-[13px] font-medium text-text-muted hover:text-text-secondary"
                  >
                    Reset
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={removing ? `Stop tracking “${removing.label}”?` : ''}
        body={
          <>
            The column goes for everyone in the space. Values already entered stay on each entry&apos;s record and
            note — nothing is deleted — but nobody sees or edits them here until the field is tracked again.
          </>
        }
        confirmLabel="Stop tracking"
        destructive
        error={fields?.error ?? undefined}
        onConfirm={async () => {
          if (!removing || !fields) return;
          const ok = await fields.remove(removing.key);
          if (ok) setRemoving(null);
        }}
        onClose={() => { setRemoving(null); fields?.clearError(); }}
      />
    </div>
  );
}

function AddFieldForm({
  typeName,
  saving,
  error,
  onAdd,
  onCancel,
}: {
  typeName: string;
  saving: boolean;
  error: string | null;
  onAdd: (input: { label: string; kind: TrackedFieldKind; options?: string[] }) => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<TrackedFieldKind>('text');
  const [options, setOptions] = useState('');
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    labelRef.current?.focus();
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void onAdd({
      label,
      kind,
      ...(kind === 'select' ? { options: options.split(/[,\n]/) } : {}),
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 py-1">
      <p className="text-[12px] text-text-muted">
        A new column for every {typeName}, kept on each record and in its note.
      </p>
      <Input
        ref={labelRef}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Field name, e.g. Deal stage"
        maxLength={40}
        className="h-9 px-3 py-0 text-sm"
        aria-label="Field name"
      />
      <Select value={kind} onChange={(e) => setKind(e.target.value as TrackedFieldKind)} aria-label="Field kind">
        {TRACKED_FIELD_KINDS.map((k) => (
          <option key={k.value} value={k.value}>{k.label}</option>
        ))}
      </Select>
      {kind === 'select' && (
        <Input
          value={options}
          onChange={(e) => setOptions(e.target.value)}
          placeholder="Options, comma separated"
          className="h-9 px-3 py-0 text-sm"
          aria-label="Options"
        />
      )}
      {error && <Alert variant="error" inline>{error}</Alert>}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="submit" variant="brand" loading={saving} disabled={!label.trim()}>Add</Button>
      </div>
    </form>
  );
}
