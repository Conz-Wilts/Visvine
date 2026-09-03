'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Field, Input, Skeleton } from '@/components/ui';
import Select from '@/components/ui/Select';
import { ArrowLeftIcon } from '@/features/shared/icons';
import ConnectorLogo from '@/features/connectors/components/ConnectorLogo';
import { notesApi } from '@/features/notes/lib/notesApi';
import { contextKeys, invalidateContextCache } from '@/features/notes/lib/contextPrefetch';
import { fetchJson } from '@/lib/fetchJson';
import { connectorSlug } from '@/lib/create/noteSlug';
import { TONE_CHIP, TONE_CLASSES } from '@/features/shared/lib/statusTone';
import { MODEL_CATALOG, modelCatalogEntryFor, modelFromCatalog, type ModelCatalogEntry } from '@/lib/models/catalog';
import { modelPath } from '@/lib/models/config';

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

export default function ModelsPanel({ space, onLeave }: { space: string; onLeave?: () => void }) {
  const router = useRouter();
  const [rows, setRows] = useState<ModelRow[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [entry, setEntry] = useState<ModelCatalogEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchJson<{ canManage: boolean; models: ModelRow[] }>(`/api/communities/${encodeURIComponent(space)}/models`)
      .then((data) => {
        if (cancelled) return;
        setRows(data.models);
        setCanManage(data.canManage);
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
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-xs text-text-muted">
          {rows.length === 0
            ? 'What this space’s agents run on. Add one and they can run.'
            : 'Agents run on the first of these unless their brief names another.'}
        </p>
        {canManage && (
          <Button
            variant={rows.length === 0 ? 'brand' : 'neutral'}
            size="sm"
            className={ACTION_SLOT}
            onClick={() => setPicker((p) => !p)}
          >
            {rows.length === 0 ? 'Add model' : picker ? 'Close' : '+ Add'}
          </Button>
        )}
      </div>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      ) : (
        rows.length > 0 && (
          <ul className="divide-y divide-border-subtle border-t border-border-subtle">
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

      {/* The + opens the providers, and nothing else: choosing a model is
          choosing among five, not searching a catalogue of forty. */}
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
    </div>
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
        hint={`Saved as ${modelPath(name)}; briefs pin it as ${entry.provider}/<model-id>.`}
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
