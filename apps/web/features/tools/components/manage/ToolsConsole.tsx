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
import { SettingsSection } from '@/components/ui';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { fetchApprovalQueue, fetchAuthoredTools, fetchInstalls } from '@/features/tools/lib/client';
import type { ApprovalQueueItem, AuthoredToolSummary, InstallSummary } from '@/lib/tools/api';
import { invalidateRequestCache, swrFetch } from '@/features/shared/lib/requestCache';
import ApprovalsTab from './ApprovalsTab';
import InstalledTab from './InstalledTab';
import MineTab from './MineTab';
import { ToastHost, useToasts, type ToastTone } from './Toasts';

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

  return (
    <SettingsSection
      title="Installed"
      description="Versions this space runs, and the upgrades waiting to be applied."
    >
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
    </SettingsSection>
  );
}

/**
 * "Build" — the working copies authored in this space: what builds, what
 * doesn't, and the way to ship one.
 */
export function AuthoredToolsPanel() {
  const { currentSpace } = useSpace();
  const spaceId = currentSpace?.id ?? null;
  const { toasts, toast, dismiss } = usePanelToasts();

  const [tools, setTools] = useState<AuthoredToolSummary[] | null>(null);
  const run = useRef(0);

  const load = useCallback(async () => {
    const token = ++run.current;
    if (!spaceId) {
      setTools([]);
      return;
    }
    try {
      const body = await fetchAuthoredTools(spaceId);
      if (token !== run.current) return;
      setTools(body.tools);
    } catch (err) {
      if (token !== run.current) return;
      setTools([]);
      toast('error', err instanceof Error ? err.message : 'Could not read the tools you have written.');
    }
  }, [spaceId, toast]);

  useEffect(() => {
    setTools(null);
    void load();
  }, [load]);

  return (
    <>
      <MineTab
        spaceId={spaceId}
        tools={tools ?? []}
        isAdmin
        loading={tools === null}
        onChanged={() => void load()}
        onToast={toast}
      />
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </>
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
  const { currentSpace } = useSpace();
  const spaceId = currentSpace?.id ?? null;
  const { toasts, toast, dismiss } = usePanelToasts();

  return (
    <>
      <ApprovalsTab spaceId={spaceId} queue={queue} onReviewed={onReviewed} onToast={toast} />
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </>
  );
}
