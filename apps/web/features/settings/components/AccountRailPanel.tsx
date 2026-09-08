'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { XIcon } from '@/features/shared/icons';
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
 * Unlike the switcher, this panel is HELD: a form is filled in here and a
 * sign-in leaves for a provider from here, so it stays until its close, Escape
 * or navigating away — never the pointer wandering off the card. The one
 * thing that leaves the app is the sign-in, and a panel cannot survive a
 * round trip to a provider — so the return path is THIS page plus
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

const TABS: Array<{ id: ConnectorsTab; label: string; view: PanelView; blurb: string }> = [
  { id: 'connected', label: 'Connected', view: 'connected', blurb: 'What works for you here, now.' },
  { id: 'disconnected', label: 'Not connected', view: 'disconnected', blurb: 'What this space has that is not working for you yet. Sign in where a connector needs your own account.' },
  { id: 'all', label: 'All connectors', view: 'catalog', blurb: 'Every service Visvine can connect. Ask for one this space does not have yet.' },
];

/** The width the panel needs: a catalogue row is a logo, a name, a line under
 *  it and a button, which the switcher's column would crowd. */
export const ACCOUNT_PANEL_W = 360;

export default function AccountRailPanel({ initialTab }: {
  /** The connectors list to open on — set by the `?connectors=` return. */
  initialTab: ConnectorsTab | null;
}) {
  const { accountPanel, setAccountPanel, reduced } = useSidebar();
  const { currentSpace, isAdmin } = useSpace();
  const router = useRouter();
  const pathname = usePathname();
  const isOpen = accountPanel !== null;
  const [tab, setTab] = useState<ConnectorsTab>('connected');

  // The list the return landed on, once, when it does.
  useEffect(() => {
    if (initialTab && initialTab !== 'models') setTab(initialTab);
  }, [initialTab]);

  const close = () => {
    setAccountPanel(null);
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has(CONNECTORS_PARAM)) return;
    params.delete(CONNECTORS_PARAM);
    const q = params.toString();
    router.replace(q ? `${window.location.pathname}?${q}` : window.location.pathname, { scroll: false });
  };
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
          head, so the panel reads as the rail continuing. The name of what
          the row opened, and its close. */}
      <div className="flex shrink-0 items-center justify-between pl-5 pr-3" style={{ height: ROW_H }}>
        <h2 className="text-[13px] font-semibold text-text-primary">{modelsOnly ? 'Models' : 'Connectors'}</h2>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          tabIndex={isOpen ? 0 : -1}
          className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      {!modelsOnly && (
        <div className="flex shrink-0 flex-col gap-3 px-4 pb-3">
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
          <p className="text-xs text-text-muted">
            {tab === 'all' && isAdmin
              ? 'Every service Visvine can connect. Connect one for this space, or answer what members asked for.'
              : current.blurb}
          </p>
        </div>
      )}

      {/* The panel's rows bleed 12px either side to draw their hover fill,
          so the body owns the gutter. */}
      <div className="custom-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-4 pt-1">
        {!currentSpace ? (
          <p className="py-8 text-center text-sm text-text-muted">Open a space to see its {modelsOnly ? 'models' : 'connectors'}.</p>
        ) : modelsOnly ? (
          <ModelsPanel space={currentSpace.id} onLeave={close} />
        ) : (
          <ConnectorsPanel space={currentSpace.id} view={current.view} returnTo={returnTo} onLeave={close} />
        )}
      </div>
    </aside>
  );
}
