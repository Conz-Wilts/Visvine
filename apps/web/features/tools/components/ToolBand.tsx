'use client';

/**
 * The chrome the app draws around a Tool — its own sections (`surfaces.nav`)
 * and band buttons (`surfaces.actions`) — shared by the installed page
 * (`/t/<slug>`) and the preview (`/tools/preview/<name>`), so a working copy
 * is looked at exactly as it will run. The section lives in `?section=` and
 * changes through the native history API: a tab press never reloads the frame.
 */

import type { ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { clsx } from 'clsx';
import BandTabList from '@/features/shared/components/pane/BandTabList';
import type { ToolBandAction, ToolNav } from '@/lib/tools/config';

/** Handoff key shared with the other band bars, so the underline slides across. */
const HANDOFF_KEY = 'pane-top';

export interface ToolSections {
  sections: { id: string; label: string }[];
  style: 'tabs' | 'side';
  active: string | null;
  select: (id: string) => void;
  /** Sections stand on the band as tabs. */
  onBand: boolean;
  /** Sections stand as a list beside the frame. */
  onSide: boolean;
}

export function useToolSections(nav: ToolNav | null | undefined, isAdmin: boolean): ToolSections {
  const searchParams = useSearchParams();
  const sections = (nav?.sections ?? []).filter((s) => !s.admin || isAdmin);
  const style = nav?.style === 'side' ? 'side' : 'tabs';
  const drawn = sections.length > 1;
  const requested = searchParams.get('section');
  const active = sections.find((s) => s.id === requested)?.id ?? sections[0]?.id ?? null;
  const select = (id: string) => {
    if (!sections.some((s) => s.id === id)) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('section', id);
    window.history.replaceState(null, '', `?${params.toString()}`);
  };
  return { sections, style, active, select, onBand: drawn && style === 'tabs', onSide: drawn && style === 'side' };
}

export function ToolSectionTabs({ nav, title }: { nav: ToolSections; title: string }) {
  if (!nav.onBand) return null;
  return (
    <BandTabList
      tabs={nav.sections}
      activeId={nav.active}
      onSelect={nav.select}
      ariaLabel={`${title} sections`}
      handoffKey={HANDOFF_KEY}
      inBand
    />
  );
}

export function ToolActionButtons({ actions, onAction }: { actions: ToolBandAction[]; onAction: (id: string) => void }) {
  return (
    <>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          data-tool-action={action.id}
          onClick={() => onAction(action.id)}
          className="h-8 whitespace-nowrap rounded-lg px-3 text-sm font-medium text-fg transition-colors hover:bg-surface-subtle"
        >
          {action.label}
        </button>
      ))}
    </>
  );
}

/** The frame, with the side list beside it when the Tool asks for one. */
export function ToolSectionsLayout({ nav, title, children }: { nav: ToolSections; title: string; children: ReactNode }) {
  if (!nav.onSide) return <>{children}</>;
  return (
    <div className="flex h-full min-h-0">
      <nav aria-label={`${title} sections`} className="w-56 shrink-0 overflow-y-auto border-r border-line-subtle py-3">
        {nav.sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => nav.select(s.id)}
            aria-current={s.id === nav.active ? 'page' : undefined}
            className={clsx(
              'block w-full truncate px-4 py-1.5 text-left text-sm transition-colors hover:bg-surface-subtle',
              s.id === nav.active ? 'font-semibold text-fg' : 'text-fg-secondary',
            )}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
