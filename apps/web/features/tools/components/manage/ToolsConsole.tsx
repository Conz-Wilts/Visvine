'use client';

/**
 * The Space Console's Tools surfaces.
 *
 * A Tool is written by a coding agent over MCP (`create_tool` → `write_tool`)
 * and previewed at `/tools/preview/<name>`; everything an admin then decides
 * about it — whether the space runs it, which version, where it sits, and
 * whether a member's publish is accepted — is console work, so it is here
 * rather than on a destination of its own.
 *
 * Each panel owns its own fetch. They are siblings in the console, not tabs of
 * one screen sharing a shell, and a panel the admin has not opened should cost
 * nothing. The reads go through the shared request cache, so a return to the
 * console paints what it last saw and revalidates behind it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, ToastHost, useToasts, type ToastTone } from '@visvine/ui';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { fetchApprovalQueue, fetchInstalls, fetchSpaceListings, moveListing } from '@/features/tools/lib/client';
import type { ApprovalQueueItem, InstallSummary, SpaceListingsResponse } from '@/lib/tools/api';
import { invalidateRequestCache, swrFetch } from '@/features/shared/lib/requestCache';
import ApprovalsTab from './ApprovalsTab';
import InstalledTab from './InstalledTab';

const toolKeys = {
  installs: (spaceId: string) => `tools:installs:${spaceId}`,
  approvals: (spaceId: string) => `tools:approvals:${spaceId}`,
};

/**
 * Toasts, scoped to one panel.
 *
 * The console's panels answer with things that have to be read — a refusal in
 * the server's own words, a type claim that became a tab — after the dialog
 * that asked has closed, which is what a toast is for here.
 */
function usePanelToasts() {
  const { toasts, push, dismiss } = useToasts();
  const toast = useCallback((tone: ToastTone, message: string) => push(tone, message), [push]);
  return { toasts, toast, dismiss };
}

/**
 * "Installed" — what this space runs and the decisions left about each one: on
 * or off, a waiting upgrade, which types it owns, and whether to keep it.
 *
 * Sits under the rail-placement rows in the Tools section: same tools, one
 * screen, placement first because that is the row an admin comes here to drag.
 */
export function InstalledToolsPanel() {
  const { currentSpace, refreshSpace } = useSpace();
  const spaceId = currentSpace?.id ?? null;
  const { toasts, toast, dismiss } = usePanelToasts();

  const [installs, setInstalls] = useState<InstallSummary[] | null>(null);
  const [installAdmin, setInstallAdmin] = useState<boolean | null>(null);

  /**
   * Only the newest load is allowed to land: the console mounts before
   * `useSpace()` has settled on the stored space, so a visit reliably issues
   * two reads and they do not come back in order.
   */
  const run = useRef(0);

  const load = useCallback(async (fresh = false) => {
    const token = ++run.current;
    if (!spaceId) {
      setInstalls([]);
      return;
    }
    try {
      if (fresh) invalidateRequestCache(toolKeys.installs(spaceId));
      const body = await swrFetch(toolKeys.installs(spaceId), () => fetchInstalls(spaceId), (cached) => {
        if (token !== run.current) return;
        setInstalls(cached.installs);
        setInstallAdmin(cached.isAdmin);
      });
      if (token !== run.current) return;
      setInstalls(body.installs);
      setInstallAdmin(body.isAdmin);
    } catch (err) {
      if (token !== run.current) return;
      setInstalls([]);
      toast('error', err instanceof Error ? err.message : 'Could not read this space’s tools.');
    }
  }, [spaceId, toast]);

  useEffect(() => {
    setInstalls(null);
    setInstallAdmin(null);
    void load();
  }, [load]);

  // Nothing installed is nothing to show — no heading, no empty state.
  if (installs !== null && installs.length === 0) return <ToastHost toasts={toasts} onDismiss={dismiss} />;

  return (
    <section>
      <InstalledTab
        spaceId={spaceId}
        installs={installs ?? []}
        // The server's answer is the one that matters — the routes refuse on
        // theirs, not on the space DTO's flag.
        isAdmin={installAdmin ?? true}
        loading={installs === null}
        onChanged={() => {
          void load(true);
          // Rail rows and the `/t/<slug>` routes come off the space record, so
          // an enable, an upgrade or an uninstall has to reach the shell too.
          void refreshSpace();
        }}
        onToast={toast}
      />
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </section>
  );
}

/**
 * This space's approval queue, read once for the badge and the section alike:
 * the count is what tells an admin the section is worth opening, and the panel
 * lists the same rows, so one read serves both.
 */
export function useToolApprovalQueue(): {
  queue: ApprovalQueueItem[] | null;
  count: number;
  refresh: () => void;
} {
  const { currentSpace } = useSpace();
  const spaceId = currentSpace?.id ?? null;
  const [queue, setQueue] = useState<ApprovalQueueItem[] | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    if (!spaceId) {
      setQueue([]);
      return;
    }
    if (nonce > 0) invalidateRequestCache(toolKeys.approvals(spaceId));
    swrFetch(toolKeys.approvals(spaceId), () => fetchApprovalQueue(spaceId), (body) => {
      if (live) setQueue(body.queue);
    })
      // A count is decoration; a toast for one would be noise over a screen
      // the admin did not ask for. The panel says so in its own words.
      .catch(() => {
        if (live) setQueue([]);
      });
    return () => {
      live = false;
    };
  }, [spaceId, nonce]);

  return {
    queue,
    count: queue?.length ?? 0,
    refresh: useCallback(() => setNonce((n) => n + 1), []),
  };
}

/**
 * "Approvals" — the versions this space's members published that nobody with
 * the authority to say yes has looked at yet.
 */
export function ToolApprovalsPanel({
  queue,
  onReviewed,
}: {
  queue: ApprovalQueueItem[] | null;
  onReviewed: () => void;
}) {
  const { currentSpace, refreshSpace } = useSpace();
  const spaceId = currentSpace?.id ?? null;
  const { toasts, toast, dismiss } = usePanelToasts();

  return (
    <>
      <ApprovalsTab
        spaceId={spaceId}
        queue={queue}
        onReviewed={() => {
          onReviewed();
          // An install from the sheet adds a rail row, which rides the space record.
          void refreshSpace();
        }}
        onToast={toast}
      />
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </>
  );
}

/**
 * Listings another space offered to this one. Accepting names the Tool here
 * that carries the listing on — import the listed version first — and from
 * then on this space publishes it; every install keeps its upgrades.
 * Nothing offered is nothing drawn.
 */
export function ListingOffersPanel() {
  const { currentSpace } = useSpace();
  const spaceId = currentSpace?.id ?? null;
  const { toasts, toast, dismiss } = usePanelToasts();
  const [offers, setOffers] = useState<SpaceListingsResponse['offers']>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!spaceId) return;
    const ctl = new AbortController();
    fetchSpaceListings(spaceId, ctl.signal)
      .then((res) => setOffers(res.offers))
      .catch(() => setOffers([]));
    return () => ctl.abort();
  }, [spaceId, nonce]);

  if (!spaceId || offers.length === 0) return <ToastHost toasts={toasts} onDismiss={dismiss} />;

  const answer = async (listingId: string, accept: boolean, fallback: string) => {
    setBusy(listingId);
    try {
      await moveListing(spaceId, accept ? { action: 'accept', listingId, name: names[listingId]?.trim() || fallback } : { action: 'decline', listingId });
      toast('success', accept ? 'This space publishes it now' : 'Declined');
      setNonce((n) => n + 1);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not answer');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="border-t border-line-subtle py-5">
      <h2 className="pb-3 text-sm font-semibold text-fg">Offered</h2>
      <ul className="flex flex-col divide-y divide-line-subtle">
        {offers.map((offer) => {
          const fallback = offer.key.slice(offer.key.indexOf('/') + 1);
          return (
            <li key={offer.listingId} className="flex flex-wrap items-center gap-3 py-3">
              <span className="min-w-0 flex-1 truncate text-sm text-fg">
                {offer.title}
                <span className="text-fg-muted"> · from {offer.from.name ?? offer.from.id}</span>
              </span>
              <Input
                className="w-40"
                aria-label="Tool here"
                placeholder={fallback}
                value={names[offer.listingId] ?? ''}
                onChange={(e) => setNames((all) => ({ ...all, [offer.listingId]: e.target.value }))}
              />
              <Button size="sm" variant="ghost" disabled={busy === offer.listingId} onClick={() => void answer(offer.listingId, false, fallback)}>
                Decline
              </Button>
              <Button size="sm" variant="brand" loading={busy === offer.listingId} onClick={() => void answer(offer.listingId, true, fallback)}>
                Accept
              </Button>
            </li>
          );
        })}
      </ul>
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </section>
  );
}
