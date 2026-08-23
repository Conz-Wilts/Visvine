'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BotIcon, ChevronRightIcon, FolderIcon, FolderOpenIcon, PlayIcon, PlusIcon } from '@/features/shared/icons';
import Toggle from '@/components/ui/Toggle';
import { Button, EmptyState } from '@/components/ui';
import { useCreateSurface } from '@/features/shared/contexts/CreateModalContext';
import { fetchJson } from '@/lib/fetchJson';
import { noteHref } from '@/lib/notes/entities';
import type { AgentFolder, AgentSummary } from '@/lib/agents/service';
import { fmtCents, statusLine, terminalLabel } from '../lib/rowState';
import { buildAgentTree, flattenAgentTree, type AgentTreeFolder, type AgentTreeLeaf } from '../lib/tree';
import StatusDot from './StatusDot';
import ActivateAgentDialog from './ActivateAgentDialog';

/**
 * The roster as the `agents/` folder: folders of agents (each an index note)
 * holding agents and further folders. A folder row folds; its dot is the
 * loudest of what it holds. An agent row: a dot for the state, the name as the
 * link, and the one line worth knowing beneath — the schedule when it is
 * healthy, the problem when it is not. Admins get the switch and, on hover, a
 * play control; members see the same rows with the switch read-only. Anyone
 * may add an agent, on the row they are standing on; folders come from the
 * agent's context, not from here.
 */
const INDENT_PX = 22;

export default function AgentsRoster({
  spaceId,
  agents,
  folders,
  isAdmin,
  currentUserId,
  onChanged,
  onNotice,
}: {
  spaceId: string;
  agents: AgentSummary[];
  folders: AgentFolder[];
  isAdmin: boolean;
  currentUserId: string | null;
  onChanged: () => void;
  onNotice: (message: string, tone: 'ok' | 'warn' | 'bad') => void;
}) {
  const [activating, setActivating] = useState<AgentSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const now = Date.now();
  const openCreate = useCreateSurface();

  const tree = useMemo(() => buildAgentTree(folders, agents, now), [folders, agents, now]);
  const rows = useMemo(() => flattenAgentTree(tree, collapsed), [tree, collapsed]);

  const toggleFolder = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const deactivate = async (a: AgentSummary) => {
    setBusy(a.name);
    try {
      await fetchJson(`/api/communities/${spaceId}/agents/${encodeURIComponent(a.name)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: false }),
      });
      onChanged();
    } catch (e) {
      onNotice(e instanceof Error ? e.message : 'Could not turn off', 'bad');
    } finally {
      setBusy(null);
    }
  };

  const runNow = async (a: AgentSummary) => {
    setBusy(a.name);
    // The request holds until the run finishes; the roster refreshes as it goes.
    const refresh = setInterval(onChanged, 3000);
    try {
      const res = await fetchJson<{ ok: true; outcome: { status: string; reason: string } | null; error: string | null }>(
        `/api/communities/${spaceId}/agents/${encodeURIComponent(a.name)}/run`,
        { method: 'POST' },
      );
      if (res.error) onNotice(res.error, 'bad');
      else if (res.outcome && res.outcome.status !== 'succeeded') onNotice(`${a.title || a.name}: ${terminalLabel(res.outcome.reason)}`, 'warn');
    } catch (e) {
      onNotice(e instanceof Error ? e.message : 'Run failed', 'bad');
    } finally {
      clearInterval(refresh);
      setBusy(null);
      onChanged();
    }
  };

  const toolbar = (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="sm" onClick={() => openCreate('agent')}>
        <PlusIcon className="h-3.5 w-3.5" />
        New agent
      </Button>
    </div>
  );

  if (agents.length === 0 && folders.length === 0) {
    return (
      <EmptyState
        icon={<BotIcon />}
        title="No agents yet"
        description="Agents run on a schedule or a trigger, on the space's model connectors. Start with one."
        action={{ label: 'Create an agent', onClick: () => openCreate('agent') }}
        size="page"
        actionStyle="solid"
      />
    );
  }

  const hoverControl =
    'rounded-md p-1.5 text-text-muted opacity-0 transition-opacity hover:bg-surface-3 hover:text-text-primary focus-visible:opacity-100 group-hover:opacity-100';

  const folderRow = (n: AgentTreeFolder) => {
    const open = !collapsed.has(n.folder.path);
    return (
      <li
        key={`f:${n.folder.path}`}
        className="group -mx-3 flex items-center gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-surface-2"
        style={{ paddingLeft: 12 + n.depth * INDENT_PX }}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${n.folder.title}`}
          onClick={() => toggleFolder(n.folder.path)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRightIcon className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
          {open ? <FolderOpenIcon className="h-4 w-4 shrink-0 text-text-muted" /> : <FolderIcon className="h-4 w-4 shrink-0 text-text-muted" />}
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-text-primary">{n.folder.title}</span>
              {!open && n.agentCount > 0 && <StatusDot tone={n.tone} />}
            </span>
            {n.folder.description && <span className="block truncate text-[13px] text-text-muted">{n.folder.description}</span>}
          </span>
        </button>
        <span className="shrink-0 text-[13px] tabular-nums text-text-muted">{n.agentCount || ''}</span>
        <Link href={noteHref(n.folder.indexPath)} className={hoverControl} title="Open the folder's index note">
          <span className="block text-[11px] font-semibold leading-none">index</span>
        </Link>
        <button
          type="button"
          aria-label={`New agent in ${n.folder.title}`}
          title="New agent here"
          onClick={() => openCreate('agent', { folder: n.folder.path })}
          className={hoverControl}
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </button>
      </li>
    );
  };

  const agentRow = (n: AgentTreeLeaf) => {
    const a = n.agent;
    const line = statusLine(a, now);
    const canRun = isAdmin || (currentUserId !== null && a.authorUserId === currentUserId);
    const runnable = canRun && a.activation.active && a.state.status !== 'running' && !a.invalid;
    const isBusy = busy === a.name;
    return (
      <li
        key={`a:${a.path}`}
        className="group -mx-3 flex items-center gap-4 rounded-lg px-3 py-3 transition-colors hover:bg-surface-2"
        style={{ paddingLeft: 12 + n.depth * INDENT_PX }}
      >
        <Link href={`/directory/${encodeURIComponent(`agent:${a.name}`)}`} className="flex min-w-0 flex-1 items-center gap-3">
          <StatusDot tone={line.tone} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-text-primary">{a.title || a.name}</span>
            <span className={`block truncate text-[13px] ${line.problem ? (line.tone === 'bad' ? 'text-red-600' : 'text-amber-700') : 'text-text-muted'}`}>
              {line.text}
            </span>
          </span>
        </Link>
        {isAdmin && a.spend && (a.spend.monthCents != null || a.spend.budgetMonthlyCents != null) && (
          <span className="hidden shrink-0 text-[13px] tabular-nums text-text-muted sm:block">
            {fmtCents(a.spend.monthCents)}
            {a.spend.budgetMonthlyCents != null && <span className="opacity-60"> / {fmtCents(a.spend.budgetMonthlyCents)}</span>}
          </span>
        )}
        {canRun && (
          <button
            type="button"
            aria-label="Run now"
            title={a.activation.active ? 'Run now' : 'Turn it on first'}
            disabled={!runnable || isBusy}
            onClick={() => runNow(a)}
            className={`${hoverControl} disabled:opacity-0 group-hover:disabled:opacity-30`}
          >
            <PlayIcon className="h-3.5 w-3.5" />
          </button>
        )}
        <Toggle
          checked={a.activation.active}
          disabled={!isAdmin || isBusy || !!a.invalid}
          aria-label={isAdmin ? `Turn ${a.title || a.name} ${a.activation.active ? 'off' : 'on'}` : 'An admin turns agents on'}
          onChange={(next) => (next ? setActivating(a) : deactivate(a))}
        />
      </li>
    );
  };

  return (
    <>
      {toolbar}
      <ul className="divide-y divide-border-subtle">{rows.map((n) => (n.kind === 'folder' ? folderRow(n) : agentRow(n)))}</ul>
      {activating && (
        <ActivateAgentDialog
          spaceId={spaceId}
          agent={activating}
          onClose={() => setActivating(null)}
          onDone={(warning) => {
            setActivating(null);
            onChanged();
            if (warning) onNotice(warning, 'warn');
          }}
        />
      )}
    </>
  );
}
