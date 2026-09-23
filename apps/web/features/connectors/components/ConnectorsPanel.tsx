'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSpaceRouter } from '@/features/shared/hooks/useSpaceRouter';
import { Avatar, Button, ConfirmDialog, SearchInput, Skeleton, Alert } from '@visvine/ui';
import { ArrowLeftIcon, Trash2Icon } from '@/features/shared/icons';
import ConnectorLogo from './ConnectorLogo';
import ConnectorToolPermissions from './ConnectorToolPermissions';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { notesApi } from '@/features/notes/lib/notesApi';
import { contextKeys, invalidateContextCache } from '@/features/notes/lib/contextPrefetch';
import { fetchJson } from '@/lib/fetchJson';
import { connectorConnectPath } from '@/lib/connectors/connectUrl';
import { accountConnectPath, isAccountRecipe } from '@/lib/connectors/accountRecipes';
import { inflightFetch } from '@/features/shared/lib/requestCache';
import { TONE_CHIP, TONE_CLASSES } from '@/features/shared/lib/statusTone';
import { timeAgo } from '@/lib/date';
import type { ConnectorRequest } from '@/lib/connectors/requests';
import {
  CONNECTOR_CATALOG,
  catalogEntryFor,
  catalogRowLabel,
  searchCatalog,
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
 *
 * The same panel is the Directory's Connectors table, where a MEMBER meets the
 * space's connectors, pinned to one view (`view`). (What a space's agents run
 * on is not a service among forty: models have their own console section,
 * features/models/components/ModelsPanel.tsx. What a person signs in to for
 * themselves, for every space, is an account — AccountsPanel.) The list route says
 * whether they can manage (`canManage`), and when they cannot the panel
 * offers no Manage and no Connect — what it offers is the asks:
 *
 * - CONNECTED is the rows that work for this person now: no account needed,
 *   or their own account linked and not broken.
 * - NOT CONNECTED is the rest of what the space has: a row a grant reaches
 *   goes to the connector's page and, where the connector holds an account
 *   per member, offers Sign in. A row no grant reaches is still listed — by
 *   name, title and logo, nothing it reaches — and offers Request access,
 *   which files a ContextAccessRequest on the note for Members → Waiting to
 *   answer.
 * - ALL CONNECTORS is the catalogue. A service the space holds says so; one it
 *   does not offers Request, which files a ConnectorRequest for the console's
 *   Connectors section, where an admin's Add runs the recipe and closes it.
 *
 * An admin sees the same three views with their own acts in place of the
 * asks, and the console's section is the first and third with a tab bar of
 * its own, plus the strip of what members asked for.
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
 * Drive row is in.
 */
type Tab = 'mine' | 'connected' | 'disconnected' | 'catalog';

/** What the space already has, by note name — one row of GET …/connectors. */
interface ExistingConnector {
  name: string;
  path: string;
  /** Frontmatter `title` — what it is called where two connectors share a service. */
  title: string | null;
  /** Frontmatter `recipe` — which catalog service it is to, where it says. */
  recipe: string | null;
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
  /** The site this connector signs an agent's machine into — a Website login. */
  login: { url: string } | null;
  /**
   * The linked account behind an OAuth connector, when there is one — null both
   * for a connector that uses no OAuth and for one whose sign-in was never
   * finished. What tells a connected Drive from a note left behind by an
   * abandoned dance.
   */
  connection: { actsAs: string | null; broken: boolean } | null;
  /**
   * The parent space's connector, shared with this sub-space
   * (docs/sub-spaces.md). Read here, changed there: no switch, no delete, no
   * edit — the row says whose it is instead.
   */
  shared?: boolean;
  sharedFrom?: { id: string; name: string } | null;
}

type Tone = 'ok' | 'warn' | 'bad' | 'muted';

/** A connector the caller cannot open — one row of the list route's `hidden`. */
interface HiddenConnector {
  name: string;
  path: string;
  title: string | null;
  recipe: string | null;
  /** The caller already has an open access request on the note. */
  accessRequested: boolean;
}

/**
 * Does this connector hold an account somebody signs in to, per its recipe?
 */
function signsIn(connector: ExistingConnector): boolean {
  const shape = catalogEntryFor(connector.name, connector.recipe)?.shape;
  return shape === 'oauth' || shape === 'mcp';
}

/**
 * Does this connector work for the caller NOW — what Connected lists?
 *
 * A connector that holds no account is connected the moment the note is
 * readable: a key the space stored, a database, a webhook. One that holds an
 * account per member is connected once THIS person's account is linked and
 * still working; until then it is on Available with a Sign in beside it. A
 * space-mode OAuth connector reports the space's account on the same field,
 * so it reads as connected for everyone once an admin has signed in.
 */
function worksForCaller(connector: ExistingConnector): boolean {
  if (!connector.enabled || connector.invalid) return false;
  if (!signsIn(connector)) return true;
  return connector.connection !== null && !connector.connection.broken;
}

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
  if (connector.hosts.length === 0) return { label: 'No network', tone: 'warn' };
  // The account is per member, and the row is about what the space has — so a
  // note with nobody signed in is what a configured connector looks like, and
  // only a linked account that has stopped working is worth a chip.
  if (signsIn(connector) && connector.connection?.broken) return { label: 'Reconnect', tone: 'bad' };
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
      `/api/spaces/${spaceId}/connectors/${encodeURIComponent(name)}/connections`,
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
      <span className="text-fg-muted">{whose}:</span>
      {mine ? (
        <span>
          connected as <span className="font-mono text-xs">{mine.actsAs ?? 'unknown account'}</span>
        </span>
      ) : (
        <span className="text-fg-muted">not connected</span>
      )}
      {mine?.broken && (
        <span className="text-danger">stopped working{mine.broken.reason ? ` — ${mine.broken.reason}` : ''}</span>
      )}
      <a href={connectorConnectPath(spaceId, name, returnTo)} className="font-medium text-fg underline underline-offset-2">
        {mine ? 'Reconnect' : 'Connect'}
      </a>
    </div>
  );
}

// A row's action is a column, not a label: Connect, Sign in, Add another and
// Manage all sit in the same slot, so a list of rows offering different things
// still reads down one edge.
const ACTION_SLOT = 'shrink-0 whitespace-nowrap text-center';


export default function ConnectorsPanel({
  space,
  returnTo = null,
  view,
  onRequestsChanged,
}: {
  /** The space to work in; defaults to the one the app is showing. */
  space?: string | null;
  /**
   * Pin the panel to one list. The host owns the tab bar then — the account
   * menu's dialog lays its own across three panels — so this renders no tabs,
   * no landing choice and no "see the other list" footer.
   */
  view?: Tab;
  /** Where the OAuth round trip lands — this surface, not the connector page. */
  returnTo?: string | null;
  /** A member's request was answered — the console re-counts its badge. */
  onRequestsChanged?: () => void;
} = {}) {
  const router = useSpaceRouter();
  const { currentSpace } = useSpace();
  const spaceId = space ?? currentSpace?.id ?? null;

  // What the OAuth round trip said on its way back here. Read once and then
  // wiped from the URL, so a refresh doesn't re-announce a connection made
  // minutes ago (the connector's own page does the same with these params).
  // Read off `location` rather than useSearchParams, so a host needs no
  // Suspense boundary for it.
  const pathname = usePathname();
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const ok = params.get('connected');
    const bad = params.get('connect_error');
    if (!ok && !bad) return;
    setOutcome({ ok: Boolean(ok), message: ok ?? bad ?? '' });
    params.delete('connected');
    params.delete('connect_error');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router]);

  const [query, setQuery] = useState('');
  const tab: Tab = view ?? 'mine';
  const [existing, setExisting] = useState<ExistingConnector[]>([]);
  // What the space has that this caller cannot open, and what they have
  // already asked for — so a row says "Requested" rather than asking again.
  const [hidden, setHidden] = useState<HiddenConnector[]>([]);
  const [requested, setRequested] = useState<string[]>([]);
  // The row whose ask is in flight — a note path (access) or a recipe id (connect).
  const [asking, setAsking] = useState<string | null>(null);
  // What members asked the space to connect (admins only): the console's
  // strip. An admin answers one by asking an AI to write the connector.
  const [requests, setRequests] = useState<ConnectorRequest[]>([]);
  // The OAuth services this deployment can complete without the space
  // registering its own app — what makes a Connect button one click.
  const [platformClients, setPlatformClients] = useState<string[]>([]);
  // The recipes this person already holds an account to (Settings → Accounts).
  const [myAccounts, setMyAccounts] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    inflightFetch('account:connectors', () => fetchJson<{ accounts: Array<{ recipe: string }> }>('/api/account/connectors'))
      .then((body) => { if (live) setMyAccounts(body.accounts.map((row) => row.recipe)); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  // Whether the caller may change what this space has. A member sees the list
  // — the connectors their agents can use, and which one they still have to
  // sign in to — and none of the acts: those are an admin's, and each write
  // behind them refuses a member anyway. Read off the response rather than
  // the space context so the panel is right for whichever space it was given.
  // Null until the list has answered, so nothing admin-only is asked for on
  // a guess.
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const readOnly = canManage === false;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The connector Manage is open on, by note name, plus the recipe blurb the
  // row had to hand. The name and not the row: a toggle re-reads the list, and
  // the page has to show what the space now has rather than a snapshot.
  const [manage, setManage] = useState<{ name: string; about: string | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExistingConnector | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // The connector whose on/off write is in flight, and what went wrong if it did.
  const [toggling, setToggling] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Re-read what's connected on mount, on a space switch, and after a delete.
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!spaceId) return;
    const controller = new AbortController();
    const cancelled = () => controller.signal.aborted;
    setLoading(true);
    fetchJson<{
      connectors: ExistingConnector[];
      hidden?: HiddenConnector[];
      requested?: string[];
      platformClients?: string[];
      canManage?: boolean;
    }>(`/api/spaces/${encodeURIComponent(spaceId)}/connectors`, { signal: controller.signal })
      .then((data) => {
        if (cancelled()) return;
        setExisting(data.connectors);
        setHidden(data.hidden ?? []);
        setRequested(data.requested ?? []);
        setPlatformClients(data.platformClients ?? []);
        setCanManage(data.canManage !== false);
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled()) setError(e.message);
      })
      .finally(() => {
        if (!cancelled()) setLoading(false);
      });
    return () => controller.abort();
  }, [spaceId, reloadKey]);

  // The asks, for the admin who answers them. Read only once the list has
  // said the caller can manage, and re-read with it.
  useEffect(() => {
    if (!spaceId || canManage !== true) { setRequests([]); return; }
    const controller = new AbortController();
    void fetchJson<{ requests: ConnectorRequest[] }>(
      `/api/spaces/${encodeURIComponent(spaceId)}/connector-requests`,
      { signal: controller.signal },
    )
      .then((data) => { if (!controller.signal.aborted) setRequests(data.requests.filter((r) => r.status === 'pending')); })
      .catch(() => { if (!controller.signal.aborted) setRequests([]); });
    return () => controller.abort();
  }, [spaceId, canManage, reloadKey]);

  /** The service a connector is to, where it came from a recipe. */
  const serviceOf = (c: ExistingConnector) => catalogEntryFor(c.name, c.recipe);

  // What the space has, per service — the count a catalog row reports, and how
  // the second Drive is known to be a Drive at all.
  const held = useMemo(() => {
    const map = new Map<string, ExistingConnector[]>();
    for (const c of existing) {
      const service = catalogEntryFor(c.name, c.recipe);
      if (!service) continue;
      const rows = map.get(service.id);
      if (rows) rows.push(c);
      else map.set(service.id, [c]);
    }
    return map;
  }, [existing]);

  /** The rows that work for this person now ({@link worksForCaller}). */
  const working = useMemo(() => existing.filter(worksForCaller), [existing]);


  // A connector matches on what a reader would type: its own name or title, or
  // the service it is to.
  const matches = (c: { name: string; title: string | null; alias?: string | null; recipe: string | null }, q: string) => {
    const service = catalogEntryFor(c.name, c.recipe);
    return (
      c.name.toLowerCase().includes(q) ||
      (c.title ?? '').toLowerCase().includes(q) ||
      (c.alias ?? '').toLowerCase().includes(q) ||
      (service?.name.toLowerCase().includes(q) ?? false)
    );
  };
  const q = query.trim().toLowerCase();
  const mine = useMemo(() => (q ? existing.filter((c) => matches(c, q)) : existing), [existing, q]);
  const mineHidden = useMemo(() => (q ? hidden.filter((c) => matches(c, q)) : hidden), [hidden, q]);
  const connected = useMemo(() => (q ? working.filter((c) => matches(c, q)) : working), [working, q]);
  // What the space has that does NOT work for this person yet: a connector
  // waiting on their sign-in, one that is off, one whose secrets are missing.
  const notConnected = useMemo(() => mine.filter((c) => !worksForCaller(c)), [mine]);

  // The whole catalogue, searched: what an admin adds from, and what a member
  // asks for.
  const services = useMemo(() => searchCatalog(query, CONNECTOR_CATALOG), [query]);

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
        `/api/spaces/${encodeURIComponent(spaceId)}/connectors/${encodeURIComponent(connector.name)}`,
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
    router.push(`/directory/${encodeURIComponent(`connector:${name}`)}`);
  };

  /** Send the browser to the provider for a connector whose note already exists. */
  const signIn = (name: string) => {
    if (!spaceId) return;
    window.location.href = connectorConnectPath(spaceId, name, returnTo);
  };

  /**
   * Ask for access to a connector the space has but no grant reaches. A
   * ContextAccessRequest on the note, answered on Members → Waiting like any
   * other; approval writes a grant at exactly that path.
   */
  const requestAccess = async (row: HiddenConnector) => {
    if (!spaceId) return;
    setAsking(row.path);
    setError(null);
    try {
      await notesApi.requestAccess(spaceId, row.path);
      setHidden((rows) => rows.map((h) => (h.path === row.path ? { ...h, accessRequested: true } : h)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the request');
    } finally {
      setAsking(null);
    }
  };

  /** Ask the space to connect a service it has no connector for. */
  const requestConnector = async (entry: CatalogEntry) => {
    if (!spaceId) return;
    setAsking(entry.id);
    setError(null);
    try {
      await fetchJson(`/api/spaces/${encodeURIComponent(spaceId)}/connector-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe: entry.id }),
      });
      setRequested((ids) => (ids.includes(entry.id) ? ids : [...ids, entry.id]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the request');
    } finally {
      setAsking(null);
    }
  };

  /** Close a member's request — with the note Add wrote, or with nothing. */
  const resolveRequest = async (request: ConnectorRequest, outcome: 'added' | 'dismissed', connectorName?: string) => {
    if (!spaceId) return;
    try {
      await fetchJson(`/api/spaces/${encodeURIComponent(spaceId)}/connector-requests`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: request.id, outcome, connectorName }),
      });
      setRequests((rows) => rows.filter((r) => r.id !== request.id));
      onRequestsChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the request');
    }
  };

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
    const status = statusOf(connected);
    return (
      <div className="flex flex-col gap-5">
        <button
          onClick={() => setManage(null)}
          className="flex items-center gap-2 self-start text-sm text-fg-secondary transition-colors hover:text-fg"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Connectors
        </button>

        <div className="flex min-h-14 items-center gap-3">
          <ConnectorLogo name={connected.name} recipe={connected.recipe} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold text-fg">
                {connected.title ?? connected.name}
              </h2>
              {status && <span className={`shrink-0 ${TONE_CHIP} ${TONE_CLASSES[status.tone]}`}>{status.label}</span>}
            </div>
            <p className="truncate text-xs text-fg-muted">
              {service ? `${service.name} · ${connected.name}` : connected.name}
              {siblings.length > 1 && ` · one of ${siblings.length} in this space`}
            </p>
          </div>
          {!connected.shared && (
            <Button
              variant="neutral"
              size="sm"
              className={ACTION_SLOT}
              disabled={toggling === connected.name}
              onClick={() => setEnabled(connected, !connected.enabled)}
            >
              {toggling === connected.name ? 'Saving…' : connected.enabled ? 'Disable' : 'Enable'}
            </Button>
          )}
        </div>

        {connected.shared && (
          <p className="text-sm text-fg-muted">
            Shared from <span className="font-medium text-fg-secondary">{connected.sharedFrom?.name ?? 'the parent space'}</span> —
            runs here with that space&apos;s keys and accounts. Its note, switch and secrets are changed there.
          </p>
        )}

        {(connected.description ?? about) && (
          <p className="text-sm text-fg-secondary">{connected.description ?? about}</p>
        )}

        {connected.invalid && <Alert>Not working: {connected.invalid}</Alert>}
        {!connected.enabled && (
          <p className="text-sm text-fg-muted">
            Disabled. The note and its secrets are untouched — every run is refused until it is
            switched back on.
          </p>
        )}
        {toggleError && <Alert>{toggleError}</Alert>}

        {spaceId && <ManageConnections spaceId={spaceId} name={connected.name} returnTo={returnTo} />}

        {/* An MCP server is the one connector whose reach is a list of NAMES
            rather than a list of hosts, so it is the one with a permissions
            screen. Everything else is gated by `hosts:` and `allow:`, which
            are the note's to edit. */}
        {connected.mcp && spaceId && connected.enabled && !connected.invalid && (
          <ConnectorToolPermissions spaceId={spaceId} name={connected.name} />
        )}

        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 border-t border-line-subtle pt-4 text-[13px] text-fg-secondary">
          {connected.login && (
            <>
              <dt className="text-fg-muted">Signs in at</dt>
              <dd className="min-w-0 break-words">
                {connected.login.url}
                <span className="block text-xs text-fg-muted">An agent with this connector calls sign_in on its machine; the password is typed there and never shown to it.</span>
              </dd>
            </>
          )}
          <dt className="text-fg-muted">Reaches</dt>
          <dd className="min-w-0 break-words">
            {connected.hosts.length > 0 ? connected.hosts.join(', ') : 'Nothing — no hosts declared'}
          </dd>
          <dt className="text-fg-muted">Secrets</dt>
          <dd className="min-w-0 break-words">
            {connected.secrets.length === 0 ? (
              'None'
            ) : (
              connected.secrets.map((secret, i) => (
                <span key={secret}>
                  {i > 0 && ', '}
                  <span className={connected.missingSecrets.includes(secret) ? 'text-warning' : undefined}>
                    {secret}
                    {connected.missingSecrets.includes(secret) && ' (not stored)'}
                  </span>
                </span>
              ))
            )}
          </dd>
          <dt className="text-fg-muted">Note</dt>
          <dd className="min-w-0 break-words font-mono text-xs">{connected.path}</dd>
        </dl>

        {!connected.shared && (
          <div className="flex items-center justify-between gap-3 border-t border-line-subtle pt-4">
            <Button
              variant="danger"
              size="sm"
              className="inline-flex items-center gap-2"
              onClick={() => { setDeleteError(null); setConfirmDelete(connected); }}
            >
              <Trash2Icon className="h-4 w-4" />
              Delete
            </Button>
            {/* The note IS the connector, so Edit is a door to its page. */}
            <Button variant="neutral" size="sm" onClick={() => { setManage(null); openConnector(connected.name); }}>
              Edit
            </Button>
          </div>
        )}
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
          body="Its stored secrets stay."
          confirmLabel="Delete"
          destructive
          error={deleteError}
          onConfirm={remove}
          onClose={() => setConfirmDelete(null)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* What members asked the space to connect. An admin answers by asking
          an AI to write the connector; writing it closes the request, and
          Dismiss closes it with nothing written. */}
      {!readOnly && (tab === 'mine' || tab === 'catalog') && requests.length > 0 && (
        <section className="flex flex-col">
          <h3 className="text-sm font-semibold text-fg">Requested ({requests.length})</h3>
          <ul className="mt-2 divide-y divide-line-subtle border-t border-line-subtle">
            {requests.map((r) => {
              const service = CONNECTOR_CATALOG.find((e) => e.id === r.recipe) ?? null;
              const busy = asking === r.id;
              return (
                <li key={r.id} className="py-0.5">
                  <div className="-mx-3 flex min-h-11 items-center gap-3 rounded-lg px-3 py-1.5">
                    {service ? <ConnectorLogo entry={service} /> : <Avatar name={r.requesterName ?? '?'} size="sm" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-fg">
                        {service ? catalogRowLabel(service) : r.recipe}
                      </p>
                      <p className="truncate text-xs text-fg-muted">
                        {r.requesterName ?? 'A member'} · {timeAgo(r.requestedAt)}
                        {r.message ? ` · “${r.message}”` : ''}
                      </p>
                    </div>
                    <Button
                      variant="neutral"
                      size="sm"
                      disabled={busy}
                      onClick={() => { setAsking(r.id); void resolveRequest(r, 'dismissed').finally(() => setAsking(null)); }}
                    >
                      Dismiss
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={tab === 'catalog' ? 'Search services…' : 'Search this space’s connectors…'}
      />

      {outcome && (
        <p
          className={`text-sm ${outcome.ok ? 'text-success dark:text-success-bright' : 'text-danger dark:text-danger-bright'}`}
        >
          {outcome.message}
        </p>
      )}

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      ) : tab !== 'catalog' ? (
        <div className="border-t border-line-subtle pt-2">
          {(tab === 'connected' ? connected : tab === 'disconnected' ? notConnected : mine).length === 0 && (tab === 'connected' || mineHidden.length === 0) && (
            <p className="py-8 text-center text-sm text-fg-muted">
              {query
                ? `Nothing matches “${query}”.`
                : tab === 'connected'
                  ? 'Nothing connected yet. Sign in to one on Not connected, or ask for one from All connectors.'
                  : tab === 'disconnected'
                    ? 'Everything this space has is connected for you.'
                    : 'This space has no connectors yet.'}
            </p>
          )}

          {/* One row per CONNECTOR, not per service: two Drives are two rows,
              each with its own key, its own on/off and its own note. */}
          <ul className="divide-y divide-line-subtle">
            {(tab === 'connected' ? connected : tab === 'disconnected' ? notConnected : mine).map((c) => {
              const status = statusOf(c);
              const service = serviceOf(c);
              return (
                <li key={c.path} className="py-0.5">
                  <div className="-mx-3 flex min-h-11 items-center gap-3 rounded-lg px-3 py-1.5 transition-colors hover:bg-surface-subtle">
                    <button
                      onClick={() => openConnector(c.name)}
                      className="flex min-w-0 flex-1 items-center gap-4 text-left"
                    >
                      <ConnectorLogo name={c.name} recipe={c.recipe} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-fg">
                          {c.title ?? c.name}
                        </p>
                        {/* The service it is to, and the name agents call it by
                            — the two things that tell one Drive from another. */}
                        <p className="truncate text-xs text-fg-muted">
                          {service ? `${service.name} · ${c.name}` : c.name}
                          {c.shared && ` · shared from ${c.sharedFrom?.name ?? 'the parent space'}`}
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
                    {signsIn(c) && c.enabled && !c.invalid && (!c.connection || c.connection.broken) ? (
                      <Button variant="brand" size="sm" className={ACTION_SLOT} onClick={() => signIn(c.name)}>
                        {c.connection?.broken ? 'Reconnect' : 'Sign in'}
                      </Button>
                    ) : readOnly ? (
                      // Works for this person now — nothing to do here but open it.
                      worksForCaller(c) && (
                        <span className={`shrink-0 ${TONE_CHIP} ${TONE_CLASSES.ok}`}>Connected</span>
                      )
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

            {/* What the space has that no grant lets this person open: named,
                so they can ask, and nothing else — the row does not go
                anywhere, because there is nowhere it may go yet. */}
            {(tab === 'mine' || tab === 'disconnected') && mineHidden.map((h) => {
              const service = catalogEntryFor(h.name, h.recipe);
              return (
                <li key={h.path} className="py-0.5">
                  <div className="-mx-3 flex min-h-11 items-center gap-3 rounded-lg px-3 py-1.5">
                    <ConnectorLogo name={h.name} recipe={h.recipe} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-fg">{h.title ?? h.name}</p>
                      <p className="truncate text-xs text-fg-muted">
                        {service ? `${service.name} · ${h.name}` : h.name}
                      </p>
                    </div>
                    {h.accessRequested ? (
                      <span className={`${ACTION_SLOT} text-xs text-fg-muted`}>Requested</span>
                    ) : (
                      <Button
                        variant="brand"
                        size="sm"
                        className={ACTION_SLOT}
                        disabled={asking === h.path}
                        onClick={() => void requestAccess(h)}
                      >
                        {asking === h.path ? 'Sending…' : 'Request access'}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="border-t border-line-subtle pt-2">
          {services.length === 0 && (
            <p className="py-8 text-center text-sm text-fg-muted">Nothing matches “{query}”.</p>
          )}

          {/* One row per SERVICE: what the space holds of it, or a member's
              Request. A connector is written by an AI over MCP; its page is
              where the key is pasted or the sign-in pressed. */}
          <ul className="divide-y divide-line-subtle">
            {services.map((e) => {
              const rows = held.get(e.id) ?? [];
              const busy = asking === e.id;
              const isRequested = requested.includes(e.id);
              // A service each person connects for themselves is nobody's to
              // add to a space: the row signs THIS person in, admin or member,
              // and the account then works in every space they act in.
              if (rows.length === 0 && isAccountRecipe(e, platformClients)) {
                return (
                  <li key={e.id} className="py-0.5">
                    <div className="-mx-3 flex min-h-11 items-center gap-3 rounded-lg px-3 py-1.5">
                      <ConnectorLogo entry={e} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-fg">{catalogRowLabel(e)}</p>
                        <p className="truncate text-xs text-fg-muted">{e.description}</p>
                      </div>
                      <span className={`shrink-0 ${TONE_CHIP} ${TONE_CLASSES.muted}`}>Your account</span>
                      {myAccounts.includes(e.id) ? (
                        <span className={`shrink-0 ${TONE_CHIP} ${TONE_CLASSES.ok}`}>Connected</span>
                      ) : (
                        <Button
                          variant="brand"
                          size="sm"
                          className={ACTION_SLOT}
                          onClick={() => { window.location.href = accountConnectPath({ recipe: e.id }, returnTo); }}
                        >
                          Connect
                        </Button>
                      )}
                    </div>
                  </li>
                );
              }
              // A row is a pointer at what the space has, or a member's ask for
              // what it has not.
              return (
                  <li key={e.id} className="py-0.5">
                    <div className="-mx-3 flex min-h-11 items-center gap-3 rounded-lg px-3 py-1.5">
                      <ConnectorLogo entry={e} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-fg">{catalogRowLabel(e)}</p>
                        <p className="truncate text-xs text-fg-muted">{e.description}</p>
                      </div>
                      {rows.length > 0 ? (
                        <span className={`shrink-0 ${TONE_CHIP} ${TONE_CLASSES.ok}`}>
                          {rows.length === 1 ? 'In this space' : `${rows.length} in this space`}
                        </span>
                      ) : !readOnly ? null : isRequested ? (
                        <span className={`${ACTION_SLOT} text-xs text-fg-muted`}>Requested</span>
                      ) : (
                        <Button
                          variant="neutral"
                          size="sm"
                          className={ACTION_SLOT}
                          disabled={busy}
                          onClick={() => void requestConnector(e)}
                        >
                          {busy ? 'Sending…' : 'Request'}
                        </Button>
                      )}
                    </div>
                  </li>
              );
            })}
          </ul>

        </div>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete ${confirmDelete?.title ?? confirmDelete?.name ?? 'connector'}?`}
        body="Its stored secrets stay."
        confirmLabel="Delete"
        destructive
        error={deleteError}
        onConfirm={remove}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
}
