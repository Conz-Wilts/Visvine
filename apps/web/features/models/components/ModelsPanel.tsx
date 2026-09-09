'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Field, Input, Skeleton } from '@/components/ui';
import Select from '@/components/ui/Select';
import NewRow from '@/components/ui/NewRow';
import { ArrowLeftIcon } from '@/features/shared/icons';
import ConnectorLogo from '@/features/connectors/components/ConnectorLogo';
import { notesApi } from '@/features/notes/lib/notesApi';
import { contextKeys, invalidateContextCache } from '@/features/notes/lib/contextPrefetch';
import { fetchJson } from '@/lib/fetchJson';
import { connectorSlug } from '@/lib/create/noteSlug';
import { TONE_CHIP, TONE_CLASSES } from '@/features/shared/lib/statusTone';
import { MODEL_CATALOG, modelCatalogEntryFor, modelFromCatalog, type ModelCatalogEntry } from '@/lib/models/catalog';
import { modelPath } from '@/lib/models/config';
import { LOCAL_RUNTIMES, type LocalRuntimeId } from '@/lib/agents/local';
import { desktopRuntimes, type DesktopRuntimeStatus } from '@/features/desktop/lib/desktop';

/**
 * Models, as the dialog off the account band: what this space's agents run
 * on, one row per note under models/, and a + that offers the providers.
 *
 * A row goes to the model's own page — the note is the model, and the page
 * is where the bill is read. Adding one writes models/<name>.md, the same
 * note an admin could have written by hand, and stores the provider's key as
 * the space's reserved MODEL_KEY_<PROVIDER> secret. A member sees the list
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
  problem: string | null;
  /** Still at connectors/<name>.md — db:models:migrate has not run here. */
  legacy: boolean;
}

const ACTION_SLOT = 'w-24 justify-center';

function statusOf(m: ModelRow): { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' } | null {
  if (!m.enabled) return { label: 'Off', tone: 'muted' };
  if (!m.modelId) return { label: 'No model', tone: 'warn' };
  if (!m.keyStored) return { label: 'No key', tone: 'warn' };
  return null;
}

export default function ModelsPanel({ space, onLeave, onFormOpen }: {
  space: string;
  onLeave?: () => void;
  /** The add form is up — the rail holds the panel open while it is. */
  onFormOpen?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ModelRow[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [entry, setEntry] = useState<ModelCatalogEntry | null>(null);
  const [localOn, setLocalOn] = useState<Record<LocalRuntimeId, boolean>>({ claude: true, codex: true });

  useEffect(() => { onFormOpen?.(entry !== null); }, [entry, onFormOpen]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchJson<{ canManage: boolean; models: ModelRow[]; localRuntimes?: Record<LocalRuntimeId, boolean> }>(`/api/communities/${encodeURIComponent(space)}/models`)
      .then((data) => {
        if (cancelled) return;
        setRows(data.models);
        setCanManage(data.canManage);
        if (data.localRuntimes) setLocalOn(data.localRuntimes);
        setError(null);
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [space]);

  const open = (name: string) => {
    onLeave?.();
    router.push(`/directory/${encodeURIComponent(`model:${name}`)}`);
  };

  if (entry) {
    return (
      <AddModelForm
        entry={entry}
        space={space}
        taken={rows.map((r) => r.name)}
        onBack={() => setEntry(null)}
        onCreated={open}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      ) : (
        (rows.length > 0 || canManage) && (
          <ul className="divide-y divide-border-subtle border-t border-border-subtle">
            {/* Adding one leads the list, a row of it — the shape "New space"
                and "New type" have at the head of theirs. It opens the
                providers under itself, and nothing else. */}
            {canManage && (
              <li className="py-1">
                <NewRow label="Add model" onClick={() => setPicker((p) => !p)} />
              </li>
            )}
            {rows.map((m) => {
              const status = statusOf(m);
              return (
                <li key={m.path} className="py-1">
                  <button
                    onClick={() => open(m.name)}
                    className="-mx-3 flex min-h-14 w-[calc(100%+1.5rem)] items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <ConnectorLogo entry={modelCatalogEntryFor(m.recipe, m.provider)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-text-primary">{m.modelId ?? m.title ?? m.name}</p>
                      <p className="truncate text-xs text-text-muted">{m.providerLabel} · {m.name}</p>
                    </div>
                    {status && <span className={`shrink-0 ${TONE_CHIP} ${TONE_CLASSES[status.tone]}`}>{status.label}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )
      )}

      {/* Choosing a model is choosing among five, not searching a catalogue
          of forty. */}
      {picker && canManage && (
        <ul className="divide-y divide-border-subtle border-t border-border-subtle">
          {MODEL_CATALOG.map((e) => (
            <li key={e.id} className="py-1">
              <button
                onClick={() => { setPicker(false); setEntry(e); }}
                className="-mx-3 flex min-h-14 w-[calc(100%+1.5rem)] items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
              >
                <ConnectorLogo entry={e} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-text-primary">{e.name}</p>
                  <p className="truncate text-xs text-text-muted">{e.description}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
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
  return (
    <section className="flex flex-col border-t border-border-subtle pt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="min-w-0 text-sm font-semibold text-text-primary">Your plan</h3>
        {bridge && (
          <Button variant="neutral" size="sm" className={ACTION_SLOT} disabled={busy !== null} onClick={() => void refresh()}>
            {busy === 'refresh' ? 'Checking…' : 'Check'}
          </Button>
        )}
      </div>
      {notice && <p className="mt-2 text-xs text-text-muted">{notice}</p>}
      {bridge && (
        <ul className="mt-2 divide-y divide-border-subtle border-t border-border-subtle">
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
              <li key={r.id} className="py-1">
                <div className="-mx-3 flex min-h-14 items-center gap-3 rounded-lg px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-text-primary">{r.label}</p>
                    <p className="truncate text-xs text-text-muted" title={r.policy}>
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
      )}
    </section>
  );
}

/**
 * Add: the provider's fields, written as a note plus its key.
 *
 * The title is the note's name once slugged; a title that would land on a
 * note the space already has is refused here rather than at the write. A
 * provider is one row per space — its key is one secret — so a second note
 * to the same provider is refused the same way.
 */
function AddModelForm({
  entry,
  space,
  taken,
  onBack,
  onCreated,
}: {
  entry: ModelCatalogEntry;
  space: string;
  taken: string[];
  onBack: () => void;
  onCreated: (name: string) => void;
}) {
  const [title, setTitle] = useState(entry.name);
  // A field with choices starts on its first one: nobody should have to pick
  // the obvious model before they may paste a key.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(entry.fields.flatMap((f) => (f.choices && f.choices.length > 0 ? [[f.key, f.choices[0].value]] : []))),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = connectorSlug(title) || entry.id;
  const clash = taken.some((n) => n.toLowerCase() === name.toLowerCase());
  const missing = useMemo(() => entry.fields.filter((f) => f.required && !(values[f.key] ?? '').trim()), [entry, values]);
  const ready = !!connectorSlug(title) && !clash && missing.length === 0;

  const submit = async () => {
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      const { content, secrets } = modelFromCatalog(entry, { name, title, description: '', values });
      const path = modelPath(name);
      await notesApi.create(space, path, content);
      for (const secret of secrets) {
        await fetchJson(`/api/communities/${encodeURIComponent(space)}/secrets`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(secret),
        });
      }
      invalidateContextCache(contextKeys.tree(space), contextKeys.list(space), contextKeys.read(space, path));
      onCreated(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the model');
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-4">
        <button
          onClick={onBack}
          aria-label="Back"
          className="mt-1 rounded-lg p-1 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary"
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </button>
        <ConnectorLogo entry={entry} size="lg" />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-text-primary">{entry.name}</h2>
          <p className="text-sm text-text-muted">{entry.description}</p>
        </div>
      </div>

      <Field
        label="Title"
        error={clash ? `This space already has a model called ${name} — give this one a different title.` : undefined}
      >
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={64} />
      </Field>

      {entry.fields.map((f) => (
        <Field
          key={f.key}
          label={<>{f.label}{f.required && <span className="text-red-500"> *</span>}</>}
          hint={f.hint}
        >
          {f.choices && f.choices.length > 0 ? (
            <>
              <Select
                value={f.choices.some((c) => c.value === (values[f.key] ?? '')) ? (values[f.key] ?? '') : ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                aria-label={f.label}
              >
                <option value="">Something else…</option>
                {f.choices.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </Select>
              {!f.choices.some((c) => c.value === (values[f.key] ?? '')) && (
                <Input
                  autoComplete="off"
                  placeholder={f.placeholder}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value.trim() }))}
                  className="mt-2 font-mono text-sm"
                />
              )}
            </>
          ) : (
            <Input
              type={f.secret ? 'password' : 'text'}
              autoComplete="off"
              placeholder={f.placeholder}
              value={values[f.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              className={f.secret ? 'font-mono' : undefined}
            />
          )}
        </Field>
      ))}

      {error && <p className="border-l-2 border-red-500 py-1 pl-3 text-sm text-red-500">{error}</p>}

      <div className="flex items-center justify-end gap-2 border-t border-border-subtle pt-4">
        <Button variant="neutral" onClick={onBack} disabled={saving}>Cancel</Button>
        <Button variant="brand" onClick={submit} disabled={!ready || saving}>
          {saving ? 'Saving…' : 'Add model'}
        </Button>
      </div>
    </div>
  );
}
