'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, ConfirmDialog, Skeleton, Toggle } from '@visvine/ui';
import ConnectorLogo from '@/features/connectors/components/ConnectorLogo';
import { fetchJson } from '@/lib/fetchJson';
import { inflightFetch, invalidateRequestCache } from '@/features/shared/lib/requestCache';
import { TONE_CHIP, TONE_CLASSES } from '@/features/shared/lib/statusTone';
import { ACCOUNTS_SETTINGS_PATH, accountConnectPath, accountOnIn } from '@/lib/connectors/accountRecipes';

/**
 * A person's own accounts: the services they sign in to once and spend in
 * every space they act in (lib/connectors/accountRecipes.ts). Nothing here is
 * about a space — a space's connectors are its console's.
 *
 * One list: what is connected, a hairline, what is not. A connected row opens
 * onto the spaces it is on in, and Disconnect.
 */
interface Account {
  name: string;
  recipe: string;
  accountLabel: string | null;
  offSpaces: string[];
  broken: string | null;
}
interface Service {
  id: string;
  name: string;
  description: string;
  logo: string;
}
interface AccountsResponse {
  accounts: Account[];
  services: Service[];
  spaces: Array<{ id: string; name: string }>;
}

const ACCOUNTS_KEY = 'account:connectors';
const ACTION_SLOT = 'shrink-0 whitespace-nowrap text-center';
const ROW = '-mx-3 flex min-h-11 items-center gap-3 rounded-lg px-3 py-1.5';

function signIn(target: { recipe: string } | { name: string }) {
  window.location.href = accountConnectPath(target, ACCOUNTS_SETTINGS_PATH);
}

export default function AccountsPanel() {
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Account | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await inflightFetch(ACCOUNTS_KEY, () => fetchJson<AccountsResponse>('/api/account/connectors')));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your accounts.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // What the sign-in's return said, once.
  useEffect(() => {
    const failed = new URLSearchParams(window.location.search).get('connect_error');
    if (failed) setError(failed);
  }, []);

  const setOff = async (account: Account, offSpaces: string[]) => {
    // Held optimistically: the switch has already moved under the finger.
    setData((d) => d && { ...d, accounts: d.accounts.map((a) => (a.name === account.name ? { ...a, offSpaces } : a)) });
    try {
      await fetchJson(`/api/account/connectors/${encodeURIComponent(account.name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offSpaces }),
      });
      invalidateRequestCache(ACCOUNTS_KEY);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
      void load();
    }
  };

  const remove = async (account: Account) => {
    await fetchJson(`/api/account/connectors/${encodeURIComponent(account.name)}`, { method: 'DELETE' });
    invalidateRequestCache(ACCOUNTS_KEY);
    setRemoving(null);
    setOpen(null);
    await load();
  };

  if (!data && !error) return <Skeleton className="h-40 w-full" />;
  const accounts = data?.accounts ?? [];
  const services = data?.services ?? [];
  const spaces = data?.spaces ?? [];
  const serviceOf = (recipe: string) => services.find((s) => s.id === recipe) ?? null;
  const unconnected = services.filter((s) => !accounts.some((a) => a.recipe === s.id));

  return (
    <div className="flex flex-col gap-2">
      {error && <Alert variant="error">{error}</Alert>}

      <ul>
        {accounts.map((a) => {
          const service = serviceOf(a.recipe);
          const off = spaces.filter((s) => !accountOnIn(a.offSpaces, s.id)).length;
          const state = [a.accountLabel, off > 0 ? `off in ${off} ${off === 1 ? 'space' : 'spaces'}` : null]
            .filter(Boolean)
            .join(' · ');
          const expanded = open === a.name;
          return (
            <li key={a.name} className="py-0.5">
              <div className={ROW}>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : a.name)}
                >
                  <ConnectorLogo name={a.name} recipe={a.recipe} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-fg">{service?.name ?? a.name}</p>
                    {state && <p className="truncate text-xs text-fg-muted">{state}</p>}
                  </div>
                </button>
                {a.broken ? (
                  <Button variant="brand" size="sm" className={ACTION_SLOT} onClick={() => signIn({ name: a.name })}>
                    Reconnect
                  </Button>
                ) : (
                  <span className={`shrink-0 ${TONE_CHIP} ${TONE_CLASSES.ok}`}>Connected</span>
                )}
              </div>

              {expanded && (
                <div className="mb-2 ml-11 flex flex-col gap-1 border-l border-line-subtle pl-4">
                  {spaces.map((s) => (
                    <div key={s.id} className="flex min-h-9 items-center justify-between gap-3">
                      <span className="truncate text-sm text-fg-secondary">{s.name}</span>
                      <Toggle
                        aria-label={`Use in ${s.name}`}
                        checked={accountOnIn(a.offSpaces, s.id)}
                        onChange={(on) =>
                          void setOff(a, on ? a.offSpaces.filter((id) => id !== s.id) : [...a.offSpaces, s.id])
                        }
                      />
                    </div>
                  ))}
                  <div className="flex gap-2 pt-1">
                    {service && (
                      <Button variant="neutral" size="sm" onClick={() => signIn({ recipe: a.recipe })}>
                        Add another
                      </Button>
                    )}
                    <Button variant="danger-text" size="sm" onClick={() => setRemoving(a)}>
                      Disconnect
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {accounts.length > 0 && unconnected.length > 0 && <hr className="border-line-subtle" />}

      <ul>
        {unconnected.map((s) => (
          <li key={s.id} className="py-0.5">
            <div className={ROW}>
              <ConnectorLogo entry={s} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-fg">{s.name}</p>
                <p className="truncate text-xs text-fg-muted">{s.description}</p>
              </div>
              <Button variant="brand" size="sm" className={ACTION_SLOT} onClick={() => signIn({ recipe: s.id })}>
                Connect
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={removing !== null}
        title={`Disconnect ${removing ? (serviceOf(removing.recipe)?.name ?? removing.name) : ''}?`}
        confirmLabel="Disconnect"
        destructive
        onConfirm={() => (removing ? remove(removing) : undefined)}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
