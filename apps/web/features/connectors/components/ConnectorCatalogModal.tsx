'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal, Button, ConfirmDialog, Field, Input, SearchInput } from '@/components/ui';
import { ArrowLeftIcon, CircleCheckIcon, InfoIcon, XIcon } from '@/features/shared/icons';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { useConnectorCatalog } from '@/features/shared/contexts/CreateModalContext';
import { notesApi } from '@/features/notes/lib/notesApi';
import { contextKeys, invalidateContextCache } from '@/features/notes/lib/contextPrefetch';
import { fetchJson } from '@/lib/fetchJson';
import { connectorSlug } from '@/lib/create/noteSlug';
import {
  CONNECTOR_CATALOG,
  connectorFromCatalog,
  searchCatalog,
  type CatalogEntry,
} from '@/lib/connectors/catalog';

/**
 * Connectors: one searchable list of services — connected ones carry a
 * Manage (edit / delete), the rest a Connect that opens a short form.
 *
 * Picking Granola and pasting its key writes connectors/granola.md — the
 * same note an admin could have written by hand — and stores the key as a
 * secret. Nothing about the permission model moves: the note is admin-only
 * to write, secrets are write-only, and `connectors:use` still gates who
 * may run it. A custom service is still written on the draft surface.
 */

function Logo({ entry, size = 'md' }: { entry: CatalogEntry; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-12 w-12 rounded-xl' : 'h-10 w-10 rounded-lg';
  const glyph = size === 'lg' ? 'h-6 w-6' : 'h-5 w-5';
  return (
    <div className={`${box} flex shrink-0 items-center justify-center bg-surface-2`}>
      <img src={`/images/connectors/${entry.logo}`} alt="" className={`${glyph} object-contain`} />
    </div>
  );
}

type Filter = 'all' | 'connected' | 'not-connected';

/** What the space already has, by note name — the connector list the admin page reads. */
interface ExistingConnector {
  name: string;
  path: string;
  invalid: string | null;
  missingSecrets: string[];
}

export default function ConnectorCatalogModal() {
  const { isOpen, close } = useConnectorCatalog();
  const router = useRouter();
  const { currentSpace } = useSpace();
  const spaceId = currentSpace?.id ?? null;

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [existing, setExisting] = useState<ExistingConnector[]>([]);
  const [manage, setManage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CatalogEntry | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Reload what's connected each time the modal opens (and after a delete).
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setFilter('all');
    setEntry(null);
    setInfo(null);
    setManage(null);
  }, [isOpen]);
  useEffect(() => {
    if (!isOpen || !spaceId) return;
    let cancelled = false;
    fetchJson<{ connectors: ExistingConnector[] }>(`/api/communities/${encodeURIComponent(spaceId)}/connectors`)
      .then((data) => { if (!cancelled) setExisting(data.connectors); })
      .catch(() => { if (!cancelled) setExisting([]); });
    return () => { cancelled = true; };
  }, [isOpen, spaceId, reloadKey]);

  const byName = useMemo(() => new Map(existing.map((e) => [e.name, e])), [existing]);
  const connectedOf = (e: CatalogEntry) => byName.get(e.id) ?? null;

  const results = useMemo(() => {
    const all = searchCatalog(query);
    if (filter === 'all') return all;
    return all.filter((e) => (byName.has(e.id) ? filter === 'connected' : filter === 'not-connected'));
  }, [query, filter, byName]);
  const connectedCount = CONNECTOR_CATALOG.filter((e) => byName.has(e.id)).length;

  const remove = async () => {
    if (!confirmDelete || !spaceId) return;
    const target = connectedOf(confirmDelete);
    if (!target) return;
    setDeleteError(null);
    try {
      await notesApi.remove(spaceId, target.path);
      invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId), contextKeys.read(spaceId, target.path));
      setConfirmDelete(null);
      setManage(null);
      setReloadKey((k) => k + 1);
      router.refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete the connector');
    }
  };

  if (entry) {
    return (
      <EntryForm
        entry={entry}
        spaceId={spaceId}
        onBack={() => setEntry(null)}
        onClose={close}
        onCreated={(href) => {
          close();
          router.push(href);
        }}
      />
    );
  }

  const FILTERS: Array<{ id: Filter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'connected', label: 'Connected' },
    { id: 'not-connected', label: 'Not connected' },
  ];

  return (
    <>
      <Modal open={isOpen} onClose={close} size="md" ariaLabel="Add connector" panelClassName="bg-surface-1 rounded-xl shadow-float flex flex-col h-[min(80vh,44rem)]">
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <h2 className="text-base font-semibold text-text-primary">Connectors</h2>
          <button onClick={close} aria-label="Close" className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary">
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col gap-3 px-6 pb-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Search connectors…" autoFocus />
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
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border-subtle px-6 py-2">
          {results.length === 0 && (
            <p className="py-8 text-center text-sm text-text-muted">
              {query ? `Nothing matches “${query}”.` : filter === 'connected' ? 'Nothing connected yet.' : 'Everything is connected.'}
            </p>
          )}
          <ul className="divide-y divide-border-subtle">
            {results.map((e) => {
              const connected = connectedOf(e);
              const showInfo = info === e.id;
              const showManage = manage === e.id;
              return (
                <li key={e.id} className="py-1">
                  <div className="-mx-3 flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-2">
                    <button
                      onClick={() => (connected ? setManage(showManage ? null : e.id) : setEntry(e))}
                      className="flex min-w-0 flex-1 items-center gap-4 text-left"
                    >
                      <Logo entry={e} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-text-primary">{e.name}</p>
                      </div>
                    </button>
                    <button
                      onClick={() => setInfo(showInfo ? null : e.id)}
                      aria-label={`About ${e.name}`}
                      aria-expanded={showInfo}
                      className={`rounded-lg p-1.5 transition-colors hover:bg-surface-3 hover:text-text-primary ${showInfo ? 'text-text-primary' : 'text-text-muted'}`}
                    >
                      <InfoIcon className="h-4 w-4" />
                    </button>
                    {connected ? (
                      <>
                        <CircleCheckIcon className="h-4 w-4 shrink-0 text-brand-dark-green" aria-label="Connected" />
                        <Button variant="neutral" size="sm" onClick={() => setManage(showManage ? null : e.id)}>
                          Manage
                        </Button>
                      </>
                    ) : (
                      <Button variant="brand" size="sm" onClick={() => setEntry(e)}>
                        Connect
                      </Button>
                    )}
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
                      {connected && (connected.invalid || connected.missingSecrets.length > 0) && (
                        <p className="mt-1 text-amber-700">
                          {connected.invalid ? `Not working: ${connected.invalid}` : `Missing secrets: ${connected.missingSecrets.join(', ')}`}
                        </p>
                      )}
                    </div>
                  )}
                  {showManage && connected && (
                    <div className="mb-2 ml-14 flex items-center gap-2">
                      <Button
                        variant="neutral"
                        size="sm"
                        onClick={() => {
                          close();
                          router.push(`/directory/${encodeURIComponent(`connector:${connected.name}`)}`);
                        }}
                      >
                        Edit
                      </Button>
                      <Button variant="danger-text" size="sm" onClick={() => { setDeleteError(null); setConfirmDelete(e); }}>
                        Delete
                      </Button>
                      <span className="text-xs text-text-muted">{connected.path}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </Modal>

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
    </>
  );
}

function EntryForm({
  entry,
  spaceId,
  onBack,
  onClose,
  onCreated,
}: {
  entry: CatalogEntry;
  spaceId: string | null;
  onBack: () => void;
  onClose: () => void;
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
    <Modal
      open
      onClose={onClose}
      size="md"
      ariaLabel={`Add ${entry.name}`}
      footer={
        <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-6 py-4">
          <Button variant="neutral" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="brand" onClick={submit} disabled={!ready || saving}>
            {saving ? 'Saving…' : 'Save connector'}
          </Button>
        </div>
      }
    >
      <div className="flex items-start gap-4 px-6 pt-6 pb-4">
        <button onClick={onBack} aria-label="Back" className="mt-1 rounded-lg p-1 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary">
          <ArrowLeftIcon className="h-5 w-5" />
        </button>
        <Logo entry={entry} size="lg" />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-text-primary">{entry.name}</h2>
          <p className="text-sm text-text-muted">{entry.description}</p>
        </div>
      </div>

      <div className="flex flex-col gap-5 overflow-y-auto px-6 pb-6">
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
      </div>
    </Modal>
  );
}
