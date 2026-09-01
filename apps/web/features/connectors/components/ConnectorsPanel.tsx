'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ConfirmDialog, Field, Input, Modal, SearchInput, Skeleton, Alert } from '@/components/ui';
import { ArrowLeftIcon, InfoIcon, Trash2Icon } from '@/features/shared/icons';
import ConnectorLogo from './ConnectorLogo';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { useCreateSurface } from '@/features/shared/contexts/CreateModalContext';
import { notesApi } from '@/features/notes/lib/notesApi';
import { contextKeys, invalidateContextCache } from '@/features/notes/lib/contextPrefetch';
import { fetchJson } from '@/lib/fetchJson';
import { connectorSlug } from '@/lib/create/noteSlug';
import { connectorConnectUrl } from '@/lib/connectors/connectUrl';
import { TONE_CHIP, TONE_CLASSES } from '@/features/shared/lib/statusTone';
import {
  allowsManyConnectors,
  catalogEntryFor,
  connectorFromCatalog,
  searchCatalog,
  suggestConnector,
  type CatalogEntry,
} from '@/lib/connectors/catalog';

/**
 * Connectors, as a console section: what this space has, and the services it
 * can add another from.
 *
 * The distinction the whole surface turns on is that a SERVICE is not a slot.
 * A space may have two Google Drives — yours and the team's — or two Slack
 * workspaces, and each is its own note, its own credentials, its own on/off
 * switch. So the catalog row never becomes "connected": it offers Connect, and
 * then Add another, however many the space holds. What the space has is the
 * other tab, one row per connector rather than per service, because that is the
 * only list where two Drives are two things.
 *
 * There is no separate "add" surface. Picking Granola and pasting its key
 * writes connectors/granola.md — the same note an admin could have written by
 * hand — and stores the key as a secret. Nothing about the permission model
 * moves: the note is admin-only to write, secrets are write-only, and
 * `connectors:use` still gates who may run it.
 *
 * A row goes to the connector's own page — the note is the connector, so that
 * page is where it is read and edited. Manage is the other half: it opens what
 * the space has (which service, what it reaches, which secrets, where the note
 * is) with the acts that belong to a list rather than a page — disable, edit,
 * delete.
 *
 * A connector the space wrote itself is a row here too, under a plug rather
 * than a logo: it is the same `connectors/<name>.md`, it just has no recipe
 * behind it. Writing one is still the draft surface's job — this section
 * lists and connects, it does not author prose.
 */

/**
 * The list is one of two halves, and they are different KINDS of row rather
 * than one list filtered two ways.
 *
 * "In this space" lists CONNECTORS — the notes the space actually has, one row
 * each. "Add a connector" lists SERVICES — the recipes, every one of them,
 * always addable. That split is what lets a space hold two Drives: a service is
 * not a slot that fills up, so its row never stops offering another, and the
 * second Drive is a row of its own on the other tab rather than a state the
 * Drive row is in. (A model provider is the exception — one key per space, so
 * its row offers Manage once it is connected: `allowsManyConnectors`.)
 */
type Tab = 'mine' | 'catalog';

/** What the space already has, by note name — one row of GET …/connectors. */
interface ExistingConnector {
  name: string;
  path: string;
  /** Frontmatter `title` — what it is called where two connectors share a service. */
  title: string | null;
  /** Frontmatter `recipe` — which catalog service it is to, where it says. */
  recipe: string | null;
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
function statusOf(connector: ExistingConnector): { label: string; tone: Tone } | null {
  // Off comes first: a connector nobody can run has no interesting second
  // opinion about its secrets.
  if (!connector.enabled) return { label: 'Off', tone: 'muted' };
  if (connector.invalid) return { label: 'Invalid', tone: 'bad' };
  if (connector.missingSecrets.length > 0) return { label: 'Missing secrets', tone: 'warn' };
  if (connector.warnings.length > 0) return { label: 'Needs migration', tone: 'warn' };
  if (connector.kind !== 'model' && connector.hosts.length === 0) return { label: 'No network', tone: 'warn' };
  return null;
}

/** One row of GET …/connectors/<name>/connections, as Manage shows it. */
interface ManageConnectionRow {
  actsAs: string | null;
  isMine: boolean;
  isShared: boolean;
  broken: { at: string; reason: string | null } | null;
}

/**
 * The caller's own connection status inside Manage, for a connector with an
 * `auth:` block — connected as whom, or the Connect link. Fetched only when the
 * dialog opens (one request per open, never per row), and silent for a
 * connector without OAuth: the endpoint 404s and this renders nothing.
 */
function ManageConnections({ spaceId, name }: { spaceId: string; name: string }) {
  const [state, setState] = useState<{ mode: 'user' | 'space'; rows: ManageConnectionRow[] } | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ mode: 'user' | 'space'; connections: ManageConnectionRow[] }>(
      `/api/communities/${spaceId}/connectors/${encodeURIComponent(name)}/connections`,
    )
      .then((data) => { if (!cancelled) setState({ mode: data.mode, rows: data.connections }); })
      .catch(() => { if (!cancelled) setState(null); });
    return () => { cancelled = true; };
  }, [spaceId, name]);

  if (!state) return null;
  const mine = state.mode === 'space' ? state.rows.find((r) => r.isShared) : state.rows.find((r) => r.isMine);
  const whose = state.mode === 'space' ? 'Space account' : 'Your account';
  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-text-muted">{whose}:</span>
      {mine ? (
        <span>
          connected as <span className="font-mono text-xs">{mine.actsAs ?? 'unknown account'}</span>
        </span>
      ) : (
        <span className="text-text-muted">not connected</span>
      )}
      {mine?.broken && (
        <span className="text-red-600">stopped working{mine.broken.reason ? ` — ${mine.broken.reason}` : ''}</span>
      )}
      <a href={connectorConnectUrl(spaceId, name)} className="font-medium text-text-primary underline underline-offset-2">
        {mine ? 'Reconnect' : 'Connect'}
      </a>
    </div>
  );
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'mine', label: 'In this space' },
  { id: 'catalog', label: 'Add a connector' },
];

export default function ConnectorsPanel() {
  const router = useRouter();
  const { currentSpace } = useSpace();
  const openCreate = useCreateSurface();
  const spaceId = currentSpace?.id ?? null;

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('mine');
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
        // What the space has is the question an admin usually has, but a space
        // with nothing connected would open on an empty list — so land on the
        // catalog instead. Once per space: a later reload (a delete, a toggle)
        // must not move the tab out from under whoever chose it.
        if (landedRef.current !== spaceId) {
          landedRef.current = spaceId;
          setTab(data.connectors.length > 0 ? 'mine' : 'catalog');
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

  /** The service a connector is to, where it came from a recipe. */
  const serviceOf = (c: ExistingConnector) => catalogEntryFor(c.name, c.model?.provider, c.recipe);

  // What the space has, per service — the count a catalog row reports, and how
  // the second Drive is known to be a Drive at all.
  const held = useMemo(() => {
    const map = new Map<string, ExistingConnector[]>();
    for (const c of existing) {
      const service = catalogEntryFor(c.name, c.model?.provider, c.recipe);
      if (!service) continue;
      const rows = map.get(service.id);
      if (rows) rows.push(c);
      else map.set(service.id, [c]);
    }
    return map;
  }, [existing]);

  const takenNames = useMemo(() => existing.map((c) => c.name), [existing]);

  // A connector matches on what a reader would type: its own name or title, or
  // the service it is to.
  const mine = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return existing;
    return existing.filter((c) => {
      const service = catalogEntryFor(c.name, c.model?.provider, c.recipe);
      return (
        c.name.toLowerCase().includes(q) ||
        (c.title ?? '').toLowerCase().includes(q) ||
        (c.alias ?? '').toLowerCase().includes(q) ||
        (service?.name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [existing, query]);

  const services = useMemo(() => searchCatalog(query), [query]);

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
        taken={takenNames}
        onBack={() => setEntry(null)}
        onCreated={(href) => router.push(href)}
      />
    );
  }

  const openManage = (connector: ExistingConnector, about: string | null = null) => {
    setToggleError(null);
    setManage({ name: connector.name, about });
  };

  // What Manage opens: what the space actually has — which service it is to,
  // what it reaches, which secrets it names, where the note is — and the three
  // acts a connector's row offers: disable it, edit it, delete it. A dialog and
  // not a row expander: these are the space's keys to somebody else's system,
  // so the question gets the screen. Edit is a door rather than an act — the
  // note IS the connector, so it hands over to the connector's own page, the
  // same place the row goes.
  const managed = manage ? existing.find((c) => c.name === manage.name) ?? null : null;

  const managePanel = (connected: ExistingConnector, about?: string | null) => {
    const service = serviceOf(connected);
    const siblings = service ? held.get(service.id) ?? [] : [];
    return (
    <Modal
      open
      size="sm"
      title={connected.title ?? connected.name}
      onClose={() => setManage(null)}
      footer={
        <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-5 py-3">
          <Button
            variant="danger"
            size="sm"
            className="inline-flex items-center gap-2"
            onClick={() => { setDeleteError(null); setConfirmDelete(connected); }}
          >
            <Trash2Icon className="h-4 w-4" />
            Delete
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="neutral"
              size="sm"
              disabled={toggling === connected.name}
              onClick={() => setEnabled(connected, !connected.enabled)}
            >
              {toggling === connected.name ? 'Saving…' : connected.enabled ? 'Disable' : 'Enable'}
            </Button>
            <Button variant="neutral" size="sm" onClick={() => { setManage(null); openConnector(connected.name); }}>
              Edit
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
          {/* Which service, and how many of it the space has. The count is the
              line that makes two Drives legible: a name alone leaves a reader
              guessing whether google-drive-2 is a mistake. */}
          <dt className="text-text-muted">Service</dt>
          <dd className="min-w-0 break-words">
            {service ? service.name : 'Written in this space'}
            {siblings.length > 1 && (
              <span className="text-text-muted">
                {' '}· one of {siblings.length} in this space
              </span>
            )}
          </dd>
          <dt className="text-text-muted">Called</dt>
          <dd className="min-w-0 break-words font-mono text-xs">{connected.name}</dd>
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
        {/* Two model connectors to one provider would name the same key and the
            same endpoint, so the dialog says where the key really lives rather
            than leaving an admin to discover it by adding a second. */}
        {connected.kind === 'model' && (
          <p className="mt-2">
            The key is the space’s, one per provider — every {service?.name ?? 'provider'} agent
            uses it. Replace it on this connector’s page.
          </p>
        )}
        {connected.kind !== 'model' && spaceId && (
          <ManageConnections spaceId={spaceId} name={connected.name} />
        )}
        {connected.invalid && <p className="mt-2 text-red-600">Not working: {connected.invalid}</p>}
        {!connected.enabled && (
          <p className="mt-2">
            Disabled. The note and its secrets are untouched — every run is refused until it is
            switched back on.
          </p>
        )}
        {toggleError && <p className="mt-2 text-red-600">{toggleError}</p>}
      </div>
    </Modal>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={tab === 'mine' ? 'Search this space’s connectors…' : 'Search services…'}
      />

      <div className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              tab === t.id
                ? 'border border-border-default bg-surface-2 font-medium text-text-primary'
                : 'border border-transparent text-text-secondary hover:bg-surface-2'
            }`}
          >
            {t.label}
            {t.id === 'mine' && existing.length > 0 && (
              <span className="ml-1.5 text-xs text-text-muted">{existing.length}</span>
            )}
          </button>
        ))}
      </div>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      ) : tab === 'mine' ? (
        <div className="border-t border-border-subtle pt-2">
          {mine.length === 0 && (
            <p className="py-8 text-center text-sm text-text-muted">
              {query ? `Nothing matches “${query}”.` : 'Nothing connected yet.'}
            </p>
          )}

          {/* One row per CONNECTOR, not per service: two Drives are two rows,
              each with its own key, its own on/off and its own note. */}
          <ul className="divide-y divide-border-subtle">
            {mine.map((c) => {
              const status = statusOf(c);
              const service = serviceOf(c);
              return (
                <li key={c.path} className="py-1">
                  <div className="-mx-3 flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-2">
                    <button
                      onClick={() => openConnector(c.name)}
                      className="flex min-w-0 flex-1 items-center gap-4 text-left"
                    >
                      <ConnectorLogo name={c.name} provider={c.model?.provider} recipe={c.recipe} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-text-primary">
                          {c.title ?? c.name}
                        </p>
                        {/* The service it is to, and the name agents call it by
                            — the two things that tell one Drive from another. */}
                        <p className="truncate text-xs text-text-muted">
                          {service ? `${service.name} · ${c.name}` : c.name}
                        </p>
                      </div>
                    </button>
                    {status && (
                      <span className={`shrink-0 ${TONE_CHIP} ${TONE_CLASSES[status.tone]}`}>{status.label}</span>
                    )}
                    <Button variant="neutral" size="sm" aria-haspopup="dialog" onClick={() => openManage(c)}>
                      Manage
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center justify-between gap-4 border-t border-border-subtle pt-4 mt-2">
            <p className="text-xs text-text-muted">Connect another service, or write one yourself.</p>
            <Button variant="neutral" size="sm" onClick={() => { setQuery(''); setTab('catalog'); }}>
              Add a connector
            </Button>
          </div>
        </div>
      ) : (
        <div className="border-t border-border-subtle pt-2">
          {services.length === 0 && (
            <p className="py-8 text-center text-sm text-text-muted">Nothing matches “{query}”.</p>
          )}

          {/* One row per SERVICE, and it never fills up: a service the space
              already reaches still offers another, because a second connector
              is a second set of credentials (the team's Drive beside yours),
              not a duplicate. The exception is a model provider — one key per
              space — whose row hands over to the one it has. */}
          <ul className="divide-y divide-border-subtle">
            {services.map((e) => {
              const rows = held.get(e.id) ?? [];
              const many = allowsManyConnectors(e);
              const showInfo = info === e.id;
              return (
                <li key={e.id} className="py-1">
                  <div className="-mx-3 flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-2">
                    <button
                      onClick={() => (many || rows.length === 0 ? setEntry(e) : openManage(rows[0], e.description))}
                      className="flex min-w-0 flex-1 items-center gap-4 text-left"
                    >
                      <ConnectorLogo entry={e} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-text-primary">{e.name}</p>
                        <p className="truncate text-xs text-text-muted">{e.description}</p>
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
                    {rows.length > 0 && (
                      <span className="shrink-0 text-xs text-text-muted">
                        {rows.length === 1 ? '1 connected' : `${rows.length} connected`}
                      </span>
                    )}
                    {rows.length === 0 ? (
                      <Button variant="brand" size="sm" onClick={() => setEntry(e)}>
                        Connect
                      </Button>
                    ) : many ? (
                      <Button variant="neutral" size="sm" onClick={() => setEntry(e)}>
                        Add another
                      </Button>
                    ) : (
                      <Button
                        variant="neutral"
                        size="sm"
                        aria-haspopup="dialog"
                        onClick={() => openManage(rows[0], e.description)}
                      >
                        Manage
                      </Button>
                    )}
                  </div>
                  {showInfo && (
                    <div className="mb-2 ml-14 rounded-lg bg-surface-2 px-4 py-3 text-[13px] text-text-secondary">
                      <p className="font-medium text-text-primary">{e.description}</p>
                      <p className="mt-1">
                        Reaches {e.hosts.length > 0 ? e.hosts.join(', ') : 'the host you give it'}.{' '}
                        {e.shape === 'model'
                          ? 'A model provider this space’s agents run on — never runnable, and no note or agent can read the key. One per space: the key is the space’s own, so a second connector would name the same key and the same endpoint.'
                          : e.shape === 'oauth'
                            ? 'Each person connects their own account; Visvine holds the tokens and sends them on every call. Connect it as many times as the space has accounts to reach — each is its own connector.'
                            : `Needs ${e.fields.map((f) => f.label.toLowerCase()).join(', ')}, stored as write-only secrets. Connect it once per set of credentials.`}
                      </p>
                    </div>
                  )}
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
        title={`Delete ${confirmDelete?.title ?? confirmDelete?.name ?? 'connector'}?`}
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

/**
 * Connect: the recipe's fields, written as a note plus its secrets.
 *
 * The title is what separates a second connector to a service from the first —
 * it is the note's name once slugged, and the name is what agents call. So the
 * form opens on a free one ("Google Drive 2" where a Drive is already
 * connected), and a title that would land on a note the space already has is
 * refused here rather than at the write.
 */
function EntryForm({
  entry,
  spaceId,
  taken,
  onBack,
  onCreated,
}: {
  entry: CatalogEntry;
  spaceId: string | null;
  /** Connector names the space already uses — the new note may not be one of them. */
  taken: string[];
  onBack: () => void;
  onCreated: (href: string) => void;
}) {
  const suggestion = useMemo(() => suggestConnector(entry, taken), [entry, taken]);
  const [title, setTitle] = useState(suggestion.title);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = connectorSlug(title) || entry.id;
  const clash = taken.some((n) => n.toLowerCase() === name.toLowerCase());
  const nth = taken.length > 0 && suggestion.name !== entry.id;
  const missing = entry.fields.filter((f) => f.required && !(values[f.key] ?? '').trim());
  const ready = !!spaceId && !!connectorSlug(title) && !clash && missing.length === 0;

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
          <p className="text-sm text-text-muted">
            {nth
              ? `Another ${entry.name} connector — its own credentials, its own note.`
              : entry.description}
          </p>
        </div>
      </div>

      <Field
        label="Title"
        error={clash ? `This space already has a connector called ${name} — give this one a different title.` : undefined}
        hint={`Saved as connectors/${name}.md; agents call it ${name}.`}
      >
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
