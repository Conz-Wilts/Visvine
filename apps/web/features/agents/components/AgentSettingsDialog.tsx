'use client';

import { useState } from 'react';
import { Button, Input, Modal } from '@/components/ui';
import { fetchJson } from '@/lib/fetchJson';
import type { AgentSummary } from '@/lib/agents/service';
import AgentSettingsPanel from './AgentSettingsPanel';
import { fmtCents } from '../lib/rowState';

/**
 * Everything about an agent you set once and then forget: the brief's own
 * settings — model, tools, connectors — and, for an admin, the monthly cap.
 *
 * It is a dialog rather than a panel because the page is for WATCHING the
 * agent. Nothing here changes between one run and the next, so leaving it
 * open on the page would put a form where the work should be.
 */
export default function AgentSettingsDialog({
  spaceId,
  agent,
  isAdmin,
  onClose,
  onSaved,
  onEditBrief,
}: {
  spaceId: string;
  agent: AgentSummary & { brief: string };
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
  onEditBrief: () => void;
}) {
  const [budgetInput, setBudgetInput] = useState(
    agent.spend?.budgetMonthlyCents != null ? (agent.spend.budgetMonthlyCents / 100).toFixed(2) : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <Modal onClose={onClose} title="Settings" size="md">
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
    </Modal>
  );
}
