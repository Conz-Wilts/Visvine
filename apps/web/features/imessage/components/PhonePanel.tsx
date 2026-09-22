'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, ConfirmDialog, Input, SettingsSection, Skeleton } from '@/components/ui';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { inflightFetch, invalidateRequestCache } from '@/features/shared/lib/requestCache';
import { TONE_CHIP, TONE_CLASSES } from '@/features/shared/lib/statusTone';
import { maskPhone } from '@/lib/imessage/shared/phone';

/**
 * Settings → Accounts → Phone (docs/imessage.md § Linking). Three states, one
 * row: no phone (enter one), a code waiting to be texted (the code, and the
 * numbers it can go to), linked (the number and Unlink). The person texts
 * FIRST — nothing is ever sent to a number they have not proved is theirs.
 */
interface State {
  configured: boolean;
  phone: string | null;
  verified: boolean;
  code: string | null;
  codeExpiresAt: string | null;
  lines: Array<{ spaceId: string; spaceName: string; number: string }>;
}

const KEY = 'account:imessage';
const URL = '/api/account/imessage';

export default function PhonePanel() {
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await inflightFetch(KEY, () => fetchJson<State>(URL)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your phone.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A pending code is redeemed by a text, which this page cannot see happen —
  // so while one is waiting, ask again now and then.
  useEffect(() => {
    if (!data?.code) return;
    const t = setInterval(() => {
      invalidateRequestCache(KEY);
      void load();
    }, 5_000);
    return () => clearInterval(t);
  }, [data?.code, load]);

  const start = async () => {
    setBusy(true);
    try {
      setData(await fetchJsonBody<State>(URL, 'POST', { phone }));
      invalidateRequestCache(KEY);
      setPhone('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start linking.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setData(await fetchJson<State>(URL, { method: 'DELETE' }));
    invalidateRequestCache(KEY);
    setRemoving(false);
  };

  if (!data && !error) return <Skeleton className="h-20 w-full" />;
  if (!data) return <Alert variant="error">{error}</Alert>;
  // A person with no line to text has nothing to link to: the section is not drawn.
  if (data.lines.length === 0 && !data.phone) return null;

  return (
    <SettingsSection title="Phone">
      <div className="flex flex-col gap-3">
        {error && <Alert variant="error">{error}</Alert>}

        {data.phone && data.verified && (
          <div className="-mx-3 flex min-h-11 items-center gap-3 rounded-lg px-3 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-text-primary">{maskPhone(data.phone)}</p>
              <p className="truncate text-xs text-text-muted">
                {data.lines.length} {data.lines.length === 1 ? 'space' : 'spaces'} answer
              </p>
            </div>
            <span className={`shrink-0 ${TONE_CHIP} ${TONE_CLASSES.ok}`}>Linked</span>
            <Button variant="danger-text" size="sm" onClick={() => setRemoving(true)}>
              Unlink
            </Button>
          </div>
        )}

        {data.phone && !data.verified && data.code && (
          <div className="flex flex-col gap-2">
            <p className="text-3xl font-semibold tracking-[0.3em] text-text-primary">{data.code}</p>
            <ul className="flex flex-col gap-1">
              {data.lines.map((l) => (
                <li key={l.number} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-text-secondary">{l.spaceName}</span>
                  <a href={`sms:${l.number}&body=${data.code}`} className="font-medium text-text-primary underline-offset-2 hover:underline">
                    {l.number}
                  </a>
                </li>
              ))}
            </ul>
            <p className="text-xs text-text-muted">Text the code from {maskPhone(data.phone)} · expires in 10 min</p>
            <div>
              <Button variant="danger-text" size="sm" onClick={() => void remove()}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {(!data.phone || (!data.verified && !data.code)) && (
          <div className="flex gap-2">
            <Input aria-label="Phone number" placeholder="+1 415 555 0100" value={phone} onChange={(e) => setPhone(e.target.value)} className="max-w-xs" />
            <Button variant="brand" size="sm" disabled={!phone.trim() || busy} onClick={() => void start()}>
              Link
            </Button>
          </div>
        )}

        <ConfirmDialog
          open={removing}
          title="Unlink this phone?"
          confirmLabel="Unlink"
          destructive
          onConfirm={() => void remove()}
          onClose={() => setRemoving(false)}
        />
      </div>
    </SettingsSection>
  );
}
