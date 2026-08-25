'use client';

/**
 * `/tools` — the one Tools destination: Browse, Installed, Mine, and (for an
 * admin) Approvals.
 *
 * Four questions about the same thing, which is why they are tabs and not four
 * pages: what exists, what this space runs, what I have written, and what is
 * waiting on me. The active
 * one lives in the URL (`?tab=installed`) so a link into the right screen works —
 * the degraded banner over a running Tool points straight at Installed, and
 * `/t/<slug>`'s not-found does too.
 *
 * The bar itself is the shared pane-top tab bar (the same sticky chrome, bleed
 * and underline handoff the Directory, notes and the admin console use), so
 * moving between those surfaces and this one reads as one bar relabelling
 * itself rather than a different page arriving.
 *
 * The shell owns every fetch that more than one tab needs: the installs list is
 * both the Installed tab's content and the Browse tab's answer to "does this
 * space already run it / who owns that type's page", so it is read once here and
 * passed down. Mine's roster is only Mine's, so it is read the first time that
 * tab is opened.
 *
 * Must be rendered inside a `<Suspense>` boundary (`useSearchParams`).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { UnderlineTabs, type UnderlineTab } from '@/components/ui';
import PaneTopScrollbarMask from '@/features/shared/components/pane/PaneTopScrollbarMask';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { fetchApprovalQueue, fetchAuthoredTools, fetchInstalls } from '@/features/tools/lib/client';
import type { AuthoredToolSummary, BrowseItem, InstallSummary } from '@/lib/tools/api';
import type { NodeTypeConfig } from '@/lib/types/context';
import BrowseTab from './BrowseTab';
import InstalledTab from './InstalledTab';
import ApprovalsTab from './ApprovalsTab';
import MineTab from './MineTab';
import ToolDetail from './ToolDetail';
import { ToastHost, useToasts, type ToastTone } from './Toasts';

/** Handoff key shared with the other pane-top bars — see tabIndicatorHandoff. */
const HANDOFF_KEY = 'pane-top';

type TabId = 'browse' | 'installed' | 'mine' | 'approvals';

const BASE_TABS: UnderlineTab<TabId>[] = [
  { id: 'browse', label: 'Browse' },
  { id: 'installed', label: 'Installed' },
  { id: 'mine', label: 'Mine' },
];

const BLURB: Record<TabId, string> = {
  browse: 'Tools their spaces chose to list publicly. Installing pins a version — code never changes under you.',
  installed: 'What this space runs, where each one appears, and the upgrades waiting for an admin.',
  mine: 'The tools written in this space. Publishing ships one to THIS space; listing it publicly is a separate step.',
  approvals: 'Versions your members published, waiting on you. Nothing installs here until you approve it.',
};

export default function Marketplace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { currentSpace, isAdmin: spaceAdmin, refreshSpace } = useSpace();
  const spaceId = currentSpace?.id ?? null;
  const nodeTypes = (currentSpace?.nodeTypes ?? []) as NodeTypeConfig[];

  const { toasts, push, dismiss } = useToasts();
  const toast = useCallback((tone: ToastTone, message: string) => push(tone, message), [push]);
  const onError = useCallback((message: string) => push('error', message), [push]);

  const [installs, setInstalls] = useState<InstallSummary[] | null>(null);
  // The server's answer, which is the one that matters: the space DTO's flag is
  // the same fact, but the routes refuse on theirs.
  const [installAdmin, setInstallAdmin] = useState<boolean | null>(null);
  const [authored, setAuthored] = useState<AuthoredToolSummary[] | null>(null);
  const [opened, setOpened] = useState<BrowseItem | null>(null);
  /** Bumped after an install so Browse re-reads its "Installed" badges. */
  const [browseKey, setBrowseKey] = useState(0);

  const isAdmin = installAdmin ?? spaceAdmin;

  /** How many of this space's own versions are waiting on an admin. */
  const [waiting, setWaiting] = useState(0);

  const tabs: UnderlineTab<TabId>[] = isAdmin
    ? [...BASE_TABS, { id: 'approvals', label: waiting > 0 ? `Approvals (${waiting})` : 'Approvals' }]
    : BASE_TABS;

  const requested = searchParams.get('tab');
  const tab: TabId = tabs.some((entry) => entry.id === requested) ? (requested as TabId) : 'browse';
  const select = useCallback(
    (id: TabId) => router.replace(`${pathname}?tab=${id}`, { scroll: false }),
    [router, pathname],
  );

  /**
   * Only the newest load of each list is allowed to land.
   *
   * The shell mounts before `useSpace()` has settled on the stored current
   * space, so a visit reliably issues two reads — one for whichever space came
   * first, one for the real one — and they do NOT come back in order. Without
   * this, the marketplace intermittently showed another space's tools. A
   * monotonic token rather than an AbortController because these loaders are
   * also called by hand after an install or a publish, and "the last call wins"
   * is the rule in both cases.
   */
  const installsRun = useRef(0);
  const authoredRun = useRef(0);

  const loadInstalls = useCallback(async () => {
    const run = ++installsRun.current;
    if (!spaceId) {
      setInstalls([]);
      return;
    }
    try {
      const body = await fetchInstalls(spaceId);
      if (run !== installsRun.current) return;
      setInstalls(body.installs);
      setInstallAdmin(body.isAdmin);
    } catch (err) {
      if (run !== installsRun.current) return;
      setInstalls([]);
      onError(err instanceof Error ? err.message : 'Could not read this space’s tools.');
    }
  }, [spaceId, onError]);

  const loadAuthored = useCallback(async () => {
    const run = ++authoredRun.current;
    if (!spaceId) {
      setAuthored([]);
      return;
    }
    try {
      const body = await fetchAuthoredTools(spaceId);
      if (run !== authoredRun.current) return;
      setAuthored(body.tools);
    } catch (err) {
      if (run !== authoredRun.current) return;
      setAuthored([]);
      onError(err instanceof Error ? err.message : 'Could not read the tools you have written.');
    }
  }, [spaceId, onError]);

  /**
   * The Approvals badge. Read for admins only and separately from the tab's own
   * content, because the count is what tells an admin the tab is worth opening
   * — a queue nobody knows about is not a queue.
   */
  const loadWaiting = useCallback(async () => {
    if (!spaceId || !isAdmin) {
      setWaiting(0);
      return;
    }
    try {
      const body = await fetchApprovalQueue(spaceId);
      setWaiting(body.queue.length);
    } catch {
      // A count is decoration; a toast for one would be noise over a screen the
      // admin did not ask for.
      setWaiting(0);
    }
  }, [spaceId, isAdmin]);

  useEffect(() => {
    setInstalls(null);
    setInstallAdmin(null);
    setAuthored(null);
    void loadInstalls();
  }, [loadInstalls]);

  useEffect(() => {
    void loadWaiting();
  }, [loadWaiting]);

  // Mine's roster walks the space's visible vault, so it is read when somebody
  // actually opens the tab rather than on every visit to Browse.
  useEffect(() => {
    if (tab === 'mine' && authored === null) void loadAuthored();
  }, [tab, authored, loadAuthored]);

  return (
    <div className="w-full">
      {/* Same chrome as the other pane-top bars: -ml-6 bleeds into <main>'s
          gutter so the seam continues the navbar's, and "-top-4 -mt-4" cancels
          <main>'s pt-4 so the bar pins flush under it. */}
      <div className="sticky -top-4 -mt-4 -ml-6 z-20">
        <PaneTopScrollbarMask />
        <div className="flex w-full items-center bg-glass px-1">
          <UnderlineTabs
            tabs={tabs}
            value={tab}
            onChange={select}
            ariaLabel="Tools"
            idPrefix="tools"
            handoffKey={HANDOFF_KEY}
            className="flex-1 overflow-x-auto"
          />
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1600px] px-6 pb-10 pt-6 sm:px-8">
        <header className="mb-6">
          <h1 className="text-lg font-bold text-text-primary">Tools</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">{BLURB[tab]}</p>
        </header>

        <div id={`tools-panel-${tab}`} role="tabpanel" aria-labelledby={`tools-tab-${tab}`} className="min-w-0">
          {tab === 'browse' && (
            <BrowseTab
              spaceId={spaceId}
              reloadKey={browseKey}
              onOpen={setOpened}
              onError={onError}
            />
          )}

          {tab === 'installed' && (
            <InstalledTab
              spaceId={spaceId}
              installs={installs ?? []}
              isAdmin={isAdmin}
              loading={installs === null}
              onChanged={() => {
                void loadInstalls();
                // The rail rows and the `/t/<slug>` routes come off the space
                // record, so an enable, an upgrade or an uninstall has to reach
                // the shell as well as this list.
                void refreshSpace();
                setBrowseKey((key) => key + 1);
              }}
              onToast={toast}
              onBrowse={() => select('browse')}
            />
          )}

          {tab === 'mine' && (
            <MineTab
              spaceId={spaceId}
              tools={authored ?? []}
              isAdmin={isAdmin}
              loading={authored === null}
              onChanged={() => {
                void loadAuthored();
                // A member's publish lands in the admin queue, so the badge is
                // stale the moment this list changes.
                void loadWaiting();
              }}
              onToast={toast}
            />
          )}

          {tab === 'approvals' && isAdmin && (
            <ApprovalsTab
              spaceId={spaceId}
              onReviewed={() => {
                void loadWaiting();
                void loadAuthored();
                // An approval offers this space's installs the upgrade.
                void loadInstalls();
              }}
              onToast={toast}
            />
          )}
        </div>
      </div>

      {opened && (
        <ToolDetail
          item={opened}
          spaceId={spaceId}
          isAdmin={isAdmin}
          installs={installs ?? []}
          nodeTypes={nodeTypes}
          onClose={() => setOpened(null)}
          onInstalled={(outcome) => {
            setOpened(null);
            void loadInstalls();
            void refreshSpace();
            setBrowseKey((key) => key + 1);
            toast('success', `${outcome.install.title} installed at /t/${outcome.install.slug}.`);
            for (const type of outcome.downgraded) {
              toast('warning', `${type} keeps its built-in page — the tool got a tab there instead.`);
            }
            for (const conflict of outcome.conflicts) {
              toast('warning', `The ${conflict.type} page is already owned by ${conflict.heldBy}, so that claim was left unmade.`);
            }
            if (outcome.install.degraded) {
              toast('warning', `${outcome.install.title} is running degraded — see Installed for what is missing.`);
            }
            select('installed');
          }}
          onError={onError}
        />
      )}

      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
