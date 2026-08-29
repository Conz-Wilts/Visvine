'use client';

// One column's menu, off its header: sort either way, step it left or
// right, hide it — and, for an admin on a tracked field, rename it or stop
// tracking it. The shape is the data-grid one (Attio): the header names the
// attribute, the menu is what can be done to it, and nothing here needs a
// second surface to finish except the remove, which asks first.

import { useState } from 'react';
import { clsx } from 'clsx';
import AddFieldForm, { type FieldOps } from './AddFieldForm';
import { ColumnKindIcon } from './columnKindIcon';
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CheckIcon,
  EyeOffIcon,
  PencilIcon,
  XIcon,
} from '@/features/shared/icons';
import type { TableColumn, TableSort } from '@/lib/directory/table';
import type { TrackedFieldKind } from '@/lib/types';

const ITEM_CLASS =
  'flex w-full items-center gap-2.5 px-3.5 py-1.5 text-[13px] text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:pointer-events-none disabled:opacity-40';

export default function ColumnHeaderMenu({
  column,
  typeName,
  sort,
  canMoveLeft,
  canMoveRight,
  fields,
  onSort,
  onMove,
  onHide,
  onRemove,
  onClose,
}: {
  column: TableColumn;
  typeName: string;
  sort: TableSort | null;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  /** Present for admins; the edit and remove rows exist only for a tracked column. */
  fields?: FieldOps;
  onSort: (sort: TableSort | null) => void;
  onMove: (dir: -1 | 1) => void;
  onHide: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const active = sort?.key === column.key ? sort.dir : null;
  const canEdit = !!fields && column.origin === 'tracked';

  const sortBy = (dir: 'asc' | 'desc') => {
    // Asking for the order it already has takes it off instead.
    onSort(active === dir ? null : { key: column.key, dir });
    onClose();
  };

  if (editing && fields) {
    return (
      <div className="px-3.5 py-1.5">
        <AddFieldForm
          typeName={typeName}
          saving={fields.saving}
          error={fields.error}
          // A tracked column's kind is always one of the tracked kinds.
          initial={{ label: column.label, kind: column.kind as TrackedFieldKind, options: column.options }}
          onSubmit={async (input) => {
            const ok = await fields.update(column.key, { label: input.label, options: input.options });
            if (ok) onClose();
          }}
          onCancel={() => {
            fields.clearError();
            setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 px-3.5 pb-1.5 pt-0.5">
        <ColumnKindIcon column={column} className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        <span className="truncate text-[12px] font-semibold text-text-muted">{column.label}</span>
        {column.origin === 'tracked' && <span className="shrink-0 text-[11px] font-normal text-text-muted">tracked</span>}
      </div>
      <div className="border-t border-border-subtle py-1">
        <button type="button" role="menuitem" onClick={() => sortBy('asc')} className={ITEM_CLASS}>
          <ArrowUpIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">Sort ascending</span>
          {active === 'asc' && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-brand-green" />}
        </button>
        <button type="button" role="menuitem" onClick={() => sortBy('desc')} className={ITEM_CLASS}>
          <ArrowDownIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">Sort descending</span>
          {active === 'desc' && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-brand-green" />}
        </button>
      </div>
      <div className="border-t border-border-subtle py-1">
        <button
          type="button"
          role="menuitem"
          disabled={!canMoveLeft}
          onClick={() => { onMove(-1); onClose(); }}
          className={ITEM_CLASS}
        >
          <ArrowLeftIcon className="h-3.5 w-3.5 shrink-0" />
          Move left
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={!canMoveRight}
          onClick={() => { onMove(1); onClose(); }}
          className={ITEM_CLASS}
        >
          <ArrowRightIcon className="h-3.5 w-3.5 shrink-0" />
          Move right
        </button>
        {column.source !== 'name' && (
          <button type="button" role="menuitem" onClick={() => { onHide(); onClose(); }} className={ITEM_CLASS}>
            <EyeOffIcon className="h-3.5 w-3.5 shrink-0" />
            Hide column
          </button>
        )}
      </div>
      {canEdit && (
        <div className="border-t border-border-subtle py-1">
          <button type="button" role="menuitem" onClick={() => setEditing(true)} className={ITEM_CLASS}>
            <PencilIcon className="h-3.5 w-3.5 shrink-0" />
            Edit field
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { onRemove(); onClose(); }}
            className={clsx(ITEM_CLASS, 'hover:text-red-600')}
          >
            <XIcon className="h-3.5 w-3.5 shrink-0" />
            Stop tracking
          </button>
        </div>
      )}
    </>
  );
}
