'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ConfirmDialog, Field, Input, Modal, SearchInput, Skeleton, Alert } from '@/components/ui';
import { ArrowLeftIcon, CircleCheckIcon, InfoIcon } from '@/features/shared/icons';
import ConnectorLogo from './ConnectorLogo';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { useCreateSurface } from '@/features/shared/contexts/CreateModalContext';
import { notesApi } from '@/features/notes/lib/notesApi';
import { contextKeys, invalidateContextCache } from '@/features/notes/lib/contextPrefetch';
import { fetchJson } from '@/lib/fetchJson';
import { connectorSlug } from '@/lib/create/noteSlug';
import { TONE_CHIP, TONE_CLASSES } from '@/features/shared/lib/statusTone';
import {
  CONNECTOR_CATALOG,
  connectorFromCatalog,
  searchCatalog,
  type CatalogEntry,
} from '@/lib/connectors/catalog';

/**
 * Connectors, as a console section: one searchable list of services — connected
 * ones carry a Manage (edit / delete), the rest a Connect that opens a short
 * form in place.
 *
 * There is no separate "add" surface. Picking Granola and pasting its key
 * writes connectors/granola.md — the same note an admin could have written by
 * hand — and stores the key as a secret. Nothing about the permission model
 * moves: the note is admin-only to write, secrets are write-only, and
 * `connectors:use` still gates who may run it.
 *
 * A connected row goes to the connector's own page — the note is the connector,
 * so that page is where it is read and edited. Manage is the other half: it
 * opens what the space has (what it reaches, which secrets, where the note is)
 * with the two acts that belong to a list rather than a page — turn it off, or
 * delete it.
 *
 * A connector the space wrote itself is a row here too, under a plug rather
 * than a logo: it is the same `connectors/<name>.md`, it just has no recipe
 * behind it. Writing one is still the draft surface's job — this section
 * lists and connects, it does not author prose.
 */

/**
 * The list is one of two halves — what the space has, and what it could add.
 * There is no combined view: the two are different questions, and a row's
 * answer ("Manage" or "Connect") is what the reader came for.
 */
type Filter = 'connected' | 'not-connected';

/** What the space already has, by note name — one row of GET …/connectors. */
interface ExistingConnector {
  name: string;
  path: string;
  kind: 'http' | 'model';
  /** Set for `kind: model` — the registry provider the note names. */
  model: { provider: string; providerLabel: string } | null;
  alias: string | null;
  description: string | null;
  hosts: string[];
  /** `enabled: false` in the note — off, but still configured. */
  enabled: boolean;
  invalid: string | null;
  warnings: string[];
  /** Secret NAMES the note references — never values. */
  secrets: string[];
  missingSecrets: string[];
}

type Tone = 'ok' | 'warn' | 'bad' | 'muted';

/**
 * A connected connector's verdict, in the order the failures actually bite: a
 * note that doesn't parse is refused before anything else is consulted, a
 * missing secret before the request is built, and an empty allowlist before it
 * is sent. A healthy connector says nothing — the chip flags the ways one
 * fails, it doesn't congratulate the working ones.
 */
function statusOf(connector: ExistingConnector): { label: string; detail: string; tone: Tone } | null {
  // Off comes first: a connector nobody can run has no interesting second
  // opinion about its secrets.
  if (!connector.enabled) return { label: 'Off', detail: 'Turned off — every run is refused', tone: 'muted' };
  if (connector.invalid) return { label: 'Invalid', detail: connector.invalid, tone: 'bad' };
  if (connector.missingSecrets.length > 0) {
    const names = connector.missingSecrets.join(', ');
    return {
      label: 'Missing secrets',
      detail: `${names} ${connector.missingSecrets.length === 1 ? 'is' : 'are'} not stored yet`,
      tone: 'warn',
    };
  }
  if (connector.warnings.length > 0) {
    return { label: 'Needs migration', detail: connector.warnings[0], tone: 'warn' };
  }
  if (connector.kind !== 'model' && connector.hosts.length === 0) {
    return { label: 'No network', detail: 'No hosts declared yet', tone: 'warn' };
  }
  return null;
}

/** The status line's colour — the chip beside it carries the same tone. */
function statusColor(tone: Tone): string {
  if (tone === 'bad') return 'text-red-600';
  if (tone === 'warn') return 'text-amber-700';
  return 'text-text-muted';
}

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'connected', label: 'Connected' },
  { id: 'not-connected', label: 'Not connected' },
];

export default function ConnectorsPanel() {
  const router = useRouter();
  const { currentSpace } = useSpace();
  const openCreate = useCreateSurface();
  const spaceId = currentSpace?.id ?? null;

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('connected');
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [existing, setExisting] = useState<ExistingConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The connector Manage is open on, by note name, plus the recipe blurb the
  // row had to hand. The name and not the row: a toggle re-reads the list, and
  // the dialog has to show what the space now has rather than a snapshot.
  const [manage, setManage] = useState<{ name: string; about: string | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExistingConnector | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // The connector whose on/off write is in flight, and what went wrong if it did.
  const [toggling, setToggling] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Re-read what's connected on mount, on a space switch, and after a delete.
  const [reloadKey, setReloadKey] = useState(0);
  // The space whose first load has already chosen a tab.
  const landedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;
    setLoading(true);
    fetchJson<{ connectors: ExistingConnector[] }>(`/api/communities/${encodeURIComponent(spaceId)}/connectors`)
      .then((data) => {
        if (cancelled) return;
        setExisting(data.connectors);
        setError(null);
        // Connected is the question an admin usually has, but a space with
        // nothing connected would open on an empty list — so land on the
        // catalog instead. Once per space: a later reload (a delete, a toggle)
        // must not move the tab out from under whoever chose it.
        if (landedRef.current !== spaceId) {
          landedRef.current = spaceId;
          setFilter(data.connectors.length > 0 ? 'connected' : 'not-connected');
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [spaceId, reloadKey]);

  const byName = useMemo(() => new Map(existing.map((e) => [e.name, e])), [existing]);
  const catalogIds = useMemo(() => new Set(CONNECTOR_CATALOG.map((e) => e.id)), []);

  const results = useMemo(
    () =>
      searchCatalog(query).filter((e) =>
        byName.has(e.id) ? filter === 'connected' : filter === 'not-connected',
      ),
    [query, filter, byName],
  );

  // Connectors the space wrote itself — a note under connectors/ that no recipe
  // owns. Always "connected": the note IS the connector.
  const custom = useMemo(() => {
    if (filter === 'not-connected') return [];
    const q = query.trim().toLowerCase();
    return existing
      .filter((c) => !catalogIds.has(c.name))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.alias ?? '').toLowerCase().includes(q));
  }, [existing, catalogIds, query, filter]);

  const connectedCount = existing.length;

  const remove = async () => {
    if (!confirmDelete || !spaceId) return;
    setDeleteError(null);
    try {
      await notesApi.remove(spaceId, confirmDelete.path);
      invalidateContextCache(
        contextKeys.tree(spaceId),
        contextKeys.list(spaceId),
        contextKeys.read(spaceId, confirmDelete.path),
      );
      setConfirmDelete(null);
      setManage(null);
      setReloadKey((k) => k + 1);
      router.refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete the connector');
    }
  };

  /**
   * Turn a connector off (or back on). The note, its secrets and its perimeter
   * stay exactly as they are — `enabled: false` in the frontmatter is what
   * loadConnector refuses on, so an off connector is configuration held in
   * reserve rather than something to delete and rebuild.
   */
  const setEnabled = async (connector: ExistingConnector, on: boolean) => {
    if (!spaceId) return;
    setToggling(connector.name);
    setToggleError(null);
    try {
      await fetchJson(
        `/api/communities/${encodeURIComponent(spaceId)}/connectors/${encodeURIComponent(connector.name)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: on }),
        },
      );
      invalidateContextCache(contextKeys.read(spaceId, connector.path));
      setReloadKey((k) => k + 1);
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : 'Could not change the connector');
    } finally {
      setToggling(null);
    }
  };

  const openConnector = (name: string) =>
    router.push(`/directory/${encodeURIComponent(`connector:${name}`)}`);

  if (entry) {
    return (
      <EntryForm
        entry={entry}
        spaceId={spaceId}
        onBack={() => setEntry(null)}
        onCreated={(href) => router.push(href)}
      />
    );
  }

  /** The Manage / Connect end of a row. */
  const rowActions = (
    connected: ExistingConnector | null,
    onConnect: () => void,
    about: string | null = null,
  ) =>
    connected ? (
      <>
        {connected.enabled && (
          <CircleCheckIcon className="h-4 w-4 shrink-0 text-brand-dark-green" aria-label="Connected" />
        )}
        <Button
          variant="neutral"
          size="sm"
          aria-haspopup="dialog"
          onClick={() => { setToggleError(null); setManage({ name: connected.name, about }); }}
        >
          Manage
        </Button>
      </>
    ) : (
      <Button variant="brand" size="sm" onClick={onConnect}>
        Connect
      </Button>
    );

  // What Manage opens: what the space actually has — what it reaches, which
  // secrets it names, where the note is — and the two acts that belong to a
  // list rather than to the connector's own page. A dialog and not a row
  // expander: these are the space's keys to somebody else's system, so the
  // question gets the screen. Editing is not one of them: the row itself goes
  // to the page for that.
  const managed = manage ? existing.find((c) => c.name === manage.name) ?? null : null;

  const managePanel = (connected: ExistingConnector, about?: string | null) => (
    <Modal
      open
      size="sm"
      title={connected.name}
      onClose={() => setManage(null)}
      footer={
        <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-5 py-3">
          <Button
            variant="danger-text"
            size="sm"
            onClick={() => { setDeleteError(null); setConfirmDelete(connected); }}
          >
            Delete
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="neutral" size="sm" onClick={() => setManage(null)}>
              Close
            </Button>
            <Button
              variant="neutral"
              size="sm"
              disabled={toggling === connected.name}
              onClick={() => setEnabled(connected, !connected.enabled)}
            >
              {toggling === connected.name ? 'Saving…' : connected.enabled ? 'Turn off' : 'Turn on'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="px-5 py-4 text-[13px] text-text-secondary">
        {(connected.description ?? about) && (
          <p className="font-medium text-text-primary">{connected.description ?? about}</p>
        )}
        <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
          <dt className="text-text-muted">Reaches</dt>
          <dd className="min-w-0 break-words">
            {connected.kind === 'model'
              ? 'The model provider’s own endpoint'
              : connected.hosts.length > 0
                ? connected.hosts.join(', ')
                : 'Nothing — no hosts declared'}
          </dd>
          <dt className="text-text-muted">Secrets</dt>
          <dd className="min-w-0 break-words">
            {connected.secrets.length === 0 ? (
              'None'
            ) : (
              connected.secrets.map((secret, i) => (
                <span key={secret}>
                  {i > 0 && ', '}
                  <span className={connected.missingSecrets.includes(secret) ? 'text-amber-700' : undefined}>
                    {secret}
                    {connected.missingSecrets.includes(secret) && ' (not stored)'}
                  </span>
                </span>
              ))
            )}
          </dd>
          <dt className="text-text-muted">Note</dt>
          <dd className="min-w-0 break-words font-mono text-xs">{connected.path}</dd>
        </dl>
        {connected.invalid && <p className="mt-2 text-red-600">Not working: {connected.invalid}</p>}
        {!connected.enabled && (
          <p className="mt-2">
            Turned off. The note and its secrets are untouched — every run is refused until it is
            switched back on.
          </p>
        )}
        {toggleError && <p className="mt-2 text-red-600">{toggleError}</p>}
      </div>
    </Modal>
  );

  return (
    <div className="flex flex-col gap-4">
      <SearchInput value={query} onChange={setQuery} placeholder="Search connectors…" />

      <div className="flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              filter === f.id
                ? 'border border-border-default bg-surface-2 font-medium text-text-primary'
                : 'border border-transparent text-text-secondary hover:bg-surface-2'
            }`}
          >
            {f.label}
            {f.id === 'connected' && connectedCount > 0 && (
              <span className="ml-1.5 text-xs text-text-muted">{connectedCount}</span>
            )}
          </button>
        ))}
      </div>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      ) : (
        <div className="border-t border-border-subtle pt-2">
          {results.length === 0 && custom.length === 0 && (
            <p className="py-8 text-center text-sm text-text-muted">
              {query
                ? `Nothing matches “${query}”.`
                : filter === 'connected'
                  ? 'Nothing connected yet.'
                  : 'Everything is connected.'}
            </p>
          )}

          <ul className="divide-y divide-border-subtle">
            {results.map((e) => {
              const connected = byName.get(e.id) ?? null;
              const status = connected ? statusOf(connected) : null;
              const showInfo = info === e.id;
              return (
                <li key={e.id} className="py-1">
                  <div className="-mx-3 flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-2">
                    {/* The note IS the connector, so a connected row goes to
                        its page. An unconnected one has no note yet — it opens
                        the recipe's form instead. */}
                    <button
                      onClick={() => (connected ? openConnector(connected.name) : setEntry(e))}
                      className="flex min-w-0 flex-1 items-center gap-4 text-left"
                    >
                      <ConnectorLogo entry={e} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-text-primary">{e.name}</p>
                        {status && (
                          <p className={`truncate text-[13px] ${statusColor(status.tone)}`}>
                            {status.detail}
                          </p>
                        )}
                      </div>
                    </button>
                    {/* Only where there is nothing to manage yet: for a
                        connected row, Manage is where the detail lives. */}
                    {!connected && (
                      <button
                        onClick={() => setInfo(showInfo ? null : e.id)}
                        aria-label={`About ${e.name}`}
                        aria-expanded={showInfo}
                        className={`rounded-lg p-1.5 transition-colors hover:bg-surface-3 hover:text-text-primary ${showInfo ? 'text-text-primary' : 'text-text-muted'}`}
                      >
                        <InfoIcon className="h-4 w-4" />
                      </button>
                    )}
                    {status && (
                      <span className={`shrink-0 ${TONE_CHIP} ${TONE_CLASSES[status.tone]}`}>{status.label}</span>
                    )}
                    {rowActions(connected, () => setEntry(e), e.description)}
                  </div>
                  {showInfo && (
                    <div className="mb-2 ml-14 rounded-lg bg-surface-2 px-4 py-3 text-[13px] text-text-secondary">
                      <p className="font-medium text-text-primary">{e.description}</p>
                      <p className="mt-1">
                        Reaches {e.hosts.length > 0 ? e.hosts.join(', ') : 'the host you give it'}.{' '}
                        {e.shape === 'model'
                          ? 'A model provider this space’s agents run on — never runnable, and no note or agent can read the key.'
                          : e.shape === 'oauth'
                            ? 'Each person connects their own account; Visvine holds the tokens and sends them on every call.'
                            : `Needs ${e.fields.map((f) => f.label.toLowerCase()).join(', ')}, stored as write-only secrets.`}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}

            {custom.map((c) => {
              const status = statusOf(c);
              return (
                <li key={c.path} className="py-1">
                  <div className="-mx-3 flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-2">
                    <button
                      onClick={() => openConnector(c.name)}
                      className="flex min-w-0 flex-1 items-center gap-4 text-left"
                    >
                      <ConnectorLogo name={c.name} provider={c.model?.provider} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <p className="truncate text-sm font-semibold text-text-primary">{c.name}</p>
                          <p className="truncate font-mono text-[11px] text-text-muted">{c.alias ?? 'no alias'}</p>
                        </div>
                        <p className="truncate text-[13px] text-text-muted">
                          {status ? (
                            <span className={statusColor(status.tone)}>{status.detail}</span>
                          ) : (
                            c.description ??
                            (c.kind === 'model'
                              ? `${c.model?.providerLabel ?? 'Model'} provider`
                              : c.hosts.join(', '))
                          )}
                        </p>
                      </div>
                    </button>
                    {status && (
                      <span className={`shrink-0 ${TONE_CHIP} ${TONE_CLASSES[status.tone]}`}>{status.label}</span>
                    )}
                    {rowActions(c, () => undefined)}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* The service that isn't on the list: a connector is only ever a
              note, so a custom one is written on the draft surface. */}
          <div className="flex items-center justify-between gap-4 border-t border-border-subtle pt-4 mt-2">
            <p className="text-xs text-text-muted">Something not on the list? Write its note yourself.</p>
            <Button variant="neutral" size="sm" onClick={() => openCreate('connector')}>
              Custom connector
            </Button>
          </div>
        </div>
      )}

      {managed && managePanel(managed, manage?.about)}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete ${confirmDelete?.name ?? 'connector'}?`}
        body="Removes the connector note. Its stored secrets stay in the space until an admin deletes them."
        confirmLabel="Delete"
        destructive
        error={deleteError}
        onConfirm={remove}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
}

/** Connect: the recipe's fields, written as a note plus its secrets. */
function EntryForm({
  entry,
  spaceId,
  onBack,
  onCreated,
}: {
  entry: CatalogEntry;
  spaceId: string | null;
  onBack: () => void;
  onCreated: (href: string) => void;
}) {
  const [title, setTitle] = useState(entry.name);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = connectorSlug(title) || entry.id;
  const missing = entry.fields.filter((f) => f.required && !(values[f.key] ?? '').trim());
  const ready = !!spaceId && !!connectorSlug(title) && missing.length === 0;

  const submit = async () => {
    if (!ready || !spaceId) return;
    setSaving(true);
    setError(null);
    try {
      const { content, secrets } = connectorFromCatalog(entry, { name, title, description: '', values });
      const path = `connectors/${name}.md`;
      await notesApi.create(spaceId, path, content);
      for (const secret of secrets) {
        await fetchJson(`/api/communities/${encodeURIComponent(spaceId)}/secrets`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(secret),
        });
      }
      invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId), contextKeys.read(spaceId, path));
      onCreated(`/directory/${encodeURIComponent(`connector:${name}`)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the connector');
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

      <Field label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={64} />
      </Field>

      {entry.fields.map((f) => (
        <Field
          key={f.key}
          label={
            <>
              {f.label}
              {f.required && <span className="text-red-500"> *</span>}
            </>
          }
        >
          <Input
            type={f.secret ? 'password' : 'text'}
            autoComplete="off"
            placeholder={f.placeholder}
            value={values[f.key] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            className={f.secret ? 'font-mono' : undefined}
          />
        </Field>
      ))}

      {error && <p className="border-l-2 border-red-500 py-1 pl-3 text-sm text-red-500">{error}</p>}

      <div className="flex items-center justify-end gap-2 border-t border-border-subtle pt-4">
        <Button variant="neutral" onClick={onBack} disabled={saving}>Cancel</Button>
        <Button variant="brand" onClick={submit} disabled={!ready || saving}>
          {saving ? 'Saving…' : 'Save connector'}
        </Button>
      </div>
    </div>
  );
}
