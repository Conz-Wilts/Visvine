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
 * nothing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SettingsSection } from '@/components/ui';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { fetchApprovalQueue, fetchAuthoredTools, fetchInstalls } from '@/features/tools/lib/client';
import type { AuthoredToolSummary, InstallSummary } from '@/lib/tools/api';
import ApprovalsTab from './ApprovalsTab';
import InstalledTab from './InstalledTab';
import MineTab from './MineTab';
import { ToastHost, useToasts, type ToastTone } from './Toasts';

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

  const load = useCallback(async () => {
    const token = ++run.current;
    if (!spaceId) {
      setInstalls([]);
      return;
    }
    try {
      const body = await fetchInstalls(spaceId);
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
          void load();
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
 * The Approvals badge — read separately from the queue's own content, because
 * the count is what tells an admin the section is worth opening.
 */
export function useToolApprovalCount(): { count: number; refresh: () => void } {
  const { currentSpace } = useSpace();
  const spaceId = currentSpace?.id ?? null;
  const [count, setCount] = useState(0);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    if (!spaceId) {
      setCount(0);
      return;
    }
    fetchApprovalQueue(spaceId)
      .then((body) => {
        if (live) setCount(body.queue.length);
      })
      // A count is decoration; a toast for one would be noise over a screen
      // the admin did not ask for.
      .catch(() => {
        if (live) setCount(0);
      });
    return () => {
      live = false;
    };
  }, [spaceId, nonce]);

  return { count, refresh: useCallback(() => setNonce((n) => n + 1), []) };
}

/**
 * "Approvals" — the versions this space's members published that nobody with
 * the authority to say yes has looked at yet.
 */
export function ToolApprovalsPanel({ onReviewed }: { onReviewed: () => void }) {
  const { currentSpace } = useSpace();
  const spaceId = currentSpace?.id ?? null;
  const { toasts, toast, dismiss } = usePanelToasts();

  return (
    <>
      <ApprovalsTab spaceId={spaceId} onReviewed={onReviewed} onToast={toast} />
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </>
  );
}
