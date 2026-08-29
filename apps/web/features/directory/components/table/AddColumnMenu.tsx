'use client';

// The header's "+" menu (the Attio gesture): the columns the type has but
// this view hides, each one click from showing — and, for an admin, the
// place a NEW field is minted without leaving the table. A viewer sees what
// can be shown; only an admin sees what can be created, because showing is
// theirs and creating is the space's.

import { useEffect, useRef, useState } from 'react';
import AddFieldForm, { type FieldOps } from './AddFieldForm';
import { ColumnKindIcon } from './columnKindIcon';
import { PlusIcon, SearchIcon } from '@/features/shared/icons';
import type { TableColumn } from '@/lib/directory/table';

export default function AddColumnMenu({
  typeName,
  hiddenColumns,
  fields,
  onShow,
  onClose,
}: {
  typeName: string;
  /** The type's columns this view is not showing, in the viewer's order. */
  hiddenColumns: TableColumn[];
  /** Present for admins: the create form. */
  fields?: FieldOps;
  onShow: (key: string) => void;
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

  const query = search.trim().toLowerCase();
  const shown = hiddenColumns.filter((c) => !query || c.label.toLowerCase().includes(query));

  return (
    <>
      {hiddenColumns.length > 0 && (
        <div className="px-2 pb-1 pt-0.5">
          <div className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1.5">
            <SearchIcon className="h-3 w-3 shrink-0 text-text-muted" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a column…"
              className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
              aria-label="Find a column"
            />
          </div>
        </div>
      )}

      <div className="max-h-[280px] overflow-y-auto overscroll-contain custom-scrollbar py-1">
        {shown.map((column) => {
          return (
            <button
              key={column.key}
              type="button"
              role="menuitem"
              onClick={() => { onShow(column.key); onClose(); }}
              className="flex w-full items-center gap-2.5 px-3.5 py-1.5 text-[13px] text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
            >
              <ColumnKindIcon column={column} className="h-3.5 w-3.5 shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1 truncate text-left">{column.label}</span>
              {column.origin === 'tracked' && <span className="shrink-0 text-[11px] text-text-muted">tracked</span>}
            </button>
          );
        })}
        {shown.length === 0 && (
          <p className="px-3.5 py-2 text-xs text-text-muted">
            {hiddenColumns.length === 0 ? 'Every column is already showing.' : 'No matches'}
          </p>
        )}
      </div>

      <div className="border-t border-border-subtle px-3.5 py-1.5">
        {fields ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 py-1 text-[13px] font-semibold text-brand-dark-green hover:underline"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Create a field
          </button>
        ) : (
          <span className="text-[12px] text-text-muted">An admin can add fields to {typeName}.</span>
        )}
      </div>
    </>
  );
}
