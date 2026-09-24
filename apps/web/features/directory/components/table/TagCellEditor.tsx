'use client';

// A Tags cell being edited, the way a multi-select cell opens in Attio: a
// panel lies over the cell, its top edge on the cell's, holding the row's tags
// as chips with the cursor after them, and under that every tag the space
// knows, the ones on the row checked. Typing narrows the list; Enter or a
// click toggles the lit tag; Backspace in an empty field takes the last chip
// off; a name nobody has used yet offers Create, in an automatic colour or one
// of the swatches — the same choice the note's tag picker offers
// (features/notes/components/TagCombobox.tsx).
//
// Every change saves as it is made, in order, so closing the panel is never a
// save step: Escape, Tab or a click outside only closes it.
//
// Portalled to the body at a fixed position for the reason the header menus
// are (HeaderPopover): the table is its own scroll box, and anything drawn
// inside it is clipped. It follows the cell as the table scrolls — focusing a
// half-visible cell scrolls it into view the moment the panel opens.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { Chip, SEARCH_MENU_ROW, SearchMenuList, searchMenuRowState, useSearchMenuCursor } from '@visvine/ui';
import { CheckIcon } from '@/features/shared/icons';
import { TAG_SWATCHES, resolveTagBase, tagKey, tagPalette } from '@/lib/tagColors';

const MAX_TAG_LENGTH = 40;
const MIN_WIDTH = 300;

type Row = { kind: 'tag'; value: string } | { kind: 'create'; value: string };

export default function TagCellEditor({
  anchor,
  value,
  pool,
  colors,
  onSave,
  onCreate,
  onClose,
}: {
  /** The cell the panel lies over. */
  anchor: HTMLElement;
  /** The row's tags when the editor opened. */
  value: string[];
  /** Every tag the space knows. */
  pool: string[];
  colors: Record<string, string> | null;
  onSave: (tags: string[]) => Promise<void>;
  /** A brand-new tag's colour, registered on the space. */
  onCreate?: (tag: string, color: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [tags, setTags] = useState<string[]>(() => [...new Set(value)]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  // Saves run one after another, so a quick add-then-remove lands in order.
  const queue = useRef<Promise<void>>(Promise.resolve());

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const width = Math.max(r.width, MIN_WIDTH);
      setPos({ top: r.top, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width });
    };
    place();
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) return;
      place();
    };
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const commit = (next: string[]) => {
    setTags(next);
    setError(null);
    queue.current = queue.current
      .then(() => onSave(next))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not save'));
  };

  const onRow = new Set(tags.map(tagKey));
  const toggle = (tag: string) => {
    commit(onRow.has(tagKey(tag)) ? tags.filter((t) => tagKey(t) !== tagKey(tag)) : [...tags, tag]);
    setDraft('');
    inputRef.current?.focus();
  };
  const create = (tag: string, color: string) => {
    onCreate?.(tag, color);
    toggle(tag);
  };

  // The space's tags, one per key, the row's own included so a tag used
  // nowhere else still shows checked.
  const known = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const t of [...pool, ...value]) {
      const key = tagKey(t);
      if (key && !byKey.has(key)) byKey.set(key, t.trim());
    }
    for (const key of Object.keys(colors ?? {})) if (key && !byKey.has(key)) byKey.set(key, key);
    return [...byKey.values()].sort((a, b) => a.localeCompare(b));
  }, [pool, value, colors]);

  const trimmed = draft.trim();
  const query = trimmed.toLowerCase();
  const matches = query ? known.filter((t) => t.toLowerCase().includes(query)) : known;
  const showCreate = !!trimmed && !known.some((t) => tagKey(t) === tagKey(trimmed)) && !onRow.has(tagKey(trimmed));
  const rows: Row[] = [
    ...matches.map((v) => ({ kind: 'tag' as const, value: v })),
    ...(showCreate ? [{ kind: 'create' as const, value: trimmed }] : []),
  ];
  const choose = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === 'create') create(row.value, resolveTagBase(row.value, colors));
    else toggle(row.value);
  };
  const cursor = useSearchMenuCursor({ count: rows.length, resetKey: query, onChoose: (i) => choose(rows[i]), onClose });

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      e.preventDefault();
      commit(tags.slice(0, -1));
      return;
    }
    if (e.key === 'Tab') {
      onClose();
      return;
    }
    // A comma ends a name the way Enter does — the gesture a tag field teaches.
    if (e.key === ',' && trimmed) {
      e.preventDefault();
      const existing = known.find((t) => tagKey(t) === tagKey(trimmed));
      if (existing) {
        if (!onRow.has(tagKey(existing))) toggle(existing);
        else setDraft('');
      } else create(trimmed, resolveTagBase(trimmed, colors));
      return;
    }
    cursor.onKeyDown(e);
  };

  if (!pos) return null;

  return createPortal(
    <div
      ref={panelRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
      // React events bubble through a portal to the cell behind it; the
      // panel's clicks and keys are its own.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className="z-50 overflow-hidden rounded-lg border border-line-subtle bg-surface shadow-float"
    >
      <div
        className={clsx(
          'flex min-h-11 flex-wrap items-center gap-1.5 border-b border-line-subtle px-3 py-2',
          error && 'shadow-[inset_0_0_0_1px_var(--vv-color-danger-bright)]',
        )}
        title={error ?? undefined}
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((t) => (
          <Chip key={tagKey(t)} size="sm" color={tagPalette(t, colors).base} onRemove={() => toggle(t)} removeLabel={`Remove ${t}`}>
            {t}
          </Chip>
        ))}
        <input
          ref={inputRef}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={MAX_TAG_LENGTH}
          placeholder={tags.length ? '' : 'Search or create…'}
          aria-label="Tags"
          className="min-w-[80px] flex-1 bg-transparent py-0.5 text-sm text-fg outline-none placeholder:text-fg-muted"
        />
      </div>

      {rows.length > 0 && (
        <SearchMenuList active={cursor.active} className="max-h-64">
          {rows.map((row, i) => (
            <button
              key={`${row.kind}:${row.value}`}
              type="button"
              data-menu-row={i}
              onMouseEnter={() => cursor.setActive(i)}
              onClick={() => choose(row)}
              className={clsx(SEARCH_MENU_ROW, 'py-1.5', searchMenuRowState(i === cursor.active))}
            >
              {row.kind === 'create' ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="text-fg-muted">+</span>
                  <span className="text-fg-secondary">Create</span>
                  <Chip size="sm" color={resolveTagBase(row.value, colors)}>
                    <span className="truncate">{row.value}</span>
                  </Chip>
                </span>
              ) : (
                <>
                  <Chip size="sm" color={tagPalette(row.value, colors).base}>
                    <span className="truncate">{row.value}</span>
                  </Chip>
                  <CheckIcon
                    className={clsx('ml-auto h-3.5 w-3.5 shrink-0 text-accent', !onRow.has(tagKey(row.value)) && 'invisible')}
                  />
                </>
              )}
            </button>
          ))}
        </SearchMenuList>
      )}

      {showCreate && (
        <div className="flex flex-wrap gap-1.5 border-t border-line-subtle px-4 py-2.5">
          {TAG_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Create “${trimmed}” in this colour`}
              onClick={() => create(trimmed, color)}
              className="h-5 w-5 rounded-full border border-line-subtle transition hover:scale-110"
              style={{ background: color }}
            />
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
