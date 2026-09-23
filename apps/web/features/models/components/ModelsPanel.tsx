'use client';

import { useEffect, useState } from 'react';
import { useSpaceRouter } from '@/features/shared/hooks/useSpaceRouter';
import { Alert, Button, Skeleton } from '@visvine/ui';
import ConnectorLogo from '@/features/connectors/components/ConnectorLogo';
import { fetchJson } from '@/lib/fetchJson';
import { TONE_CHIP, TONE_CLASSES } from '@/features/shared/lib/statusTone';
import { modelCatalogEntryFor } from '@/lib/models/catalog';
import { LOCAL_RUNTIMES, type LocalRuntimeId } from '@/lib/agents/local';
import { desktopRuntimes, type DesktopRuntimeStatus } from '@/features/desktop/lib/desktop';

/**
 * Models, as a section of the Space Console: what this space's agents run on,
 * one row per note under models/.
 *
 * A row goes to the model's own page — the note is the model, and the page is
 * where the provider's key is pasted. A model is written by an AI over MCP
 * (models/<name>.md, an admin's write); the key never passes through it. A member sees the list
 * (a brief is theirs to write, and it runs on the first of these) and none
 * of the acts.
 *
 * YOUR PLAN, underneath, is the member's own: Claude Code or Codex on this
 * machine, signed in to their Claude or ChatGPT plan, which the desktop shell
 * runs for them (lib/agents/local.ts). In a browser the section says where
 * to go; in the desktop app it says whether each is installed and signed
 * in, and Sign in opens the vendor's own login in a terminal.
 *
 * The panel is rows and their acts, not prose: what a row is is the row, so
 * nothing here explains the list above it.
 */

/** One row of GET …/models. */
interface ModelRow {
  name: string;
  path: string;
  title: string | null;
  recipe: string | null;
  provider: string;
  providerLabel: string;
  modelId: string | null;
  ref: string | null;
  enabled: boolean;
  keyStored: boolean;
  /** The parent space whose key this model runs on, when the key is lent down. */
  keyFrom: { id: string; name: string } | null;
  /** The parent space whose model note this is — a space with no models of its own runs on the house's. */
  sharedFrom: { id: string; name: string } | null;
  problem: string | null;
  /** Still at connectors/<name>.md — db:models:migrate has not run here. */
  legacy: boolean;
}

const ACTION_SLOT = 'shrink-0 justify-center whitespace-nowrap';

function statusOf(m: ModelRow): { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' } | null {
  if (!m.enabled) return { label: 'Off', tone: 'muted' };
  if (!m.modelId) return { label: 'No model', tone: 'warn' };
  if (!m.keyStored) return { label: 'No key', tone: 'warn' };
  if (m.sharedFrom) return { label: `${m.sharedFrom.name}'s model`, tone: 'ok' };
  if (m.keyFrom) return { label: `Using ${m.keyFrom.name}'s key`, tone: 'ok' };
  return null;
}

export default function ModelsPanel({ space }: {
  space: string;
}) {
  const router = useSpaceRouter();
  const [rows, setRows] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localOn, setLocalOn] = useState<Record<LocalRuntimeId, boolean>>({ claude: true, codex: true });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchJson<{ models: ModelRow[]; localRuntimes?: Record<LocalRuntimeId, boolean> }>(`/api/spaces/${encodeURIComponent(space)}/models`)
      .then((data) => {
        if (cancelled) return;
        setRows(data.models);
        if (data.localRuntimes) setLocalOn(data.localRuntimes);
        setError(null);
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [space]);

  const open = (name: string) => {
    router.push(`/directory/${encodeURIComponent(`model:${name}`)}`);
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      ) : (
        rows.length > 0 && (
          <ul className="divide-y divide-line-subtle border-t border-line-subtle">
            {rows.map((m) => {
              const status = statusOf(m);
              return (
                <li key={m.path} className="py-0.5">
                  <button
                    onClick={() => open(m.name)}
                    className="-mx-3 flex min-h-11 w-[calc(100%+1.5rem)] items-center gap-3 rounded-lg px-3 py-1.5 text-left transition-colors hover:bg-surface-subtle"
                  >
                    <ConnectorLogo entry={modelCatalogEntryFor(m.recipe, m.provider)} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-fg">{m.modelId ?? m.title ?? m.name}</p>
                      <p className="truncate text-xs text-fg-muted">{m.providerLabel} · {m.name}</p>
                    </div>
                    {status && <span className={`shrink-0 ${TONE_CHIP} ${TONE_CLASSES[status.tone]}`}>{status.label}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )
      )}

      {(localOn.claude || localOn.codex) && <YourPlan enabled={localOn} />}
    </div>
  );
}

/**
 * The member's own plan, run from this machine. Status comes from the
 * desktop shell asking the binaries themselves; nothing here reads a
 * credential. Sign in hands over to the vendor's own login and the row
 * refreshes when the dialog is next opened, or on Check.
 *
 * It is the DESKTOP shell's section and renders nowhere else: in a browser
 * there is no bridge to ask, so every row would be a name with no status and
 * no act — a heading standing over nothing.
 */
function YourPlan({ enabled }: { enabled: Record<LocalRuntimeId, boolean> }) {
  const bridge = desktopRuntimes();
  const [statuses, setStatuses] = useState<DesktopRuntimeStatus[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    if (!bridge) return;
    setBusy('refresh');
    try {
      setStatuses(await bridge.list());
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runtimes = LOCAL_RUNTIMES.filter((r) => enabled[r.id]);
  if (!bridge) return null;
  return (
    <section className="flex flex-col border-t border-line-subtle pt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="min-w-0 text-sm font-semibold text-fg">Your plan</h3>
        <Button variant="neutral" size="sm" className={ACTION_SLOT} disabled={busy !== null} onClick={() => void refresh()}>
          {busy === 'refresh' ? 'Checking…' : 'Check'}
        </Button>
      </div>
      {notice && <p className="mt-2 text-xs text-fg-muted">{notice}</p>}
      <ul className="mt-2 divide-y divide-line-subtle border-t border-line-subtle">
          {runtimes.map((r) => {
            const s = statuses?.find((x) => x.id === r.id) ?? null;
            const state = !statuses
              ? { label: 'Checking', tone: 'muted' as const }
              : !s?.installed
                ? { label: 'Not installed', tone: 'muted' as const }
                : s.loggedIn
                  ? { label: 'Signed in', tone: 'ok' as const }
                  : { label: 'Not signed in', tone: 'warn' as const };
            return (
              <li key={r.id} className="py-0.5">
                <div className="-mx-3 flex min-h-11 items-center gap-3 rounded-lg px-3 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-fg">{r.label}</p>
                    <p className="truncate text-xs text-fg-muted" title={r.policy}>
                      {s?.detail ?? (s?.installed ? `${r.binary} ${s.version ?? ''}${s.authMethod ? ` · ${s.authMethod}` : ''}` : r.policy)}
                    </p>
                  </div>
                  <span className={`shrink-0 ${TONE_CHIP} ${TONE_CLASSES[state.tone]}`}>{state.label}</span>
                  {s?.installed && !s.loggedIn && (
                    <Button
                      variant="brand"
                      size="sm"
                      className={ACTION_SLOT}
                      disabled={busy !== null}
                      onClick={async () => {
                        setBusy(r.id);
                        setNotice(null);
                        try {
                          const res = await bridge.login(r.id);
                          setNotice(res.detail ?? (res.ok ? 'Finish signing in, then press Check.' : 'Could not open the sign-in.'));
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      {busy === r.id ? 'Opening…' : 'Sign in'}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
      </ul>
    </section>
  );
}
