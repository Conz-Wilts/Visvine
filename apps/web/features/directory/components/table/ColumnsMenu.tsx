'use client';

// The Columns menu, opened from the table's last column (the Attio gesture):
// every column the type has, each with a check that shows or hides it for this
// viewer alone (useTableView keeps it in their browser), and a way back to the
// defaults — and, for an admin, the place a NEW field is minted without
// leaving the table. A viewer chooses what they see; only an admin sees what
// can be created, because showing is theirs and creating is the space's.
//
// The name column is not listed: a row without its name is not a row.

import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import AddFieldForm, { type FieldOps } from './AddFieldForm';
import { ColumnKindIcon } from './columnKindIcon';
import { CheckIcon, PlusIcon, SearchIcon } from '@/features/shared/icons';
import type { TableColumn } from '@/lib/directory/table';

export default function ColumnsMenu({
  typeName,
  columns,
  shown,
  fields,
  onToggle,
  onReset,
  onClose,
}: {
  typeName: string;
  /** Every column the type has, in the viewer's order. */
  columns: TableColumn[];
  /** The keys this view is showing. */
  shown: ReadonlySet<string>;
  /** Present for admins: the create form. */
  fields?: FieldOps;
  onToggle: (key: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!creating) searchRef.current?.focus();
  }, [creating]);

  if (creating && fields) {
    return (
      <div className="px-3.5 py-1.5">
        <AddFieldForm
          typeName={typeName}
          saving={fields.saving}
          error={fields.error}
          onSubmit={async (input) => {
            const ok = await fields.add(input);
            if (ok) onClose();
          }}
          onCancel={() => {
            fields.clearError();
            setCreating(false);
          }}
        />
      </div>
    );
  }

  const choosable = columns.filter((c) => c.source !== 'name');
  const query = search.trim().toLowerCase();
  const listed = choosable.filter((c) => !query || c.label.toLowerCase().includes(query));

  return (
    <>
      {choosable.length > 0 && (
        <div className="px-2 pb-1 pt-0.5">
          <div className="flex items-center gap-1.5 rounded-md bg-surface-subtle px-2 py-1.5">
            <SearchIcon className="h-3 w-3 shrink-0 text-fg-muted" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a column…"
              className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-muted"
              aria-label="Find a column"
            />
          </div>
        </div>
      )}

      <div className="max-h-[280px] overflow-y-auto overscroll-contain custom-scrollbar py-1">
        {listed.map((column) => {
          const on = shown.has(column.key);
          return (
            <button
              key={column.key}
              type="button"
              role="menuitemcheckbox"
              aria-checked={on}
              onClick={() => onToggle(column.key)}
              className={clsx(
                'flex w-full items-center gap-2.5 px-3.5 py-1.5 text-[13px] transition-colors hover:bg-surface-subtle hover:text-fg',
                on ? 'text-fg' : 'text-fg-muted',
              )}
            >
              <ColumnKindIcon column={column} className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
              <span className="min-w-0 flex-1 truncate text-left">{column.label}</span>
              {column.origin === 'tracked' && <span className="shrink-0 text-[11px] text-fg-muted">tracked</span>}
              <CheckIcon className={clsx('h-3.5 w-3.5 shrink-0 text-accent', !on && 'invisible')} />
            </button>
          );
        })}
        {listed.length === 0 && query && <p className="px-3.5 py-2 text-xs text-fg-muted">No matches</p>}
      </div>

      <div className="flex items-center gap-3 border-t border-line-subtle px-3.5 py-1.5">
        <button
          type="button"
          onClick={onReset}
          className="py-1 text-[13px] text-fg-secondary hover:text-fg"
        >
          Reset
        </button>
        {fields && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="ml-auto inline-flex items-center gap-1.5 py-1 text-[13px] font-semibold text-accent-strong hover:underline"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Create a field
          </button>
        )}
      </div>
    </>
  );
}
