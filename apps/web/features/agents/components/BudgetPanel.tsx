'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Input, Skeleton } from '@/components/ui';
import { fetchJson } from '@/lib/fetchJson';

/**
 * Budget, as a console section: the one number the space sets, and nothing
 * else. Empty = no cap.
 *
 * The cap is compared against the whole ledger, so every agent and every
 * teaching counts toward it; runs pause until next month when it binds, and
 * an agent's own cap (its settings dialog) still applies first.
 *
 * There is no spend reporting here or anywhere: what a space's provider keys
 * were billed is the provider's own account to show, not a report Visvine
 * keeps a second copy of. Tokens are still metered per run — the cap needs
 * them — they are simply not read back as a bill.
 */
export default function BudgetPanel({ spaceId }: { spaceId: string }) {
  const [capCents, setCapCents] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ budgetMonthlyCents: number | null }>(`/api/communities/${spaceId}/usage`)
      .then((data) => {
        if (cancelled) return;
        setCapCents(data.budgetMonthlyCents);
        setInput(data.budgetMonthlyCents != null ? String(data.budgetMonthlyCents / 100) : '');
        setLoaded(true);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the budget.'); });
    return () => { cancelled = true; };
  }, [spaceId]);

  const save = async () => {
    const dollars = input.trim() === '' ? null : Number(input);
    if (dollars !== null && (!Number.isFinite(dollars) || dollars < 0)) {
      setNotice('The cap is a dollar amount, or empty for none.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const cents = dollars === null ? null : Math.round(dollars * 100);
      await fetchJson(`/api/communities/${spaceId}/usage`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ budgetMonthlyCents: cents }),
      });
      setCapCents(cents);
      setNotice('Saved.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not save the cap');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Alert variant="error">{error}</Alert>;
  if (!loaded) return <Skeleton className="h-24 w-full" />;

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-text-muted">
        A monthly ceiling on what this space&apos;s agents may spend on its own provider keys. Every agent pauses for the
        rest of the month once the total reaches it; each agent&apos;s own cap applies first. Leave it empty for no cap.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-32"
          inputMode="decimal"
          placeholder="no cap"
          aria-label="Monthly budget in dollars"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
        />
        <Button variant="neutral" size="sm" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {notice && <span className="text-xs text-text-muted">{notice}</span>}
      </div>
      {capCents == null && <p className="text-xs text-text-muted">No cap set — agents run until you switch them off.</p>}
    </div>
  );
}
