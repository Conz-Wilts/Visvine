'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { DOCK_EASE, DOCK_MS, useSidebar, type AccountPanel } from '@/features/shared/contexts/SidebarContext';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { ROW_H } from '@/features/shared/components/layout/railRow';
import { useEscapeKey } from '@/features/shared/hooks/useEscapeKey';
import ConnectorsPanel from '@/features/connectors/components/ConnectorsPanel';
import ModelsPanel from '@/features/models/components/ModelsPanel';

/**
 * Connectors and Models as a panel of the rail — the layer against the rail's
 * edge that the space switcher and Create new slide out into, opened from the
 * rows of the account band at the rail's foot. The rail reads as widening into
 * the list rather than a dialog landing over the page.
 *
 * CONNECTORS is the space you are in, from where you stand in it, in three
 * lists. CONNECTED is the rows that work for you now. NOT CONNECTED is the
 * rest of what this space's admins connected: where a connector holds an
 * account per member, the row offers Sign in; where no grant lets you open the
 * note, it still names the connector and offers Request access. ALL
 * CONNECTORS is the catalogue — what the space holds says so, and what it does
 * not offers Request, which lands in the console for an admin to add. An admin
 * sees the same three lists with the console's acts in them — it is the same
 * panel — so adding, disabling and signing in are one surface.
 *
 * MODELS is the same panel holding the models panel instead: what this
 * space's agents run on is a decision of its own rather than a service among
 * forty, and a model is not a connector (lib/models).
 *
 * It closes the way the switcher and Create new do — the pointer leaving the
 * card — so it carries no close button. A form is the exception: while an add
 * form, a manage view or a confirm is up the panel is HELD (the Sidebar reads
 * `accountFormOpen`), because a half-filled form must not be taken away by the
 * pointer wandering off. Escape and navigating away close it either way.
 *
 * The one thing that leaves the app is the sign-in, and a panel cannot survive
 * a round trip to a provider — so the return path is THIS page plus
 * `?connectors=<tab>`, which is what UserMenu re-opens the panel on, landing
 * on the list showing the account you just linked.
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

type PanelView = 'mine' | 'connected' | 'disconnected' | 'catalog';

const TABS: Array<{ id: ConnectorsTab; label: string; view: PanelView }> = [
  { id: 'connected', label: 'Connected', view: 'connected' },
  { id: 'disconnected', label: 'Not connected', view: 'disconnected' },
  { id: 'all', label: 'All connectors', view: 'catalog' },
];

/** The width the panel needs: a catalogue row is a logo, a name, a line under
 *  it and a button, which the switcher's column would crowd. */
export const ACCOUNT_PANEL_W = 380;

export default function AccountRailPanel({ initialTab }: {
  /** The connectors list to open on — set by the `?connectors=` return. */
  initialTab: ConnectorsTab | null;
}) {
  const { accountPanel, setAccountPanel, setAccountFormOpen, reduced } = useSidebar();
  const { currentSpace } = useSpace();
  const router = useRouter();
  const pathname = usePathname();
  const isOpen = accountPanel !== null;
  const [tab, setTab] = useState<ConnectorsTab>('connected');

  // The list the return landed on, once, when it does.
  useEffect(() => {
    if (initialTab && initialTab !== 'models') setTab(initialTab);
  }, [initialTab]);

  // The `?connectors=` the sign-in returned on is dropped whenever the panel
  // ends up closed — by Escape, by a row, or by the pointer leaving the card,
  // which shuts it from the Sidebar without coming through here.
  useEffect(() => {
    if (isOpen) return;
    setAccountFormOpen(false);
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has(CONNECTORS_PARAM)) return;
    params.delete(CONNECTORS_PARAM);
    const q = params.toString();
    router.replace(q ? `${window.location.pathname}?${q}` : window.location.pathname, { scroll: false });
  }, [isOpen, router, setAccountFormOpen]);

  const close = () => setAccountPanel(null);
  useEscapeKey(close, isOpen);

  // Navigating away shuts it — a CHANGE of route, not the mount, so the
  // sign-in return that opens it on arrival is not shut by the same render.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    setAccountPanel(null);
  }, [pathname, setAccountPanel]);

  // Shown while the slide runs either way: the panel keeps its last kind on
  // the way out rather than emptying mid-motion.
  const shown = useRef<AccountPanel>('connectors');
  if (accountPanel) shown.current = accountPanel;
  const kind = shown.current;
  const modelsOnly = kind === 'models';
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  const returnTo = `${pathname}?${CONNECTORS_PARAM}=${tab}`;

  return (
    <aside
      role="dialog"
      aria-label={modelsOnly ? 'Models' : 'Connectors'}
      aria-hidden={!isOpen}
      className={`absolute inset-0 z-10 flex flex-col overflow-hidden border-r border-border-subtle bg-surface-1 ${isOpen ? '' : 'pointer-events-none'}`}
      style={{
        transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: reduced ? 'none' : `transform ${DOCK_MS}ms ${DOCK_EASE}`,
      }}
    >
      {/* The head: one rail row tall, level with the space in the rail's
          head, so the panel reads as the rail continuing. It carries no title
          — the row you pressed named it — and no close, because leaving the
          card is the close. */}
      <div className="shrink-0" style={{ height: ROW_H }} />

      {!modelsOnly && (
        <div className="flex shrink-0 flex-col px-4 pb-3">
          <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-pressed={tab === t.id}
                tabIndex={isOpen ? 0 : -1}
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
        </div>
      )}

      {/* The panel's rows bleed 12px either side to draw their hover fill,
          so the body owns the gutter. */}
      <div className="custom-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-4 pt-1">
        {!currentSpace ? (
          <p className="py-8 text-center text-sm text-text-muted">Open a space to see its {modelsOnly ? 'models' : 'connectors'}.</p>
        ) : modelsOnly ? (
          <ModelsPanel space={currentSpace.id} onLeave={close} onFormOpen={setAccountFormOpen} />
        ) : (
          <ConnectorsPanel
            space={currentSpace.id}
            view={current.view}
            returnTo={returnTo}
            onLeave={close}
            onFormOpen={setAccountFormOpen}
            // Adding one is choosing from the catalogue, which is this
            // panel's own third tab.
            onAdd={() => setTab('all')}
          />
        )}
      </div>
    </aside>
  );
}
