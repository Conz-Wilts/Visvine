'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRoutePathname } from '@/features/shared/hooks/useRoutePathname';
import { useSpaceRouter } from '@/features/shared/hooks/useSpaceRouter';
import { useCreateModal } from '@/features/shared/contexts/CreateModalContext';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { DOCK_EASE, DOCK_MS, useSidebar } from '@/features/shared/contexts/SidebarContext';
import { ROW_H } from '@/features/shared/components/layout/railRow';
import { useEscapeKey } from '@/features/shared/hooks/useEscapeKey';
import { createRows, firstPickIndex, flowFor, type CreateKind, type CreateRow } from '@/lib/create/rows';
import { aliasesForType, type SpaceAlias, type SpaceFeatureConfig } from '@/lib/types';
import TypeList from './TypeList';

/** The kinds whose aliases the list opens, and whose form takes one. */
const ALIAS_KINDS: readonly CreateKind[] = ['person', 'space', 'resource'];

/** Where an admin mints an alias: the console's Types section owns them. */
const ALIAS_ADMIN_HREF = '/admin?section=types';

/**
 * Create new — a panel of the rail rather than a page: a layer in the rail's
 * panel column, sliding out from under the icon rail the way the space
 * switcher does. Search first, then every kind you can make here
 * (lib/create/rows.ts).
 *
 * It is a PICKER and nothing else. Picking a kind navigates — to the kind's
 * own surface where it has one, and otherwise to the draft at /directory/new,
 * where the thing's own context note is what you fill in. Nothing is typed
 * into the rail: a rail-width column is the wrong shape for writing anything,
 * and the note the thing becomes is the real create surface.
 *
 * Always mounted so the column can slide it; parked off to the left while
 * shut. Navigating anywhere closes it, so the page's own panel gets the
 * column back.
 */
export default function CreatePanel() {
  const router = useSpaceRouter();
  const pathname = useRoutePathname();
  const { isOpen, defaultFolder, close } = useCreateModal();
  const { currentSpace, isAdmin } = useSpace();
  const { reduced } = useSidebar();

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const rowsInput = useMemo(
    () => ({
      featureConfig: (currentSpace?.featureConfig as SpaceFeatureConfig | undefined) ?? null,
      isAdmin,
      spaceNodeTypes: currentSpace?.nodeTypes,
      pathname,
    }),
    [currentSpace, isAdmin, pathname],
  );
  const list = useMemo(() => createRows({ ...rowsInput, query }), [rowsInput, query]);

  // Closing clears the search after the slide, so the list does not visibly
  // reset on its way behind the rail. Nothing takes focus on the way in — the
  // panel opens as rows to choose from, and a caret blinking in the search
  // reads as a demand to type.
  useEffect(() => {
    if (isOpen) return;
    const t = setTimeout(() => setQuery(''), reduced ? 0 : DOCK_MS);
    return () => clearTimeout(t);
  }, [isOpen, reduced]);

  useEffect(() => { setActive(firstPickIndex(list)); }, [list]);

  // Navigating away puts the real sidebar panel back.
  useEffect(() => { close(); }, [pathname, close]);

  useEscapeKey(close, isOpen);

  // The kinds whose form takes an alias — the entity kinds — and the space's
  // aliases for each, so the list can open them as a tree.
  const aliasesOf = useCallback(
    (row: CreateRow): SpaceAlias[] => {
      if (row.kind !== 'type' || !ALIAS_KINDS.includes(row.id)) return [];
      return aliasesForType((currentSpace?.aliases as SpaceAlias[] | undefined) ?? [], row.label);
    },
    [currentSpace],
  );

  // Minting one is the admin's — a Person alias IS the space's permission
  // vocabulary — so a member sees the aliases and not the row that leads to
  // the console section where one is made.
  const canAddAlias = useCallback(
    (row: CreateRow): boolean => isAdmin && row.kind === 'type' && ALIAS_KINDS.includes(row.id),
    [isAdmin],
  );

  const pick = useCallback(
    (row: CreateRow, alias?: SpaceAlias) => {
      close();
      router.push(flowFor(row, { folder: defaultFolder, alias: alias?.name }).href);
    },
    [defaultFolder, close, router],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, list.rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const row = list.rows[active]; if (row) pick(row); }
  };

  return (
    <aside
      role="dialog"
      aria-label="Create new"
      aria-hidden={!isOpen}
      className={`absolute inset-0 z-10 flex flex-col overflow-hidden border-r border-border-subtle bg-surface-1 ${isOpen ? '' : 'pointer-events-none'}`}
      // Inline, not `-translate-x-full`: Tailwind v4 compiles translate
      // utilities to the `translate` property, which a `transition: transform`
      // never animates.
      style={{
        transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: reduced ? 'none' : `transform ${DOCK_MS}ms ${DOCK_EASE}`,
      }}
    >
      {/* The search. One rail row tall and level with the rail's head, because
          this is the rail continuing — the rows below line up with the rail's. */}
      <div className="flex flex-shrink-0 items-center px-3" style={{ height: ROW_H }}>
        <div className="flex h-10 w-full items-center gap-2 rounded-lg border border-border-default bg-surface-1 px-3 transition-colors focus-within:border-brand-green">
          <svg className="h-4 w-4 shrink-0 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search or name a type…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            tabIndex={isOpen ? 0 : -1}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none"
          />
        </div>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-3">
        <TypeList
          list={list}
          active={active}
          aliasesOf={aliasesOf}
          canAddAlias={canAddAlias}
          onHover={setActive}
          onPick={pick}
          onNewAlias={() => { close(); router.push(ALIAS_ADMIN_HREF); }}
        />
      </div>
    </aside>
  );
}
