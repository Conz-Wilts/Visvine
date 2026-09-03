'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import ConnectorsPanel from '@/features/connectors/components/ConnectorsPanel';

/**
 * Connectors, as a dialog off the account menu — the space you are in, from
 * where you stand in it, in three lists.
 *
 * CONNECTED is the rows that work for you now. NOT CONNECTED is the rest of
 * what this space's admins connected: where a connector holds an account per
 * member, the row offers Sign in; where no grant lets you open the note, it
 * still names the connector and offers Request access. ALL CONNECTORS is the
 * catalogue — what the space holds says so, and what it does not offers
 * Request, which lands in the console for an admin to add.
 *
 * MODELS is the same dialog with no tab bar, opened by its own row in the
 * account band: what this space's agents run on is a decision of its own
 * rather than a service among forty.
 *
 * An admin sees the same three lists with the console's acts in them — it is
 * the same panel — so adding, disabling and signing in are one surface.
 *
 * It is not a page: connecting one is a thing you do in a minute and then
 * forget, so the menu opens it over whatever you were doing and closing it
 * puts you back there. The one thing that leaves the app is the sign-in, and a
 * dialog cannot survive a round trip to a provider — so the return path is
 * THIS page plus `?connectors=<tab>`, which is what UserMenu re-opens the
 * dialog on, landing on the list showing the account you just linked.
 */
export const CONNECTORS_PARAM = 'connectors';

export type ConnectorsTab = 'connected' | 'disconnected' | 'all' | 'models';

/** Which tab a `?connectors=` value opens — older spellings land on Not connected. */
export function connectorsSegment(value: string | null): ConnectorsTab | null {
  if (value === null) return null;
  if (value === 'connected') return 'connected';
  if (value === 'all') return 'all';
  if (value === 'models') return 'models';
  return 'disconnected';
}

type PanelView = 'mine' | 'connected' | 'disconnected' | 'catalog' | 'models';

const TABS: Array<{ id: ConnectorsTab; label: string; view: PanelView; blurb: string }> = [
  { id: 'connected', label: 'Connected', view: 'connected', blurb: 'What works for you here, now.' },
  { id: 'disconnected', label: 'Not connected', view: 'disconnected', blurb: 'What this space has that is not working for you yet. Sign in where a connector needs your own account.' },
  { id: 'all', label: 'All connectors', view: 'catalog', blurb: 'Every service Visvine can connect. Ask for one this space does not have yet.' },
];

/** Models is not one of the tabs — it is the dialog opened on its own row. */
const MODELS = { view: 'models' as PanelView, blurb: '' };

export default function ConnectorsDialog({
  initial = 'connected',
  onClose,
}: {
  initial?: ConnectorsTab;
  onClose: () => void;
}) {
  const { currentSpace, isAdmin } = useSpace();
  const [tab, setTab] = useState<ConnectorsTab>(initial);

  // Read once, at open: the path is where the provider sends the browser back.
  const [pathname] = useState(() => (typeof window === 'undefined' ? '/directory' : window.location.pathname));
  const returnTo = `${pathname}?${CONNECTORS_PARAM}=${tab}`;
  const modelsOnly = initial === 'models';
  const current = modelsOnly ? MODELS : TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <Modal
      onClose={onClose}
      title={modelsOnly ? 'Models' : 'Connectors'}
      // One shape, whatever the tab holds — one connected server or thirty
      // available ones. The width is fixed rather than a share of the
      // viewport, and the height is pinned so switching tabs never resizes
      // the dialog; the list scrolls inside it.
      maxWidth="max-w-[40rem]"
      panelClassName="bg-surface-1 rounded-xl shadow-float flex flex-col h-[min(42rem,85vh)]"
    >
      {/* The panel's rows bleed 12px either side to draw their hover fill, so
          the body it sits in owns the gutter. */}
      <div className="flex flex-col gap-4 px-6 py-5">
        {!modelsOnly && <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={`min-w-0 flex-1 truncate rounded-md px-3 py-1.5 text-sm transition-colors ${
                tab === t.id
                  ? 'bg-surface-1 font-medium text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>}

        {/* Models says its own line, in the panel, beside its Add. */}
        {!modelsOnly && (
          <p className="text-xs text-text-muted">
            {tab === 'all' && isAdmin
              ? 'Every service Visvine can connect. Connect one for this space, or answer what members asked for.'
              : current.blurb}
          </p>
        )}

        {currentSpace ? (
          <ConnectorsPanel space={currentSpace.id} view={current.view} returnTo={returnTo} onLeave={onClose} />
        ) : (
          <p className="py-8 text-center text-sm text-text-muted">Open a space to see its connectors.</p>
        )}
      </div>
    </Modal>
  );
}
