'use client';

import { createPortal } from 'react-dom';
import { ClockIcon, Settings2Icon, Share2Icon } from '@/features/shared/icons';
import { useContextPanel } from '@/features/shared/contexts/ContextPanelContext';

export type AgentView = 'run' | 'config' | 'history';

/**
 * The agent page's three doors, at the right end of the pane's tab row: Config
 * and History swap what the page shows (pressing the open one goes back to the
 * run), Share opens the brief's share dialog. Styled as the row's own tabs.
 * With no tab row to sit in, the same three render inline where they are put.
 */
export default function AgentTrail({ view, onView, onShare }: { view: AgentView; onView: (next: AgentView) => void; onShare: () => void }) {
  const { tabTrailHost } = useContextPanel();
  const item = (active: boolean) =>
    `flex h-12 shrink-0 items-center gap-1.5 px-3 text-sm font-medium whitespace-nowrap outline-none transition-colors duration-150 ${
      active ? 'text-brand-black' : 'text-brand-grey hover:text-brand-black'
    }`;
  const buttons = (
    <>
      <button type="button" aria-pressed={view === 'config'} className={item(view === 'config')} onClick={() => onView(view === 'config' ? 'run' : 'config')}>
        <Settings2Icon className="h-4 w-4" />
        Config
      </button>
      <button type="button" aria-pressed={view === 'history'} className={item(view === 'history')} onClick={() => onView(view === 'history' ? 'run' : 'history')}>
        <ClockIcon className="h-4 w-4" />
        History
      </button>
      <button type="button" className={item(false)} onClick={onShare}>
        <Share2Icon className="h-4 w-4" />
        Share
      </button>
    </>
  );
  return tabTrailHost ? createPortal(buttons, tabTrailHost) : <div className="-mt-3 flex justify-end">{buttons}</div>;
}
