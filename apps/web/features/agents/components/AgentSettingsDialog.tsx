'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Input, Modal } from '@/components/ui';
import { fetchJson } from '@/lib/fetchJson';
import type { AgentSummary } from '@/lib/agents/service';
import { hrefForNotePath } from '@/lib/notes/entities';
import { memoryPath, memorySummary } from '@/lib/agents/shared/memory';
import AgentSettingsPanel from './AgentSettingsPanel';
import MachinePane from './MachinePane';
import SkillsPanel from './SkillsPanel';
import { fmtCents } from '../lib/rowState';

/**
 * Everything about an agent you set up or look into rather than watch, behind
 * one gear: the brief's own settings — model, tools, connectors — the monthly
 * cap for an admin, what it remembers, the skills it has been taught and, for
 * an admin, the machine's live screen. One dialog with a tab per part, so the
 * page itself stays the run.
 */
export type SettingsTab = 'settings' | 'memory' | 'skills' | 'machine';

export default function AgentSettingsDialog({
  spaceId,
  agent,
  isAdmin,
  canManage,
  liveRun,
  initialTab = 'settings',
  onClose,
  onSaved,
  onEditBrief,
}: {
  spaceId: string;
  agent: AgentSummary & { brief: string; memory: string | null };
  isAdmin: boolean;
  canManage: boolean;
  /** Whether a run is in flight — the machine tab watches its screen from the start. */
  liveRun: boolean;
  initialTab?: SettingsTab;
  onClose: () => void;
  onSaved: () => void;
  onEditBrief: () => void;
}) {
  const tabs: { id: SettingsTab; label: string }[] = [
    ...(canManage ? [{ id: 'settings' as const, label: 'Settings' }] : []),
    { id: 'memory', label: 'Memory' },
    { id: 'skills', label: 'Skills' },
    ...(isAdmin ? [{ id: 'machine' as const, label: 'Machine' }] : []),
  ];
  const [tab, setTab] = useState<SettingsTab>(tabs.some((t) => t.id === initialTab) ? initialTab : tabs[0].id);
  const [budgetInput, setBudgetInput] = useState(
    agent.spend?.budgetMonthlyCents != null ? (agent.spend.budgetMonthlyCents / 100).toFixed(2) : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const memory = memorySummary(agent.memory);

  const saveBudget = async () => {
    const dollars = budgetInput.trim() === '' ? null : Number(budgetInput);
    if (dollars !== null && (!Number.isFinite(dollars) || dollars < 0)) {
      setError('The cap is a dollar amount, or empty for none.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/communities/${spaceId}/agents/${encodeURIComponent(agent.name)}/budget`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ budgetMonthlyCents: dollars === null ? null : Math.round(dollars * 100) }),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the cap');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title={agent.title || agent.name} size={tab === 'machine' ? 'lg' : 'md'}>
      <div className="flex flex-col gap-5">
        <div role="tablist" className="flex gap-1 border-b border-border-subtle">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              className={`-mb-px border-b-2 px-2.5 pb-2 text-[13px] font-medium ${
                tab === t.id ? 'border-text-primary text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary'
              }`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'settings' && canManage && (
          <div className="flex flex-col gap-6">
            <AgentSettingsPanel spaceId={spaceId} agent={agent} isAdmin={isAdmin} onSaved={onSaved} />

            {isAdmin && (
              <section className="flex flex-col gap-2 border-t border-border-subtle pt-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Monthly cap</h3>
                <div className="flex items-center gap-2">
                  <Input
                    className="w-32"
                    inputMode="decimal"
                    placeholder="no cap"
                    value={budgetInput}
                    onChange={(e) => setBudgetInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveBudget();
                    }}
                  />
                  <Button variant="ghost" size="sm" onClick={saveBudget} disabled={busy}>
                    Save cap
                  </Button>
                  <p className="text-[12px] text-text-muted">{fmtCents(agent.spend?.monthCents)} spent this month</p>
                </div>
                {error && <p className="text-[12px] text-red-600">{error}</p>}
              </section>
            )}

            <p className="border-t border-border-subtle pt-4 text-[13px] text-text-muted">
              What it reads, produces and writes is the brief itself —{' '}
              <button type="button" className="font-semibold text-brand-dark-green hover:underline" onClick={onEditBrief}>
                edit the note
              </button>
              .
            </p>
          </div>
        )}

        {/* What it carries between runs — the memory note, as a glance: how
            much it holds and the open threads. The note itself is where a
            person corrects it. */}
        {tab === 'memory' && (
          <div className="flex flex-col gap-2 text-[13px]">
            {memory.total === 0 ? (
              <p className="text-text-muted">Nothing yet. It adds to this as it runs.</p>
            ) : (
              <>
                <p className="text-text-muted">
                  {memory.counts
                    .filter((c) => c.count > 0)
                    .map((c) => `${c.count} ${c.section.toLowerCase()}`)
                    .join(' · ')}
                </p>
                {memory.open.length > 0 && (
                  <ul className="flex flex-col gap-0.5 text-text-secondary">
                    {memory.open.map((line) => (
                      <li key={line} className="truncate" title={line}>
                        {line}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            <Link href={hrefForNotePath(memoryPath(agent.name), null)} className="w-fit text-[12px] font-semibold text-brand-dark-green hover:underline">
              Open the memory note
            </Link>
          </div>
        )}

        {tab === 'skills' && <SkillsPanel spaceId={spaceId} agentName={agent.name} isAdmin={isAdmin} />}

        {/* The machine's live screen and terminal. Admins only — a terminal
            is not a member's surface. */}
        {tab === 'machine' && isAdmin && <MachinePane spaceId={spaceId} agentName={agent.name} autoWatch={liveRun} />}
      </div>
    </Modal>
  );
}
