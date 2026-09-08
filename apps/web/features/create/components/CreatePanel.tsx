'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useCreateModal } from '@/features/shared/contexts/CreateModalContext';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { DOCK_EASE, DOCK_MS, useSidebar } from '@/features/shared/contexts/SidebarContext';
import { ROW_H } from '@/features/shared/components/layout/railRow';
import { useEscapeKey } from '@/features/shared/hooks/useEscapeKey';
import { createRows, firstPickIndex, flowFor, rowForKind, rowKey, rowLabel, type CreateKind, type CreateRow } from '@/lib/create/rows';
import { aliasesForType, type SpaceAlias, type SpaceFeatureConfig } from '@/lib/types';
import TypeList, { Mark } from './TypeList';
import type { InlineFormProps } from './forms/shared';
import AgentStartersForm from './forms/AgentStartersForm';
import ChannelForm from './forms/ChannelForm';
import { PersonForm, ResourceForm, SpaceRecordForm } from './forms/EntityForm';
import FileForm from './forms/FileForm';
import FolderForm from './forms/FolderForm';
import NewAliasForm from './forms/NewAliasForm';
import NewTypeForm from './forms/NewTypeForm';
import SectionForm from './forms/SectionForm';
import ToolForm from './forms/ToolForm';

/** The form for every kind `flowFor` makes in the panel itself. */
const FORMS: Partial<Record<CreateKind, ComponentType<InlineFormProps>>> = {
  person: PersonForm,
  space: SpaceRecordForm,
  resource: ResourceForm,
  channel: ChannelForm,
  agent: AgentStartersForm,
  section: SectionForm,
  tool: ToolForm,
  file: FileForm,
  folder: FolderForm,
};

type Step =
  | { kind: 'pick' }
  | { kind: 'form'; row: CreateRow; alias?: SpaceAlias }
  /** Naming an alias for `row`, on the way into that kind's own form. */
  | { kind: 'new-alias'; row: CreateRow };

/** The kinds whose form takes an alias, and so whose aliases the list opens. */
const ALIAS_KINDS: readonly CreateKind[] = ['person', 'space', 'resource'];

/**
 * Create new — a panel of the rail rather than a page: a layer in the rail's
 * panel column, sliding out from under the icon rail the way the space
 * switcher does. Search first, then every kind you can make here
 * (lib/create/rows.ts); picking one is a short form in the same column, the
 * kind's own surface, or the context-note draft. Always mounted so the column
 * can slide it; parked off to the left while shut. Navigating anywhere closes
 * it, so the page's own panel gets the column back.
 */
export default function CreatePanel() {
  const router = useRouter();
  const pathname = usePathname();
  const { isOpen, defaultType, defaultFolder, close, setFormOpen } = useCreateModal();
  const { currentSpace, isAdmin } = useSpace();
  const { reduced } = useSidebar();

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Opening with a kind lands on its form; opening bare lands on the list.
  useEffect(() => {
    if (!isOpen) return;
    const row = defaultType ? rowForKind(defaultType, rowsInput) : null;
    setStep(row ? { kind: 'form', row } : { kind: 'pick' });
    setQuery('');
    setActive(firstPickIndex(createRows({ ...rowsInput, query: '' })));
    // rowsInput is read once at open; a later config change must not reset the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, defaultType]);

  // The search takes focus once the panel has slid out; closing clears it
  // after the slide, so the list does not visibly reset on its way behind the rail.
  useEffect(() => {
    if (isOpen && step.kind === 'pick') {
      const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), reduced ? 0 : DOCK_MS);
      return () => clearTimeout(t);
    }
    if (!isOpen) {
      const t = setTimeout(() => { setQuery(''); setStep({ kind: 'pick' }); }, reduced ? 0 : DOCK_MS);
      return () => clearTimeout(t);
    }
  }, [isOpen, step.kind, reduced]);

  useEffect(() => { setActive(firstPickIndex(list)); }, [list]);

  // The card holds the panel open while a form is up (Sidebar) — leaving with
  // the pointer must not throw away what was typed.
  useEffect(() => { setFormOpen(isOpen && step.kind !== 'pick'); }, [isOpen, step.kind, setFormOpen]);

  // Navigating away puts the real sidebar panel back.
  useEffect(() => { close(); }, [pathname, close]);

  const back = useCallback(() => setStep({ kind: 'pick' }), []);
  useEscapeKey(step.kind === 'pick' ? close : back, isOpen);

  // The kinds whose form takes an alias — the entity forms — and the space's
  // aliases for each, so the list can open them as a tree.
  const aliasesOf = useCallback(
    (row: CreateRow): SpaceAlias[] => {
      if (row.kind !== 'type' || !ALIAS_KINDS.includes(row.id)) return [];
      return aliasesForType((currentSpace?.aliases as SpaceAlias[] | undefined) ?? [], row.label);
    },
    [currentSpace],
  );

  // Minting one is the admin's — a Person alias IS the space's permission
  // vocabulary — so a member sees the aliases and not the row that adds one.
  // The server is the real gate (/api/aliases); this just stops us offering a
  // form that 403s.
  const canAddAlias = useCallback(
    (row: CreateRow): boolean => isAdmin && row.kind === 'type' && ALIAS_KINDS.includes(row.id),
    [isAdmin],
  );

  const pick = useCallback(
    (row: CreateRow, alias?: SpaceAlias) => {
      const flow = flowFor(row, { pathname: pathname ?? '/', folder: defaultFolder });
      if (flow.kind === 'inline') {
        setStep({ kind: 'form', row, alias });
        return;
      }
      close();
      router.push(flow.href);
    },
    [pathname, defaultFolder, close, router],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, list.rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const row = list.rows[active]; if (row) pick(row); }
  };

  const onDone = useCallback((href: string) => { close(); router.push(href); }, [close, router]);

  // A new alias is not a destination: it lands in its kind's form, worn.
  const onAliasCreated = useCallback((row: CreateRow, alias: SpaceAlias) => {
    setStep({ kind: 'form', row, alias });
  }, []);

  const aliasRow = step.kind === 'new-alias' ? step.row : null;
  const formRow = step.kind === 'form' ? step.row : null;
  const formAlias = step.kind === 'form' ? step.alias : undefined;
  const TypedForm = formRow?.kind === 'type' ? FORMS[formRow.id] : undefined;
  const formProps = (row: CreateRow, space: { id: string; name: string }): InlineFormProps => ({
    spaceId: space.id,
    contextName: space.name,
    folder: defaultFolder,
    accent: row.kind === 'new-type' ? 'var(--theme-accent-color, #78d870)' : row.color,
    initialAlias: formAlias?.name ?? null,
    onDone,
  });

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
      {/* The head row: the search on the list, the kind's name on a form. One
          rail row tall and level with the rail's head, because this is the
          rail continuing — the rows below line up with the rail's. */}
      <div className="flex flex-shrink-0 items-center px-3" style={{ height: ROW_H }}>
        {formRow || aliasRow ? (
          <div className="flex w-full items-center gap-2">
            <button
              type="button"
              onClick={back}
              aria-label="Back"
              tabIndex={isOpen ? 0 : -1}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <Mark row={(formRow ?? aliasRow)!} />
            <span className="truncate text-sm font-semibold text-text-primary">
              {aliasRow
                ? `New ${rowLabel(aliasRow).toLowerCase()} alias`
                : formRow!.kind === 'new-type'
                  ? formRow!.name || 'New type'
                  : rowLabel(formRow!)}
            </span>
          </div>
        ) : (
          <div className="flex h-10 w-full items-center gap-2 rounded-lg border border-border-default bg-surface-1 px-3 transition-colors focus-within:border-brand-green">
            <svg className="h-4 w-4 shrink-0 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              placeholder="Search or name a type…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              tabIndex={isOpen ? 0 : -1}
              className="min-w-0 flex-1 bg-transparent text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none"
            />
          </div>
        )}
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-3">
        {aliasRow && currentSpace ? (
          <div className="px-3 pt-1">
            <NewAliasForm
              key={`alias:${rowKey(aliasRow)}`}
              spaceId={currentSpace.id}
              nodeType={rowLabel(aliasRow)}
              accent={aliasRow.kind === 'new-type' ? 'var(--theme-accent-color, #78d870)' : aliasRow.color}
              onCreated={(alias) => onAliasCreated(aliasRow, alias)}
            />
          </div>
        ) : formRow && currentSpace && (TypedForm || formRow.kind === 'new-type') ? (
          <div className="px-3 pt-1">
            {formRow.kind === 'new-type' ? (
              <NewTypeForm key={rowKey(formRow)} {...formProps(formRow, currentSpace)} name={formRow.name} />
            ) : TypedForm ? (
              <TypedForm key={`${rowKey(formRow)}:${formAlias?.name ?? ''}`} {...formProps(formRow, currentSpace)} />
            ) : null}
          </div>
        ) : (
          <TypeList
            list={list}
            active={active}
            aliasesOf={aliasesOf}
            canAddAlias={canAddAlias}
            onHover={setActive}
            onPick={pick}
            onNewAlias={(row) => setStep({ kind: 'new-alias', row })}
          />
        )}
      </div>
    </aside>
  );
}
