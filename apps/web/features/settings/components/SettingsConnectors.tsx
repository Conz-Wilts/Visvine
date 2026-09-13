'use client';

import { useEffect, useState } from 'react';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import ConnectorsPanel from '@/features/connectors/components/ConnectorsPanel';
import ModelsPanel from '@/features/models/components/ModelsPanel';

/**
 * Connectors and Models as sections of Settings (`?section=connectors`,
 * `?section=models`). Both are about the space you are in, from where you
 * stand in it.
 *
 * CONNECTORS is three lists. CONNECTED is the rows that work for you now. NOT
 * CONNECTED is the rest of what this space's admins connected: where a
 * connector holds an account per member, the row offers Sign in; where no
 * grant lets you open the note, it still names the connector and offers
 * Request access. ALL CONNECTORS is the catalogue — what the space holds says
 * so, and what it does not offers Request, which lands in the console for an
 * admin to add. An admin sees the same lists with the console's acts in them.
 *
 * MODELS is what this space's agents run on — a decision of its own rather
 * than a service among forty, and a model is not a connector (lib/models).
 *
 * The one thing that leaves the app is the sign-in, so its return path is this
 * section plus `?connectors=<tab>`, landing on the list showing the account
 * you just linked. A `?connectors=` on any other page is sent here (UserMenu).
 */
export const CONNECTORS_PARAM = 'connectors';

type ConnectorsTab = 'connected' | 'disconnected' | 'all';

/** Which tab a `?connectors=` value opens — older spellings land on Not connected. */
function connectorsSegment(value: string | null): ConnectorsTab | 'models' | null {
  if (value === null) return null;
  if (value === 'connected') return 'connected';
  if (value === 'all') return 'all';
  if (value === 'models') return 'models';
  return 'disconnected';
}

/** Where a `?connectors=` value belongs in Settings. */
export function settingsHrefFor(value: string | null): string | null {
  const segment = connectorsSegment(value);
  if (!segment) return null;
  if (segment === 'models') return '/settings?section=models';
  return `/settings?section=connectors&${CONNECTORS_PARAM}=${segment}`;
}

const TABS: Array<{ id: ConnectorsTab; label: string; view: 'connected' | 'disconnected' | 'catalog' }> = [
  { id: 'connected', label: 'Connected', view: 'connected' },
  { id: 'disconnected', label: 'Not connected', view: 'disconnected' },
  { id: 'all', label: 'All connectors', view: 'catalog' },
];

export function ConnectorsSection() {
  const { currentSpace } = useSpace();
  const [tab, setTab] = useState<ConnectorsTab>('connected');

  // The list a sign-in's return names, once, when it lands.
  useEffect(() => {
    const segment = connectorsSegment(new URLSearchParams(window.location.search).get(CONNECTORS_PARAM));
    if (segment && segment !== 'models') setTab(segment);
  }, []);

  if (!currentSpace) {
    return <p className="py-8 text-sm text-text-muted">Open a space to see its connectors.</p>;
  }
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex max-w-md gap-1 rounded-lg bg-surface-2 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-[13px] transition-colors ${
              tab === t.id
                ? 'bg-surface-1 font-medium text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <ConnectorsPanel
        key={currentSpace.id}
        space={currentSpace.id}
        view={current.view}
        returnTo={`/settings?section=connectors&${CONNECTORS_PARAM}=${tab}`}
        // Adding one is choosing from the catalogue, which is the third tab.
        onAdd={() => setTab('all')}
      />
    </div>
  );
}

export function ModelsSection() {
  const { currentSpace } = useSpace();
  if (!currentSpace) {
    return <p className="py-8 text-sm text-text-muted">Open a space to see its models.</p>;
  }
  return <ModelsPanel key={currentSpace.id} space={currentSpace.id} />;
}
