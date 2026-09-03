'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button, ConfirmDialog, Field, Input, SearchInput, Skeleton, Alert } from '@/components/ui';
import Select from '@/components/ui/Select';
import { ArrowLeftIcon, Trash2Icon } from '@/features/shared/icons';
import ConnectorLogo from './ConnectorLogo';
import ConnectorToolPermissions from './ConnectorToolPermissions';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { useCreateSurface } from '@/features/shared/contexts/CreateModalContext';
import { notesApi } from '@/features/notes/lib/notesApi';
import { contextKeys, invalidateContextCache } from '@/features/notes/lib/contextPrefetch';
import { fetchJson } from '@/lib/fetchJson';
import { connectorSlug } from '@/lib/create/noteSlug';
import { connectorConnectPath } from '@/lib/connectors/connectUrl';
import { TONE_CHIP, TONE_CLASSES } from '@/features/shared/lib/statusTone';
import {
  allowsManyConnectors,
  catalogConnectStyle,
  catalogEntryFor,
  catalogForScope,
  catalogRowLabel,
  connectorFromCatalog,
  connectsInOneClick,
  plainFields,
  searchCatalog,
  suggestConnector,
  type CatalogEntry,
  type ConnectorScope,
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
 *
 * The same panel serves the account menu's dialog, where a MEMBER may open
 * it on the space they are in. The list route says whether they can manage
 * (`canManage`), and when they cannot the panel is the list alone: no
 * catalog, no Manage, no Models +; a row goes to the connector's page, and
 * the one act left is signing in to their own account behind a connector
 * that needs one.
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
  /** Set for `kind: model` — the provider the note names and the model it runs. */
  model: { provider: string; providerLabel: string; modelId: string | null } | null;
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
  /**
   * The MCP server this connector IS, when its note declares one. Reported by
   * the server rather than inferred from the recipe, because it decides
   * whether a permissions screen appears — and `recipe:` is display metadata
   * that may be absent on a note written by hand.
   */
  mcp: { url: string } | null;
  /**
   * The linked account behind an OAuth connector, when there is one — null both
   * for a connector that uses no OAuth and for one whose sign-in was never
   * finished. What tells a connected Drive from a note left behind by an
   * abandoned dance.
   */
  connection: { actsAs: string | null; broken: boolean } | null;
}

type Tone = 'ok' | 'warn' | 'bad' | 'muted';

/**
 * Does this connector hold an account somebody signs in to, per its recipe?
 */
function signsIn(connector: ExistingConnector): boolean {
  const shape = catalogEntryFor(connector.name, connector.model?.provider, connector.recipe)?.shape;
  return shape === 'oauth' || shape === 'mcp';
}

/**
 * Is this connector something Connected should claim?
 *
 * In your own settings a connector is your ACCOUNT at a service, so one with
 * no account linked is not connected — it is a note left behind by a sign-in
 * nobody finished (the note is written before the browser leaves for the
 * provider, because the OAuth start route reads the perimeter out of it). It
 * stays reachable on Available, whose row says "Not signed in" and offers Sign
 * in, which picks that same note back up.
 *
 * A space's console is the other way round: there a connector is configuration
 * the space made and each member connects their own account afterwards, so a
 * note with no connection is what a correctly configured connector looks like.
 */
function isConnected(connector: ExistingConnector, scope: ConnectorScope): boolean {
  if (scope !== 'personal') return true;
  return !signsIn(connector) || connector.connection !== null;
}

/**
 * A connected connector's verdict, in the order the failures actually bite: a
 * note that doesn't parse is refused before anything else is consulted, a
 * missing secret before the request is built, and an empty allowlist before it
 * is sent. A healthy connector says nothing — the chip flags the ways one
 * fails, it doesn't congratulate the working ones.
 */
function statusOf(connector: ExistingConnector, scope: ConnectorScope): { label: string; tone: Tone } | null {
  // Off comes first: a connector nobody can run has no interesting second
  // opinion about its secrets.
  if (!connector.enabled) return { label: 'Off', tone: 'muted' };
  if (connector.invalid) return { label: 'Invalid', tone: 'bad' };
  if (connector.missingSecrets.length > 0) return { label: 'Missing secrets', tone: 'warn' };
  if (connector.warnings.length > 0) return { label: 'Needs migration', tone: 'warn' };
  if (connector.kind !== 'model' && connector.hosts.length === 0) return { label: 'No network', tone: 'warn' };
  // Your own connectors are accounts you signed in to, so an OAuth note with no
  // account behind it is unfinished rather than configured — the state an
  // abandoned dance leaves. A space's are not said the same way: there the
  // account is per member, and the row is about what the space has.
  if (scope === 'personal' && signsIn(connector)) {
    if (connector.connection?.broken) return { label: 'Reconnect', tone: 'bad' };
    if (!connector.connection) return { label: 'Not signed in', tone: 'warn' };
  }
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
 * The caller's own connection status on a connector's page, for one with an
 * `auth:` block — connected as whom, or the Connect link. Fetched only when
 * that page opens (one request per open, never per row), and silent for a
 * connector without OAuth: the endpoint 404s and this renders nothing.
 */
function ManageConnections({ spaceId, name, returnTo }: { spaceId: string; name: string; returnTo: string | null }) {
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
      <a href={connectorConnectPath(spaceId, name, returnTo)} className="font-medium text-text-primary underline underline-offset-2">
        {mine ? 'Reconnect' : 'Connect'}
      </a>
    </div>
  );
}

// A row's action is a column, not a label: Connect, Sign in, Add another and
// Manage all sit in the same slot, so a list of rows offering different things
// still reads down one edge.
const ACTION_SLOT = 'w-28 shrink-0 text-center';

const TABS: Record<'space' | 'personal', Array<{ id: Tab; label: string }>> = {
  space: [
    { id: 'mine', label: 'In this space' },
    { id: 'catalog', label: 'Add a connector' },
  ],
  personal: [
    { id: 'mine', label: 'Connected' },
    { id: 'catalog', label: 'Available' },
  ],
};

/**
 * Whose connectors these are.
 *
 * `space` is the console: the space's own connectors, shared with everyone in
 * it, and the row goes to the connector's page in that space's directory.
 * `personal` is Settings: the same machinery pointed at your personal space,
 * which is a full space you are the only member and the admin of — so nothing
 * about notes, secrets or the OAuth dance is special-cased for it. What differs
 * is where a row can lead: your personal space is not the space the app is
 * currently showing, so a row opens Manage rather than navigating to a
 * directory page that isn't there — and WHAT is offered: the vetted MCP
 * servers, one account each, and none of the credential-shaped services a
 * space configures for its team.
 */
export type { ConnectorScope };

export default function ConnectorsPanel({
  space,
  scope = 'space',
  returnTo = null,
  onLeave,
}: {
  /** The space to work in; defaults to the one the app is showing. */
  space?: string | null;
  scope?: ConnectorScope;
  /** Where the OAuth round trip lands — this surface, not the connector page. */
  returnTo?: string | null;
  /** Called just before the panel sends the browser to another page — a dialog closes on it. */
  onLeave?: () => void;
} = {}) {
  const router = useRouter();
  const { currentSpace } = useSpace();
  const openCreate = useCreateSurface();
  const spaceId = space ?? currentSpace?.id ?? null;
  const personal = scope === 'personal';

  // What the OAuth round trip said on its way back here. Read once and then
  // wiped from the URL, so a refresh doesn't re-announce a connection made
  // minutes ago (the connector's own page does the same with these params).
  const pathname = usePathname();
  const params = useSearchParams();
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    const ok = params.get('connected');
    const bad = params.get('connect_error');
    if (!ok && !bad) return;
    setOutcome({ ok: Boolean(ok), message: ok ?? bad ?? '' });
    const next = new URLSearchParams(params.toString());
    next.delete('connected');
    next.delete('connect_error');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('mine');
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [existing, setExisting] = useState<ExistingConnector[]>([]);
  // The OAuth services this deployment can complete without the space
  // registering its own app — what makes a Connect button one click.
  const [platformClients, setPlatformClients] = useState<string[]>([]);
  // Whether the caller may change what this space has. A member sees the list
  // — the connectors their agents can use, and which one they still have to
  // sign in to — and none of the acts: those are an admin's, and each write
  // behind them refuses a member anyway. Read off the response rather than
  // the space context so the panel is right for whichever space it was given.
  const [canManage, setCanManage] = useState(true);
  const readOnly = !canManage;
  // The catalog row whose one-click connect is in flight, by entry id: the note
  // is written, then the browser leaves for the provider, so the button stays
  // busy until navigation rather than settling back.
  const [connecting, setConnecting] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The connector Manage is open on, by note name, plus the recipe blurb the
  // row had to hand. The name and not the row: a toggle re-reads the list, and
  // the page has to show what the space now has rather than a snapshot.
  const [manage, setManage] = useState<{ name: string; about: string | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExistingConnector | null>(null);
  /** The Models + is open: the five providers, and nothing else. */
  const [modelPicker, setModelPicker] = useState(false);
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
    fetchJson<{ connectors: ExistingConnector[]; platformClients?: string[]; canManage?: boolean }>(
      `/api/communities/${encodeURIComponent(spaceId)}/connectors`,
    )
      .then((data) => {
        if (cancelled) return;
        setExisting(data.connectors);
        setPlatformClients(data.platformClients ?? []);
        setCanManage(data.canManage !== false);
        setError(null);
        // What the space has is the question an admin usually has, but a space
        // with nothing connected would open on an empty list — so land on the
        // catalog instead. Once per space: a later reload (a delete, a toggle)
        // must not move the tab out from under whoever chose it. A member has
        // no catalog to land on.
        if (landedRef.current !== spaceId) {
          landedRef.current = spaceId;
          setTab(
            data.canManage !== false && !data.connectors.some((c) => isConnected(c, scope)) ? 'catalog' : 'mine',
          );
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [spaceId, reloadKey, scope]);

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

  // Every note the space holds, including the ones Connected does not claim —
  // this is what a new connector's name may not collide with.
  const takenNames = useMemo(() => existing.map((c) => c.name), [existing]);

  /** What Connected lists ({@link isConnected}), before the search box. */
  const connected = useMemo(() => existing.filter((c) => isConnected(c, scope)), [existing, scope]);

  /**
   * The space's models, and the rest.
   *
   * A model connector is the same note as any other — `connectors/<name>.md`,
   * `kind: model` — but it answers a different question. Every other connector
   * is somewhere the space can REACH; a model is what its agents RUN ON, and
   * an agent that names none runs on the first of these. Filed among thirty
   * services, that decision is invisible; given its own line with a + beside
   * it, it is one press to make.
   *
   * Personal scope has none: a model is the space's key, one per provider, and
   * you do not run agents in your own space.
   */
  const modelRows = useMemo(
    () => (personal ? [] : connected.filter((c) => c.kind === 'model')),
    [connected, personal],
  );
  const nonModelRows = useMemo(() => connected.filter((c) => c.kind !== 'model'), [connected]);

  // A connector matches on what a reader would type: its own name or title, or
  // the service it is to.
  const mine = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return nonModelRows;
    return nonModelRows.filter((c) => {
      const service = catalogEntryFor(c.name, c.model?.provider, c.recipe);
      return (
        c.name.toLowerCase().includes(q) ||
        (c.title ?? '').toLowerCase().includes(q) ||
        (c.alias ?? '').toLowerCase().includes(q) ||
        (service?.name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [nonModelRows, query]);

  // The catalogue this surface offers, searched. Your own settings offer the
  // vetted MCP servers; a space's console offers everything else
  // (lib/connectors/catalog.ts#catalogForScope).
  const services = useMemo(() => searchCatalog(query, catalogForScope(scope)), [query, scope]);

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

  const openConnector = (name: string) => {
    onLeave?.();
    router.push(`/directory/${encodeURIComponent(`connector:${name}`)}`);
  };

  /** Send the browser to the provider for a connector whose note already exists. */
  const signIn = (name: string) => {
    if (!spaceId) return;
    window.location.href = connectorConnectPath(spaceId, name, returnTo);
  };

  /**
   * Connect a service in one press: write the note the recipe would have
   * written with everything left at its default, then send the browser to the
   * provider. No form, because there is nothing to ask — a vetted MCP server
   * registers Visvine as its client, a Google row rides the deployment's own
   * OAuth client, and the title, scopes and note are all the recipe's.
   *
   * The note is written FIRST because the OAuth start route reads the
   * connector's perimeter out of it: the note is the connector, so there is
   * nothing to authorize against until it exists. A dance the person abandons
   * therefore leaves a connector with no account attached — visible in the
   * list, deletable, and exactly what pressing Connect again picks up.
   */
  const connectInOneClick = async (entry: CatalogEntry) => {
    if (!spaceId) return;
    setConnecting(entry.id);
    setError(null);
    try {
      const { name, title } = suggestConnector(entry, takenNames);
      const { content } = connectorFromCatalog(entry, { name, title, description: '', values: {} });
      const path = `connectors/${name}.md`;
      await notesApi.create(spaceId, path, content);
      invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId), contextKeys.read(spaceId, path));
      window.location.href = connectorConnectPath(spaceId, name, returnTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the connection');
      setConnecting(null);
    }
  };

  if (entry) {
    return (
      <EntryForm
        entry={entry}
        spaceId={spaceId}
        taken={takenNames}
        returnTo={returnTo}
        onBack={() => setEntry(null)}
        onCreated={(href) => { onLeave?.(); router.push(href); }}
      />
    );
  }

  const openManage = (connector: ExistingConnector, about: string | null = null) => {
    setToggleError(null);
    setManage({ name: connector.name, about });
  };

  // What Manage opens: what the space actually has — which service it is to,
  // what it reaches, which secrets it names, where the note is — the tools it
  // may use where it is an MCP server, and the three acts a connector's row
  // offers: disable it, edit it, delete it. Edit is a door rather than an act
  // — the note IS the connector, so it hands over to the connector's own page,
  // the same place the row goes.
  const managed = manage ? existing.find((c) => c.name === manage.name) ?? null : null;

  const detailView = (connected: ExistingConnector, about?: string | null) => {
    const service = serviceOf(connected);
    const siblings = service ? held.get(service.id) ?? [] : [];
    const status = statusOf(connected, scope);
    return (
      <div className="flex flex-col gap-5">
        <button
          onClick={() => setManage(null)}
          className="flex items-center gap-2 self-start text-sm text-text-secondary transition-colors hover:text-text-primary"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          {personal ? 'Your connectors' : 'Connectors'}
        </button>

        <div className="flex min-h-14 items-center gap-3">
          <ConnectorLogo name={connected.name} provider={connected.model?.provider} recipe={connected.recipe} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold text-text-primary">
                {connected.title ?? connected.name}
              </h2>
              {status && <span className={`shrink-0 ${TONE_CHIP} ${TONE_CLASSES[status.tone]}`}>{status.label}</span>}
            </div>
            <p className="truncate text-xs text-text-muted">
              {service ? `${service.name} · ${connected.name}` : connected.name}
              {siblings.length > 1 && ` · one of ${siblings.length} in this space`}
            </p>
          </div>
          <Button
            variant="neutral"
            size="sm"
            className={ACTION_SLOT}
            disabled={toggling === connected.name}
            onClick={() => setEnabled(connected, !connected.enabled)}
          >
            {toggling === connected.name ? 'Saving…' : connected.enabled ? 'Disable' : 'Enable'}
          </Button>
        </div>

        {(connected.description ?? about) && (
          <p className="text-sm text-text-secondary">{connected.description ?? about}</p>
        )}

        {connected.invalid && <Alert>Not working: {connected.invalid}</Alert>}
        {!connected.enabled && (
          <p className="text-sm text-text-muted">
            Disabled. The note and its secrets are untouched — every run is refused until it is
            switched back on.
          </p>
        )}
        {toggleError && <Alert>{toggleError}</Alert>}

        {connected.kind !== 'model' && spaceId && (
          <ManageConnections spaceId={spaceId} name={connected.name} returnTo={returnTo} />
        )}

        {/* An MCP server is the one connector whose reach is a list of NAMES
            rather than a list of hosts, so it is the one with a permissions
            screen. Everything else is gated by `hosts:` and `allow:`, which
            are the note's to edit. */}
        {connected.mcp && spaceId && connected.enabled && !connected.invalid && (
          <ConnectorToolPermissions spaceId={spaceId} name={connected.name} />
        )}

        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 border-t border-border-subtle pt-4 text-[13px] text-text-secondary">
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
            same endpoint, so the page says where the key really lives rather
            than leaving an admin to discover it by adding a second. */}
        {connected.kind === 'model' && (
          <p className="text-[13px] text-text-secondary">
            The key is the space’s, one per provider — every {service?.name ?? 'provider'} agent
            uses it. Replace it on this connector’s page.
          </p>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-4">
          <Button
            variant="danger"
            size="sm"
            className="inline-flex items-center gap-2"
            onClick={() => { setDeleteError(null); setConfirmDelete(connected); }}
          >
            <Trash2Icon className="h-4 w-4" />
            Delete
          </Button>
          {/* The note IS the connector, so Edit is a door to its page — which
              only exists in the directory of the space being shown. A personal
              connector's note lives in your own space, reached from your
              context rather than from here. */}
          {!personal && (
            <Button variant="neutral" size="sm" onClick={() => { setManage(null); openConnector(connected.name); }}>
              Edit
            </Button>
          )}
        </div>
      </div>
    );
  };

  // Manage is a VIEW, not a dialog over the list: it is where the tools an MCP
  // server offers are decided one by one, which is a screen's worth of rows
  // rather than a question, and a dialog opened from inside a dialog is one
  // Escape away from losing both.
  if (managed) {
    return (
      <div className="flex flex-col gap-4">
        {detailView(managed, manage?.about)}
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

  // The catalogue's model recipes — what + offers.
  const modelServices = catalogForScope(scope).filter((e) => e.shape === 'model');

  return (
    <div className="flex flex-col gap-4">
      {/* Models first, and above the search box: what this space's agents run
          on is one line, not a row buried among the services it reaches. */}
      {!personal && (readOnly ? modelRows.length > 0 : true) && (
        <section className="flex flex-col">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-text-primary">Models</h3>
              <p className="text-xs text-text-muted">
                {modelRows.length === 0
                  ? 'What this space’s agents run on. Add one and they can run.'
                  : `Agents run on the first of these unless their brief names another.`}
              </p>
            </div>
            {!readOnly && (
              <Button
                variant={modelRows.length === 0 ? 'brand' : 'neutral'}
                size="sm"
                className={ACTION_SLOT}
                onClick={() => { setQuery(''); setModelPicker(true); }}
              >
                {modelRows.length === 0 ? 'Add model' : '+ Add'}
              </Button>
            )}
          </div>

          {modelRows.length > 0 && (
            <ul className="mt-2 divide-y divide-border-subtle border-t border-border-subtle">
              {modelRows.map((c) => {
                const status = statusOf(c, scope);
                return (
                  <li key={c.path} className="py-1">
                    <div className="-mx-3 flex min-h-14 items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-2">
                      <button
                        onClick={() => (readOnly ? openConnector(c.name) : openManage(c))}
                        className="flex min-w-0 flex-1 items-center gap-4 text-left"
                      >
                        <ConnectorLogo name={c.name} provider={c.model?.provider} recipe={c.recipe} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-text-primary">
                            {c.model?.modelId ?? c.title ?? c.name}
                          </p>
                          <p className="truncate text-xs text-text-muted">
                            {c.model?.providerLabel ?? 'Model'} · {c.name}
                          </p>
                        </div>
                      </button>
                      {status && <span className={`shrink-0 ${TONE_CHIP} ${TONE_CLASSES[status.tone]}`}>{status.label}</span>}
                      {!readOnly && (
                        <Button variant="neutral" size="sm" className={ACTION_SLOT} onClick={() => openManage(c)}>
                          Manage
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* The + opens the providers, and nothing else: choosing a model is
              choosing among five, not searching a catalogue of forty. */}
          {modelPicker && (
            <ul className="mt-2 divide-y divide-border-subtle border-t border-border-subtle">
              {modelServices.map((e) => (
                <li key={e.id} className="py-1">
                  <button
                    onClick={() => { setModelPicker(false); setEntry(e); }}
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
        </section>
      )}

      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={
          tab === 'mine'
            ? personal
              ? 'Search your connectors…'
              : 'Search this space’s connectors…'
            : personal
              ? 'Search MCP servers…'
              : 'Search services…'
        }
      />

      {!readOnly && <div className="flex gap-1">
        {TABS[scope].map((t) => (
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
            {t.id === 'mine' && nonModelRows.length > 0 && (
              <span className="ml-1.5 text-xs text-text-muted">{nonModelRows.length}</span>
            )}
          </button>
        ))}
      </div>}

      {outcome && (
        <p
          className={`text-sm ${outcome.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
        >
          {outcome.message}
        </p>
      )}

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      ) : tab === 'mine' ? (
        <div className="border-t border-border-subtle pt-2">
          {mine.length === 0 && (
            <p className="py-8 text-center text-sm text-text-muted">
              {query
                ? `Nothing matches “${query}”.`
                : readOnly
                  ? 'This space has no connectors yet. An admin adds them in the Space Console.'
                  : 'Nothing connected yet.'}
            </p>
          )}

          {/* One row per CONNECTOR, not per service: two Drives are two rows,
              each with its own key, its own on/off and its own note. */}
          <ul className="divide-y divide-border-subtle">
            {mine.map((c) => {
              const status = statusOf(c, scope);
              const service = serviceOf(c);
              return (
                <li key={c.path} className="py-1">
                  <div className="-mx-3 flex min-h-14 items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-2">
                    <button
                      onClick={() => (personal ? openManage(c) : openConnector(c.name))}
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
                    {/* A member's one act on a space's connector is signing in
                        to their own account behind it — what a `mode: user`
                        connector needs from each person before a run as them
                        can spend it. The rest is the admin's. */}
                    {readOnly ? (
                      signsIn(c) && c.enabled && !c.invalid && (!c.connection || c.connection.broken) ? (
                        <Button variant="brand" size="sm" className={ACTION_SLOT} onClick={() => signIn(c.name)}>
                          {c.connection?.broken ? 'Reconnect' : 'Sign in'}
                        </Button>
                      ) : null
                    ) : (
                      <Button
                        variant="neutral"
                        size="sm"
                        className={ACTION_SLOT}
                        onClick={() => openManage(c)}
                      >
                        Manage
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {!readOnly && (
            <div className="flex items-center justify-between gap-4 border-t border-border-subtle pt-4 mt-2">
              <p className="text-xs text-text-muted">
                {personal ? 'Sign in to another MCP server.' : 'Connect another service, or write one yourself.'}
              </p>
              <Button variant="neutral" size="sm" onClick={() => { setQuery(''); setTab('catalog'); }}>
                {personal ? 'See servers' : 'Add a connector'}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="border-t border-border-subtle pt-2">
          {services.length === 0 && (
            <p className="py-8 text-center text-sm text-text-muted">Nothing matches “{query}”.</p>
          )}

          {/* One row per SERVICE. In a space's console it never fills up: a
              service the space already reaches still offers another, because a
              second connector is a second set of credentials (the team's Drive
              beside yours), not a duplicate. Two rows do fill up — a model
              provider, whose key is the space's one key, and every row in your
              own settings, where a connector is your account at a service and
              you have one of those. Those hand over to the one they have. */}
          <ul className="divide-y divide-border-subtle">
            {services.map((e) => {
              const rows = held.get(e.id) ?? [];
              const many = allowsManyConnectors(e, scope);
              // Nothing to ask for: Connect is the whole interaction, and the
              // form stays reachable through the row for the space that wants
              // its own OAuth app or extra scopes.
              const oneClick = connectsInOneClick(e, platformClients);
              const style = catalogConnectStyle(e, platformClients);
              const busy = connecting === e.id;
              // In your own settings a row is your account at the service, so
              // "connected" means an account is actually linked — a note left
              // behind by a dance nobody finished says Sign in, not Connected.
              const held0 = rows[0] ?? null;
              const signedIn = Boolean(held0?.connection && !held0.connection.broken);
              return (
                <li key={e.id} className="py-1">
                  <div className="-mx-3 flex min-h-14 items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-2">
                    <button
                      // The whole row does what its button does — there is one
                      // thing to do with a service, and no second surface
                      // explaining it: what it is and what it reaches are on
                      // the connector's own page once it exists.
                      disabled={busy}
                      onClick={() =>
                        rows.length > 0 && !many
                          ? openManage(rows[0], e.description)
                          : oneClick
                            ? void connectInOneClick(e)
                            : setEntry(e)
                      }
                      className="flex min-w-0 flex-1 items-center gap-4 text-left"
                    >
                      <ConnectorLogo entry={e} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-text-primary">{catalogRowLabel(e)}</p>
                        <p className="truncate text-xs text-text-muted">{e.description}</p>
                      </div>
                    </button>
                    {/* How you connect it, before you press anything: one press,
                        a sign-in, or a credential you have to go and fetch.
                        Every row in your own settings is one press, so there
                        the chip has nothing to distinguish and says whether you
                        are signed in instead. */}
                    {personal ? (
                      rows.length > 0 && (
                        <span className={`shrink-0 ${TONE_CHIP} ${TONE_CLASSES[signedIn ? 'ok' : 'warn']}`}>
                          {signedIn ? 'Connected' : 'Not signed in'}
                        </span>
                      )
                    ) : (
                      <span className={`shrink-0 ${TONE_CHIP} ${TONE_CLASSES[style === 'key' ? 'muted' : 'ok']}`}>
                        {style === 'one-click' ? 'One click' : style === 'sign-in' ? 'Sign in' : 'API key'}
                      </span>
                    )}
                    {rows.length > 0 && !personal && (
                      <span className="shrink-0 text-xs text-text-muted">
                        {rows.length === 1 ? '1 connected' : `${rows.length} connected`}
                      </span>
                    )}
                    {rows.length === 0 ? (
                      <Button
                        variant="brand"
                        size="sm"
                        disabled={busy}
                        className={ACTION_SLOT}
                        onClick={() => (oneClick ? void connectInOneClick(e) : setEntry(e))}
                      >
                        {busy ? 'Connecting…' : 'Connect'}
                      </Button>
                    ) : personal && !signedIn && held0 ? (
                      // The note is already there, so this is the sign-in it is
                      // missing rather than a second connector.
                      <Button
                        variant="brand"
                        size="sm"
                        className={ACTION_SLOT}
                        onClick={() => signIn(held0.name)}
                      >
                        Sign in
                      </Button>
                    ) : many ? (
                      <Button
                        variant="neutral"
                        size="sm"
                        disabled={busy}
                        className={ACTION_SLOT}
                        onClick={() => (oneClick ? void connectInOneClick(e) : setEntry(e))}
                      >
                        {busy ? 'Connecting…' : 'Add another'}
                      </Button>
                    ) : (
                      <Button
                        variant="neutral"
                        size="sm"
                        className={ACTION_SLOT}
                        onClick={() => openManage(rows[0], e.description)}
                      >
                        Manage
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* The service that isn't on the list: a connector is only ever a
              note, so a custom one is written on the draft surface. */}
          {!personal && (
            <div className="flex items-center justify-between gap-4 border-t border-border-subtle pt-4 mt-2">
              <p className="text-xs text-text-muted">Something not on the list? Write its note yourself.</p>
              <Button variant="neutral" size="sm" onClick={() => openCreate('connector')}>
                Custom connector
              </Button>
            </div>
          )}
        </div>
      )}

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
  returnTo,
  onBack,
  onCreated,
}: {
  entry: CatalogEntry;
  spaceId: string | null;
  /** Connector names the space already uses — the new note may not be one of them. */
  taken: string[];
  /** Where the OAuth round trip lands, for a service that has one. */
  returnTo: string | null;
  onBack: () => void;
  onCreated: (href: string) => void;
}) {
  const suggestion = useMemo(() => suggestConnector(entry, taken), [entry, taken]);
  const [title, setTitle] = useState(suggestion.title);
  // A field with choices starts on its first one: a model recipe should not
  // make somebody pick the obvious model before it will let them paste a key.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      entry.fields.flatMap((f) => (f.choices && f.choices.length > 0 ? [[f.key, f.choices[0].value]] : [])),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The ordinary fields, and the ones only a space registering its own OAuth
  // app ever fills in. Splitting them is what keeps a client id and secret off
  // a screen whose honest answer is "press Connect".
  const plain = useMemo(() => plainFields(entry), [entry]);
  const advanced = useMemo(() => entry.fields.filter((f) => f.advanced), [entry]);

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
      // A connector nobody has signed into does nothing, so saving one hands
      // straight over to the provider rather than landing on a page whose only
      // useful control is Connect.
      if (entry.oauth) {
        window.location.href = connectorConnectPath(spaceId, name, returnTo);
        return;
      }
      onCreated(`/directory/${encodeURIComponent(`connector:${name}`)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the connector');
      setSaving(false);
    }
  };

  const field = (f: CatalogEntry['fields'][number]) => (
    <Field
      key={f.key}
      label={
        <>
          {f.label}
          {f.required && <span className="text-red-500"> *</span>}
        </>
      }
      hint={f.hint}
    >
      {/* A field with choices offers them and still takes anything: a model
          recipe lists the ids the registry ships, and a provider releases new
          ones faster than that list is edited. */}
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
  );

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
          <h2 className="text-lg font-semibold text-text-primary">{catalogRowLabel(entry)}</h2>
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

      {plain.map(field)}

      {advanced.length > 0 && (
        <div className="border-t border-border-subtle pt-4">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            className="text-sm font-medium text-text-secondary underline underline-offset-2 hover:text-text-primary"
          >
            {entry.oauth ? 'Use your own OAuth app' : 'Advanced'}
          </button>
          {showAdvanced && (
            <div className="mt-4 flex flex-col gap-5">
              {entry.oauth && (
                <p className="text-xs text-text-muted">
                  Leave these blank and the connection runs on Visvine’s own app — nothing to
                  register. Fill them in to hold the grant in your own provider account instead.
                </p>
              )}
              {advanced.map(field)}
            </div>
          )}
        </div>
      )}

      {error && <p className="border-l-2 border-red-500 py-1 pl-3 text-sm text-red-500">{error}</p>}

      <div className="flex items-center justify-end gap-2 border-t border-border-subtle pt-4">
        <Button variant="neutral" onClick={onBack} disabled={saving}>Cancel</Button>
        <Button variant="brand" onClick={submit} disabled={!ready || saving}>
          {saving ? 'Saving…' : entry.oauth ? 'Continue to sign-in' : 'Save connector'}
        </Button>
      </div>
    </div>
  );
}
