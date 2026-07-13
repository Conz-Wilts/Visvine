'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { clsx } from 'clsx';
import SaveStatus from '@/components/ui/SaveStatus';
import { useContextPanel } from '@/lib/contexts/ContextPanelContext';
import { ConsoleSaveProvider, useConsoleSave } from './ConsoleSaveContext';

/**
 * Settings shell for the Community Console: header with the shared save
 * indicator and the active section's content pane. Section state lives in the
 * URL (`?section=members`) so it deep-links and survives refresh.
 *
 * On wide viewports the grouped section list docks INTO the global Sidebar —
 * the same portal host the /context notes tree and /channels list use — so the
 * icon rail + section list read as one connected card. Below the dock width it
 * falls back to a horizontal pill row above the content.
 *
 * Must be rendered inside a `<Suspense>` boundary (uses `useSearchParams`).
 */

// ≥1024px: dock the section list into the Sidebar (must match DOCK_MIN_WIDTH
// in Sidebar.tsx). The Sidebar's panel column is ADMIN_PANEL_W = 260 there.
const DOCK_MIN_WIDTH = 1024;

export interface ConsoleSection {
  id: string;
  label: string;
  /** Nav group heading, e.g. "Settings", "People". Groups render in first-seen order. */
  group: string;
  /** Count badge shown next to the label (hidden when 0/undefined). */
  badge?: number;
  /** 'form' constrains the pane to a comfortable form width; 'wide' uses the full pane. */
  width: 'form' | 'wide';
}

interface ConsoleShellProps {
  title: string;
  subtitle?: React.ReactNode;
  sections: ConsoleSection[];
  renderSection: (id: string) => React.ReactNode;
}

function CountBadge({ count, selected }: { count?: number; selected?: boolean }) {
  if (!count) return null;
  return (
    <span
      className={clsx(
        'ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none',
        selected ? 'bg-white/25 text-white' : 'bg-amber-400/20 text-amber-700',
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function HeaderSaveStatus() {
  const { status, retry } = useConsoleSave();
  return <SaveStatus status={status} onRetry={retry} />;
}

export default function ConsoleShell({ title, subtitle, sections, renderSection }: ConsoleShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { host } = useContextPanel();

  // Track the Sidebar's dock breakpoint so both sides flip together.
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DOCK_MIN_WIDTH}px)`);
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const dockNav = wide && Boolean(host);

  const requested = searchParams.get('section');
  const active = sections.some((s) => s.id === requested) ? (requested as string) : sections[0].id;
  const activeSection = sections.find((s) => s.id === active)!;

  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, ConsoleSection[]>();
    for (const s of sections) {
      if (!byGroup.has(s.group)) {
        byGroup.set(s.group, []);
        order.push(s.group);
      }
      byGroup.get(s.group)!.push(s);
    }
    return order.map((g) => ({ name: g, items: byGroup.get(g)! }));
  }, [sections]);

  const select = (id: string) => {
    router.replace(`${pathname}?section=${id}`, { scroll: false });
  };

  // The grouped section list, rendered into the Sidebar's docked panel — styled
  // like the /context notes tree and /channels list that share this host.
  const dockedNav = dockNav && host
    ? createPortal(
        <div
          data-tour="console-tabs"
          className="flex h-full min-h-0 flex-col overflow-y-auto bg-surface-1 px-3 py-4"
          style={{ animation: 'fadeIn 0.3s ease-out' }}
        >
          <nav aria-label="Console sections">
            {groups.map((group) => (
              <div key={group.name} className="mb-5 last:mb-0">
                <div className="mb-1.5 px-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  {group.name}
                </div>
                <ul className="space-y-1">
                  {group.items.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => select(s.id)}
                        aria-current={s.id === active ? 'page' : undefined}
                        className={clsx(
                          'flex w-full items-center gap-2 rounded-full px-4 py-2.5 text-left text-sm font-medium transition-colors',
                          s.id === active
                            ? 'bg-brand-green text-white shadow-md'
                            : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary',
                        )}
                      >
                        {s.label}
                        <CountBadge count={s.badge} selected={s.id === active} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>,
        host,
      )
    : null;

  return (
    <ConsoleSaveProvider>
      {dockedNav}
      {/* When the section list is docked into the Sidebar, pad left so the content
          clears the docked card (260px panel + 12px gutter — keep in sync with
          ADMIN_PANEL_W in Sidebar.tsx). */}
      <div
        className={clsx('w-full', dockNav && 'pl-[272px]')}
        style={{ transition: 'padding-left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)' }}
      >
      <div className="w-full max-w-[1600px] mx-auto px-6 py-8">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-ginto text-4xl font-normal text-text-primary">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-text-muted">{subtitle}</p>}
          </div>
          <div className="pb-1">
            <HeaderSaveStatus />
          </div>
        </header>

        {/* Narrow fallback: horizontally scrollable pill row above the content */}
        {!dockNav && (
          <nav
            data-tour="console-tabs"
            className="-mx-6 mb-6 flex gap-2 overflow-x-auto px-6 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Console sections"
          >
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => select(s.id)}
                className={clsx(
                  'flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors',
                  s.id === active
                    ? 'bg-brand-green text-white shadow-md'
                    : 'bg-surface-2 text-text-secondary hover:text-text-primary',
                )}
              >
                {s.label}
                <CountBadge count={s.badge} selected={s.id === active} />
              </button>
            ))}
          </nav>
        )}

        <main className="min-w-0">
          {/* 'form' sections get a comfortable multi-column width — the panels
              themselves arrange their cards in a 2-col grid at xl. */}
          <div className={clsx(activeSection.width === 'form' && 'max-w-7xl')}>
            {renderSection(active)}
          </div>
        </main>
      </div>
      </div>
    </ConsoleSaveProvider>
  );
}
