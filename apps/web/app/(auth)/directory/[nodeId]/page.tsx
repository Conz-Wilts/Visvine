'use client';

// Entity routes. The pane chrome (tab bar, docked tree, note panel) lives in the
// persistent shell (directory/layout.tsx → PaneShell); these pages keep the
// deciding logic — node-type dispatch, ?tab= semantics, Context-tab
// availability, deep-link resolution — and register the resulting chrome with
// the shell. Only non-note bodies render here as page children.
//
// A node only earns a first tab when there is something behind it that isn't the
// context note. People get a profile, spaces a Space page, the retired
// org spellings an Overview, connectors their configuration, resources a
// preview, and events a link out to /events/<id>. Everything else — channels,
// spaces, notes, files, any type we haven't given a page — is nothing but its
// context, so those get Context/Raw and no first tab at all.

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { useSpaceRouter } from '@/features/shared/hooks/useSpaceRouter';
import PageError from '@/components/ui/PageError';
import { useNodeProfile } from '@/features/shared/hooks/useNodeProfile';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { useAuth } from '@/features/auth/contexts/AuthContext';
import { entityFolderPathOf, entityKindOf, entityNotePath } from '@/lib/notes/entities';
import { isOwnSpaceNode } from '@/lib/types/context';
import type { NBNode } from '@/lib/types';
import type { ToolSubject } from '@/lib/tools/protocol';
import type { TypePageOwner } from '@/lib/tools/typePages';
import TypePageTab from '@/features/tools/components/TypePageTab';
import { useTypeTabs } from '@/features/tools/hooks/useTypePages';
import ProfileSkeletonLoader from '@/features/profile/components/ProfileSkeletonLoader';
import { type NoteMode } from '@/features/notes/components/NoteModeToggle';
import { usePrefetchEntityContext } from '@/features/notes/lib/contextPrefetch';
import { usePaneChrome, type PaneTabItem } from '@/features/shared/contexts/PaneShellContext';
import ProfilePageContent from '@/features/profile/components/ProfilePageContent';
import { isSelfView } from '@/features/profile/lib/selfView';
import OrgPageContent from '@/features/profile/components/OrgPageContent';
import SpacePageContent from '@/features/profile/components/SpacePageContent';
import ResourcePreviewContent from '@/features/profile/components/ResourcePreviewContent';
import ConnectorPageContent from '@/features/profile/components/ConnectorPageContent';
import AgentPageContent from '@/features/profile/components/AgentPageContent';
import ModelPageContent from '@/features/profile/components/ModelPageContent';
import ToolPageContent from '@/features/profile/components/ToolPageContent';
import ViaSpaceNotice from '@/features/directory/components/ViaSpaceNotice';

/** URL-level tab ids. Kept as a type for the ?tab= plumbing — the bar itself
 *  takes plain string ids via the shell registration. `tool:<slug>` is an
 *  installed Tool's extra tab (see the Tool tabs section below); it is local
 *  state rather than a ?tab= value, so a Tool can never own a built-in page by
 *  way of a link. */
type ProfileTab = 'about' | 'context' | 'raw' | 'preview' | 'connections' | 'spaces' | `tool:${string}`;

/** The note the Context tab shows — what the tree highlights: the entity's own
 *  note (flat, or its folder index once converted), or, when the URL carries
 *  `?note=<sub>` (relative to the entity folder), that sub-note. A `note`
 *  that isn't a plain relative .md path is ignored. */
function useEntityNotePath(nodeId: string, node: NBNode | null): string | null {
  const searchParams = useSearchParams();
  const sub = searchParams.get('note');
  if (!node) return null;
  const own = entityNotePath({ id: nodeId, type: node.type, metadata: node.metadata ?? null });
  if (!sub || !/^[^/\\.][^\\]*\.md$/i.test(sub) || sub.split('/').some((s) => s === '' || s === '.' || s === '..')) {
    return own;
  }
  const folder = entityFolderPathOf({ id: nodeId, type: node.type });
  return folder ? `${folder}/${sub}` : own;
}

// A profile carries a Context tab when the notes tool is enabled, the node is an
// entity kind (the types with canonical context-note namespaces), and the node
// belongs to the current space (its context owns the note).
function useContextTabAvailable(node: NBNode | null): boolean {
  const { currentSpace } = useSpace();
  // Every space has context — there is no switch for it — so the tab is about
  // the node: an entity of THIS space has one, anything else does not.
  return (
    !!currentSpace &&
    !!node &&
    entityKindOf(node.type) !== null &&
    (!node.space_id || node.space_id === currentSpace.id)
  );
}

// Tab state lives in the URL (?tab=context / ?tab=raw) so tree/context/backlink
// deep links land directly on an entity's context. Default tab = bare URL.
// Context and Raw are the same note behind the same availability gate — Raw is
// just the editor in raw mode, promoted to a tab of its own.
function useProfileTabParam(): [ProfileTab | null, (tab: ProfileTab) => void] {
  const router = useSpaceRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const param = searchParams.get('tab');
  const wantedTab: ProfileTab | null = param === 'context' || param === 'raw' ? param : null;

  const setTabParam = useCallback(
    (tab: ProfileTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === 'context' || tab === 'raw') params.set('tab', tab);
      else params.delete('tab');
      const q = params.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  return [wantedTab, setTabParam];
}

// Both note-backed tabs; the tab IS the editor mode, so no lifted mode state.
const isNoteTab = (tab: ProfileTab) => tab === 'context' || tab === 'raw';
const modeForTab = (tab: ProfileTab): NoteMode => (tab === 'raw' ? 'raw' : 'wysiwyg');

const CONTEXT_TAB: PaneTabItem = { id: 'context', label: 'Context' };
const RAW_TAB: PaneTabItem = { id: 'raw', label: 'Raw' };

// ── Tool tabs ────────────────────────────────────────────────────────────────
//
// A built-in type keeps its built-in page — a Tool may only add a tab beside it
// (lib/tools/typePages.ts is where that rule is enforced, on the read side as
// well as the write side). Everything a Tool tab needs is in these three
// helpers plus one render branch per page shell: a Tool must not become a
// second kind of node route.

const TOOL_TAB_PREFIX = 'tool:';
const toolTabId = (slug: string): ProfileTab => `${TOOL_TAB_PREFIX}${slug}`;
const isToolTab = (tab: string): boolean => tab.startsWith(TOOL_TAB_PREFIX);

/** Tool tabs go after the page's own first tab and before Context/Raw — or at
 *  the front where the page has no first tab of its own (the note IS the page
 *  there, and a Tool's tab is a peer of it, not of Raw). */
function withToolTabs(tabs: PaneTabItem[], owners: TypePageOwner[]): PaneTabItem[] {
  if (owners.length === 0) return tabs;
  const extra = owners.map((owner) => ({ id: toolTabId(owner.slug), label: owner.title }));
  const lead = tabs.length > 0 && !isNoteTab(tabs[0].id as ProfileTab) ? 1 : 0;
  return [...tabs.slice(0, lead), ...extra, ...tabs.slice(lead)];
}

/** The Tool tabs this node's type earns, and which of them is showing. An
 *  install that has gone (uninstalled, switched off, claim withdrawn) simply
 *  isn't here, so the pages fall back to their first tab by the same rule they
 *  use for a retired ?tab= value. */
function useToolTabs(
  node: NBNode | null,
  activeTab: ProfileTab,
): { owners: TypePageOwner[]; active: TypePageOwner | null } {
  const owners = useTypeTabs(node?.type);
  return { owners, active: owners.find((owner) => toolTabId(owner.slug) === activeTab) ?? null };
}

/** A Tool tab's body, in the same frame every other first-tab body renders in. */
function ToolTabBody({ owner, nodeId, node, notePath }: {
  owner: TypePageOwner;
  nodeId: string;
  node: NBNode | null;
  notePath: string | null;
}) {
  const type = node?.type ?? '';
  const subject = useMemo<ToolSubject>(
    () => ({ kind: 'node', nodeId, type, notePath }),
    [nodeId, type, notePath],
  );
  return (
    <div className="w-full pb-10">
      <div
        role="tabpanel"
        className="profile-enter mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6 xl:max-w-6xl"
      >
        <TypePageTab owner={owner} subject={subject} mode="tab" />
      </div>
    </div>
  );
}

/**
 * One line and a Retry. `retry={false}` for the states that aren't failures —
 * nothing to try again when the answer is simply that there's nothing here.
 */
function NotFoundState({ title, retry = true }: { title: string; retry?: boolean }) {
  return <PageError message={title} onRetry={retry ? () => window.location.reload() : undefined} />;
}

/** The chrome shared by the routes that load a node before knowing whether it
 *  has a Context tab: while loading, the arriving tab implies the set (a note
 *  tab means all three) and the tree docks with no panel yet; once resolved,
 *  availability decides. */
function useEntityChrome(args: {
  /** null for the kinds that are nothing but their note — Context/Raw only. */
  firstTab: PaneTabItem | null;
  activeTab: ProfileTab;
  nodeId: string;
  notePath: string | null;
  loading: boolean;
  error: boolean;
  contextAvailable: boolean;
  /** Installed Tools adding a tab for this node's type — usually none. */
  toolTabs: TypePageOwner[];
  ariaLabel: string;
  onSelect: (id: string) => void;
}): void {
  const { firstTab, activeTab, nodeId, notePath, loading, error, contextAvailable } = args;
  const noteTab = isNoteTab(activeTab);
  const hasContext = loading ? noteTab : contextAvailable;

  // With no first tab the bar is the note's own two tabs — and if there's no
  // context either there is nothing left to show, so the bar goes away.
  const base = hasContext
    ? firstTab
      ? [firstTab, CONTEXT_TAB, RAW_TAB]
      : [CONTEXT_TAB, RAW_TAB]
    : firstTab
      ? [firstTab]
      : null;
  const tabs = base ? withToolTabs(base, args.toolTabs) : null;

  usePaneChrome({
    tabs: error ? null : tabs,
    activeId: error ? null : activeTab,
    onSelect: args.onSelect,
    attachedOpen: !error && activeTab === 'context' && (loading || contextAvailable),
    ariaLabel: args.ariaLabel,
    surface:
      error || !noteTab
        ? null
        : loading
          ? { kind: 'tree-only', notePath: null }
          : contextAvailable
            ? { kind: 'entity', nodeId, notePath, mode: modeForTab(activeTab) }
            : null,
  });
}

// ── Person nodes → LinkedIn profile (+ Context tab) ──────────────────────────

const PERSON_TABS: PaneTabItem[] = [
  { id: 'about', label: 'Profile' },
  CONTEXT_TAB,
  RAW_TAB,
];

// Every person node has a Profile tab, connected to a member or not. A node
// with no member behind it still renders one: the page stands in for the person
// until a member is behind it, and nothing about the link is offered here.
//
// A `person:` id that has no Node row is not necessarily a dead link: it may be
// a Person-row id (what a session carries as `personId`, and what the avatar
// menu's Profile item links to), whose node lives under a name-derived id
// instead. Resolve it once and rewrite the URL to the canonical node rather than
// showing "Profile not found" — see /api/nodes/resolve.
function PersonRoute({ nodeId }: { nodeId: string }) {
  const { data, loading, error } = useNodeProfile(nodeId);
  const { session } = useAuth();
  const missing = !data?.node && !loading && !!error;
  const resolved = useResolvedNodeId(missing ? nodeId : null);

  if (!missing) return <PersonProfilePage nodeId={nodeId} />;
  if (resolved.loading) return <ProfileSkeletonLoader mode="fullpage" />;
  // Resolved elsewhere: the replace is in flight, so hold the skeleton rather
  // than flashing not-found on the way out.
  if (resolved.nodeId) return <ProfileSkeletonLoader mode="fullpage" />;
  // Your own id with no node behind it anywhere — a member of no space yet.
  // The account is still a profile, and it is the one page you must always
  // be able to reach; ProfilePageContent renders it without node data.
  if (session?.user?.nodeId === nodeId) return <PersonProfilePage nodeId={nodeId} />;
  return <NotFoundState title="Couldn't load this profile." />;
}

/**
 * Maps a Person-row id to the node that actually carries that person's context,
 * and navigates there. Null `personId` disables the hook (the node exists, so
 * there is nothing to resolve).
 */
function useResolvedNodeId(personId: string | null) {
  const router = useSpaceRouter();
  const { currentSpace } = useSpace();
  const spaceId = currentSpace?.id ?? null;
  const [state, setState] = useState<{ loading: boolean; nodeId: string | null }>({
    loading: !!personId,
    nodeId: null,
  });

  useEffect(() => {
    if (!personId) {
      setState({ loading: false, nodeId: null });
      return;
    }
    let cancelled = false;
    setState({ loading: true, nodeId: null });
    const query = new URLSearchParams({ id: personId });
    if (spaceId) query.set('spaceId', spaceId);
    fetch(`/api/nodes/resolve?${query}`)
      .then((res) => (res.ok ? res.json() : { nodeId: null }))
      .then((json: { nodeId?: string | null }) => {
        if (cancelled) return;
        const next = json.nodeId && json.nodeId !== personId ? json.nodeId : null;
        setState({ loading: false, nodeId: next });
        // replace, not push: the unresolvable id must not sit in history behind
        // the profile and reappear on Back.
        if (next) router.replace(`/directory/${encodeURIComponent(next)}`);
      })
      .catch(() => { if (!cancelled) setState({ loading: false, nodeId: null }); });
    return () => { cancelled = true; };
  }, [personId, spaceId, router]);

  return state;
}

function PersonProfilePage({ nodeId }: { nodeId: string }) {
  // Deduped + cached alongside ProfilePageContent's own fetch; needed here for
  // the space-membership half of the Context-tab condition.
  const { data, loading: nodeLoading } = useNodeProfile(nodeId);
  const node = data?.node ?? null;
  const { currentSpace, loading: spaceLoading } = useSpace();
  const contextAvailable = useContextTabAvailable(node);
  const [wantedTab, setTabParam] = useProfileTabParam();
  const selfView = isSelfView(useSearchParams());
  // A Tool tab is local state: it has no ?tab= value (see ProfileTab), and
  // deriving `activeTab` through the owner list rather than an effect means a
  // Tool that goes away drops the page back to the profile with nothing to
  // chase it.
  const [toolTab, setToolTab] = useState<ProfileTab | null>(null);
  const toolOwners = useTypeTabs(node?.type);
  const showingTool = toolOwners.find((owner) => toolTabId(owner.slug) === toolTab) ?? null;

  const activeTab: ProfileTab = showingTool
    ? (toolTab as ProfileTab)
    : wantedTab && contextAvailable
      ? wantedTab
      : 'about';
  const notePath = useEntityNotePath(nodeId, node);
  // Warm the Context tab (Tiptap chunk + note/registry/config fetches) as soon
  // as the profile knows the tab exists, so clicking over paints immediately.
  usePrefetchEntityContext(nodeId, node, contextAvailable);
  // Deep link to ?tab=context/raw while space/node data still resolves: keep
  // the predicted bar + docked tree up instead of blinking them out for the
  // length of the fetch.
  const stillResolving = wantedTab !== null && !contextAvailable && (spaceLoading || nodeLoading || !currentSpace);
  const noteSurface = stillResolving || (contextAvailable && isNoteTab(activeTab));
  // activeTab falls back to 'about' until contextAvailable resolves, but while
  // resolving the URL's tab is where we're heading — underlining it keeps the
  // bar from correcting itself a beat after arrival.
  const barTab: ProfileTab = stillResolving && wantedTab ? wantedTab : activeTab;

  const handleSelect = useCallback(
    (id: string) => {
      if (isToolTab(id)) {
        // Clear ?tab= as well: the URL must not say Context while a Tool's tab
        // is on screen, and a reload lands back on the profile.
        setToolTab(id as ProfileTab);
        setTabParam('about');
        return;
      }
      setToolTab(null);
      setTabParam(id as ProfileTab);
    },
    [setTabParam],
  );

  const barVisible = contextAvailable || stillResolving;
  usePaneChrome({
    tabs: barVisible ? withToolTabs(PERSON_TABS, toolOwners) : null,
    activeId: barTab,
    onSelect: handleSelect,
    attachedOpen: barVisible && barTab === 'context',
    ariaLabel: 'Profile sections',
    surface: !noteSurface
      ? null
      : stillResolving
        ? { kind: 'tree-only', notePath: null }
        : { kind: 'entity', nodeId, notePath, mode: modeForTab(activeTab) },
  });

  // Strip a stale ?tab=context/raw (tool off / non-entity / foreign node) once
  // everything needed to decide has resolved.
  useEffect(() => {
    if (wantedTab && !contextAvailable && !spaceLoading && !nodeLoading && currentSpace && node) {
      setTabParam('about');
    }
  }, [wantedTab, contextAvailable, spaceLoading, nodeLoading, currentSpace, node, setTabParam]);

  // Note surfaces are entirely shell-rendered (PaneSurfaceHost).
  if (noteSurface) return null;

  if (showingTool) {
    return <ToolTabBody owner={showingTool} nodeId={nodeId} node={node} notePath={notePath} />;
  }

  return (
    <div className="w-full pb-10">
      {/* No outer card wrapper — ProfilePageContent renders separate floating
          cards on the page background. profile-enter stays on the content only:
          the persistent bar above it must not play an entrance. */}
      <div className="profile-enter mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6 xl:max-w-6xl">
        <ViaSpaceNotice node={node} />
        <ProfilePageContent nodeId={nodeId} selfView={selfView} />
      </div>
    </div>
  );
}

// ── Non-person nodes → their own page (+ Context/Raw) ────────────────────────

// "Overview", not "Profile": an organisation has a page, and the first tab is
// named after what it shows rather than after the person-shaped thing it used
// to imitate.
const ORG_FIRST_TAB: PaneTabItem = { id: 'about', label: 'Overview' };
// Which ids OrgPageContent is for. Node ids are `<type>:<slug>` (createEntity,
// syncEntityNode), so the prefix is the type — and organisations have worn four
// retired spellings before settling on `space:`, all of which now land on
// spaces/<slug>.md. Current data never reaches this list: a `space:`
// id goes to SpaceRoute, which gives it a Space page either way. An id
// with no prefix at all is a legacy directory row: those predate the structural
// types entirely, so an organisation is the right guess for them too.
const ORG_ID_PREFIXES = ['group:', 'org:', 'organization:', 'company:'];

function isOrgId(nodeId: string): boolean {
  return !nodeId.includes(':') || ORG_ID_PREFIXES.some((p) => nodeId.startsWith(p));
}

/** Shared shell for every node kind whose first tab is a body we render here. */
function NodePage({ nodeId, firstTab, ariaLabel, notFoundTitle, renderBody }: {
  nodeId: string;
  firstTab: PaneTabItem;
  ariaLabel: string;
  notFoundTitle: string;
  renderBody: (nodeId: string) => React.ReactNode;
}) {
  const { data, loading, error } = useNodeProfile(nodeId);
  const node = data?.node ?? null;
  const contextAvailable = useContextTabAvailable(node);
  const [wantedTab, setTabParam] = useProfileTabParam();
  const [activeTab, setActiveTab] = useState<ProfileTab>(wantedTab ?? 'about');
  // Same warm-start as the person page: prefetch the Context tab's chunk + data
  // while the user is still on Profile.
  usePrefetchEntityContext(nodeId, node, contextAvailable);
  const notePath = useEntityNotePath(nodeId, node);
  const noteSurface = isNoteTab(activeTab) && contextAvailable;
  const { owners: toolTabs, active: toolOwner } = useToolTabs(node, activeTab);

  // Tab changes keep local state (instant) and the URL (?tab=context) in sync.
  const changeTab = useCallback(
    (tab: ProfileTab) => {
      setActiveTab(tab);
      setTabParam(tab);
    },
    [setTabParam],
  );
  const handleSelect = useCallback((id: string) => changeTab(id as ProfileTab), [changeTab]);

  // A link to ?tab=context from INSIDE the first tab — an agent's "edit the
  // brief" link, a Tool's source files — is a same-route navigation: this
  // component does not remount, so the URL is the only thing that moved and
  // local state has to follow it, or the address bar says Context while the
  // page still shows the first tab.
  //
  // Compared against the LAST URL value rather than against `activeTab`: the
  // two disagree for a tick every time the user clicks a tab (state moves
  // first, `router.replace` lands after), and reading that as a URL change
  // would drag the tab straight back to where it was.
  const lastWantedTab = useRef(wantedTab);
  useEffect(() => {
    if (wantedTab === lastWantedTab.current) return;
    lastWantedTab.current = wantedTab;
    if (wantedTab) setActiveTab(wantedTab);
  }, [wantedTab]);

  // A tab with no panel behind it falls back to the first tab: ?tab=connections
  // and ?tab=spaces are retired links, and context resolves late (tool off
  // / non-entity node), so it can only be judged once the node has loaded.
  useEffect(() => {
    const retired = activeTab === 'connections' || activeTab === 'spaces';
    const staleContext = isNoteTab(activeTab) && !loading && data && !contextAvailable;
    // A Tool tab whose install has gone (uninstalled, switched off, claim
    // withdrawn) is as retired as the two above.
    const staleTool = isToolTab(activeTab) && !loading && data && !toolOwner;
    if (retired || staleContext || staleTool) {
      changeTab('about');
    }
  }, [activeTab, loading, data, contextAvailable, toolOwner, changeTab]);

  const loadingState = loading && !data;
  const errorState = !loadingState && (!!error || !data);

  useEntityChrome({
    firstTab,
    activeTab,
    nodeId,
    notePath,
    loading: loadingState,
    error: errorState,
    contextAvailable,
    toolTabs,
    ariaLabel,
    onSelect: handleSelect,
  });

  if (loadingState) {
    // Note-tab arrivals keep the predicted bar + docked tree with an empty body
    // — the note that follows reveals on data.
    return isNoteTab(activeTab) ? null : <ProfileSkeletonLoader mode="fullpage" />;
  }

  if (errorState) return <NotFoundState title={notFoundTitle} />;

  if (noteSurface) return null;

  if (toolOwner) {
    return <ToolTabBody owner={toolOwner} nodeId={nodeId} node={node} notePath={notePath} />;
  }

  return (
    <div className="w-full pb-10">
      <div
        role="tabpanel"
        className="profile-enter mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6 xl:max-w-6xl"
      >
        {activeTab === 'about' && (
          <>
            <ViaSpaceNotice node={node} />
            {renderBody(nodeId)}
          </>
        )}
      </div>
    </div>
  );
}

// ── Everything else → Context/Raw only ───────────────────────────────────────

// A channel, a space, an uploaded file: the node exists so the thing is in the
// graph and has somewhere to record what we know about it. There is no second
// view to give it, so inventing an "Overview" tab just to render a near-empty
// org card is worse than not having one — the note IS the page.
function ContextOnlyPage({ nodeId, ariaLabel, notFoundTitle }: {
  nodeId: string;
  ariaLabel: string;
  notFoundTitle: string;
}) {
  const { data, loading, error } = useNodeProfile(nodeId);
  const node = data?.node ?? null;
  const contextAvailable = useContextTabAvailable(node);
  const [wantedTab, setTabParam] = useProfileTabParam();
  const [activeTab, setActiveTab] = useState<ProfileTab>(wantedTab ?? 'context');
  usePrefetchEntityContext(nodeId, node, contextAvailable);
  const notePath = useEntityNotePath(nodeId, node);
  const { owners: toolTabs, active: toolOwner } = useToolTabs(node, activeTab);

  const changeTab = useCallback(
    (tab: ProfileTab) => {
      setActiveTab(tab);
      setTabParam(tab);
    },
    [setTabParam],
  );
  const handleSelect = useCallback((id: string) => changeTab(id as ProfileTab), [changeTab]);

  // A link to ?tab=context/raw from INSIDE this page's own body — no first tab
  // here, but a Tool tab's body can still hold one — is a same-route
  // navigation: this component does not remount, so local state has to follow
  // the URL. See NodePage's identical effect for why it's the last URL value,
  // not activeTab, being compared.
  const lastWantedTab = useRef(wantedTab);
  useEffect(() => {
    if (wantedTab === lastWantedTab.current) return;
    lastWantedTab.current = wantedTab;
    if (wantedTab) setActiveTab(wantedTab);
  }, [wantedTab]);

  // The two note tabs and any Tool tab are all this page has, so anything else
  // (a retired deep link, a Tool that has gone) lands back on Context.
  useEffect(() => {
    if (!isNoteTab(activeTab) && !toolOwner) changeTab('context');
  }, [activeTab, toolOwner, changeTab]);

  const loadingState = loading && !data;
  const errorState = !loadingState && (!!error || !data);

  useEntityChrome({
    firstTab: null,
    activeTab,
    nodeId,
    notePath,
    loading: loadingState,
    error: errorState,
    contextAvailable,
    toolTabs,
    ariaLabel,
    onSelect: handleSelect,
  });

  if (errorState) return <NotFoundState title={notFoundTitle} />;

  if (toolOwner) {
    return <ToolTabBody owner={toolOwner} nodeId={nodeId} node={node} notePath={notePath} />;
  }

  // The note surface is shell-rendered; while loading the predicted bar and the
  // docked tree already stand in for it.
  if (loadingState || contextAvailable) return null;

  // Notes tool off, or the node belongs to another space's context: there is
  // no note to show and nothing else this page could offer.
  return <NotFoundState title="No context for this yet." retry={false} />;
}

// ── Nodes owning a page elsewhere → Context/Raw here, the page for the rest ──

// Events and spaces have dedicated pages (/events/<id>, /spaces/<id>)
// rather than anything profile-shaped, but their context note is a first-class
// note like any entity's — the tree, backlinks and [[mentions]] all deep-link to
// /directory/<id>?tab=context. So note tabs render here, and the first tab jumps
// out to the real page.
const EVENT_FIRST_TAB: PaneTabItem = { id: 'about', label: 'Event' };
const SPACE_FIRST_TAB: PaneTabItem = { id: 'about', label: 'Page' };

function NoteOnlyPage({ nodeId, firstTab, href, ariaLabel, notFoundTitle }: {
  nodeId: string;
  firstTab: PaneTabItem;
  /** The node's real page — where the first tab, and an unavailable note, go. */
  href: string;
  ariaLabel: string;
  notFoundTitle: string;
}) {
  const { data, loading, error } = useNodeProfile(nodeId);
  const node = data?.node ?? null;
  const contextAvailable = useContextTabAvailable(node);
  const [wantedTab, setTabParam] = useProfileTabParam();
  const [activeTab, setActiveTab] = useState<ProfileTab>(wantedTab ?? 'context');
  const router = useSpaceRouter();
  usePrefetchEntityContext(nodeId, node, contextAvailable);
  const notePath = useEntityNotePath(nodeId, node);
  const noteSurface = isNoteTab(activeTab) && contextAvailable;

  // The first tab is a link out, not a panel: the node's real page owns
  // everything that isn't the context note.
  const changeTab = useCallback(
    (tab: ProfileTab) => {
      if (!isNoteTab(tab)) {
        router.push(href);
        return;
      }
      setActiveTab(tab);
      setTabParam(tab);
    },
    [router, href, setTabParam],
  );
  const handleSelect = useCallback((id: string) => changeTab(id as ProfileTab), [changeTab]);

  // A link to ?tab=context/raw from INSIDE the first tab is a same-route
  // navigation: this component does not remount, so local state has to follow
  // the URL. See NodePage's identical effect for why it's the last URL value,
  // not activeTab, being compared.
  const lastWantedTab = useRef(wantedTab);
  useEffect(() => {
    if (wantedTab === lastWantedTab.current) return;
    lastWantedTab.current = wantedTab;
    if (wantedTab) setActiveTab(wantedTab);
  }, [wantedTab]);

  // Context resolved as unavailable (notes tool off / foreign node): there is
  // nothing to render here, so fall through to the real page.
  useEffect(() => {
    const staleContext = isNoteTab(activeTab) && !loading && data && !contextAvailable;
    if (staleContext) router.replace(href);
  }, [activeTab, loading, data, contextAvailable, router, href]);

  const loadingState = loading && !data;
  const errorState = !loadingState && (!!error || !data);

  usePaneChrome({
    tabs: errorState ? null : [firstTab, CONTEXT_TAB, RAW_TAB],
    activeId: errorState ? null : activeTab,
    onSelect: handleSelect,
    attachedOpen: !errorState && activeTab === 'context',
    ariaLabel,
    surface: errorState
      ? null
      : loadingState || !contextAvailable
        ? { kind: 'tree-only', notePath: null }
        : noteSurface
          ? { kind: 'entity', nodeId, notePath, mode: modeForTab(activeTab) }
          : null,
  });

  if (errorState) return <NotFoundState title={notFoundTitle} />;

  // Everything else is shell-rendered; the tab that isn't a note tab navigates
  // away above.
  return null;
}

// ── Resource nodes → Preview + Context (no generic profile) ──────────────────

// Resources are documents/links, not people, so there's no generic profile:
// the default tab previews the resource URL and Context is the usual notes
// panel.
const RESOURCE_FIRST_TAB: PaneTabItem = { id: 'preview', label: 'Preview' };

function ResourceNodePage({ nodeId }: { nodeId: string }) {
  const { data, loading, error } = useNodeProfile(nodeId);
  const node = data?.node ?? null;
  const contextAvailable = useContextTabAvailable(node);
  const [wantedTab, setTabParam] = useProfileTabParam();
  const [activeTab, setActiveTab] = useState<ProfileTab>(wantedTab ?? 'preview');
  usePrefetchEntityContext(nodeId, node, contextAvailable);
  const notePath = useEntityNotePath(nodeId, node);
  const noteSurface = isNoteTab(activeTab) && contextAvailable;
  const { owners: toolTabs, active: toolOwner } = useToolTabs(node, activeTab);

  const changeTab = useCallback(
    (tab: ProfileTab) => {
      setActiveTab(tab);
      setTabParam(tab);
    },
    [setTabParam],
  );
  const handleSelect = useCallback((id: string) => changeTab(id as ProfileTab), [changeTab]);

  // A link to ?tab=context/raw from INSIDE the first tab (a resource's preview)
  // is a same-route navigation: this component does not remount, so local
  // state has to follow the URL. See NodePage's identical effect for why it's
  // the last URL value, not activeTab, being compared.
  const lastWantedTab = useRef(wantedTab);
  useEffect(() => {
    if (wantedTab === lastWantedTab.current) return;
    lastWantedTab.current = wantedTab;
    if (wantedTab) setActiveTab(wantedTab);
  }, [wantedTab]);

  // Anything but preview/available-context/a live Tool tab falls back to Preview
  // (retired deep links, or ?tab=context when the notes tool is off for this
  // space).
  useEffect(() => {
    const staleContext = isNoteTab(activeTab) && !loading && data && !contextAvailable;
    const staleTool = isToolTab(activeTab) && !loading && data && !toolOwner;
    if ((activeTab !== 'preview' && !isNoteTab(activeTab) && !isToolTab(activeTab)) || staleContext || staleTool) {
      changeTab('preview');
    }
  }, [activeTab, loading, data, contextAvailable, toolOwner, changeTab]);

  const loadingState = loading && !data;
  const errorState = !loadingState && (!!error || !data);

  useEntityChrome({
    firstTab: RESOURCE_FIRST_TAB,
    activeTab,
    nodeId,
    notePath,
    loading: loadingState,
    error: errorState,
    contextAvailable,
    toolTabs,
    ariaLabel: 'Resource sections',
    onSelect: handleSelect,
  });

  if (loadingState) {
    return isNoteTab(activeTab) ? null : <ProfileSkeletonLoader mode="fullpage" />;
  }

  if (errorState) return <NotFoundState title="Couldn't load this resource." />;

  if (noteSurface) return null;

  if (toolOwner) {
    return <ToolTabBody owner={toolOwner} nodeId={nodeId} node={node} notePath={notePath} />;
  }

  return (
    <div className="w-full pb-10">
      <div
        role="tabpanel"
        className="profile-enter mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6 xl:max-w-6xl"
      >
        {activeTab === 'preview' && data && <ResourcePreviewContent node={data.node} />}
      </div>
    </div>
  );
}

// ── Connector nodes → Connector + Context/Raw ────────────────────────────────

// The note IS the connector — frontmatter is the config, body is the docs — but
// the note is not the whole truth: whether the secrets it references are stored,
// and whether a call through it actually works, live outside the vault. That's
// what the first tab shows, so it exists for the people who can act on it and
// only for them. Reading connector config is admin-only at the API (see the
// connectors routes), so a member gets the note and nothing else rather than a
// tab that 403s.
const CONNECTOR_FIRST_TAB: PaneTabItem = { id: 'about', label: 'Connector' };

function ConnectorRoute({ nodeId }: { nodeId: string }) {
  const { isAdmin, loading } = useSpace();

  // isAdmin is false until memberships resolve; branching on it early would
  // mount the member view and then swap the whole page a beat later.
  if (loading) return <ProfileSkeletonLoader mode="fullpage" />;

  return isAdmin ? (
    <NodePage
      nodeId={nodeId}
      firstTab={CONNECTOR_FIRST_TAB}
      ariaLabel="Connector sections"
      notFoundTitle="Couldn't load this connector."
      renderBody={(id) => <ConnectorPageContent nodeId={id} />}
    />
  ) : (
    <ContextOnlyPage
      nodeId={nodeId}
      ariaLabel="Connector sections"
      notFoundTitle="Couldn't load this connector."
    />
  );
}

// ── Model nodes → Model + Context/Raw ─────────────────────────────────────────

// The note IS the model (Context/Raw): which provider, which model id. What it
// cannot say — whether the key is stored, what running on it cost, who ran on
// it — is the first tab, and it is the space's bill, so like a connector's tab
// it exists for admins and a member gets the note alone.
const MODEL_FIRST_TAB: PaneTabItem = { id: 'about', label: 'Model' };

function ModelRoute({ nodeId }: { nodeId: string }) {
  const { isAdmin, loading } = useSpace();
  if (loading) return <ProfileSkeletonLoader mode="fullpage" />;
  return isAdmin ? (
    <NodePage
      nodeId={nodeId}
      firstTab={MODEL_FIRST_TAB}
      ariaLabel="Model sections"
      notFoundTitle="Couldn't load this model."
      renderBody={(id) => <ModelPageContent nodeId={id} />}
    />
  ) : (
    <ContextOnlyPage nodeId={nodeId} ariaLabel="Model sections" notFoundTitle="Couldn't load this model." />
  );
}

// ── Agent nodes → Agent + Context/Raw ─────────────────────────────────────────

// The note IS the brief (Context/Raw), but whether the agent is on, when it
// next fires and what its runs did live outside the note. Unlike connectors,
// every member gets the tab: the roster is member-visible by design and the
// API strips the money for non-admins.
const AGENT_FIRST_TAB: PaneTabItem = { id: 'about', label: 'Agent' };

function AgentRoute({ nodeId }: { nodeId: string }) {
  return (
    <NodePage
      nodeId={nodeId}
      firstTab={AGENT_FIRST_TAB}
      ariaLabel="Agent sections"
      notFoundTitle="Couldn't load this agent."
      renderBody={(id) => <AgentPageContent nodeId={id} />}
    />
  );
}

// ── Tool nodes → Tool + Context/Raw ───────────────────────────────────────────

// The note IS the Tool — `tools/<name>/index.md` is its config and docs, and
// `ui.md`/`data.md` beside it are its source, all reachable from the Context
// tab's notes strip. What the notes can't say is whether it compiles, what its
// declared reach costs this space, and where it stands in the marketplace; that
// is the first tab.
//
// Every member gets it, like an agent and unlike a connector: members author
// Tools (lib/tools/service.ts), the authoring route is grant-gated rather than
// admin-gated, and the actions that aren't a member's — Publish — are the ones
// the tab hides.
const TOOL_FIRST_TAB: PaneTabItem = { id: 'about', label: 'Tool' };

function ToolRoute({ nodeId }: { nodeId: string }) {
  return (
    <NodePage
      nodeId={nodeId}
      firstTab={TOOL_FIRST_TAB}
      ariaLabel="Tool sections"
      notFoundTitle="Couldn't load this Tool."
      renderBody={(id) => <ToolPageContent nodeId={id} />}
    />
  );
}

// ── Route entry ───────────────────────────────────────────────────────────────

const noop = () => {};

// Bare /directory/event:… (no note tab asked for) belongs on the dedicated
// event page; ?tab=context/raw stays here as the event's context surface.
function EventRoute({ nodeId }: { nodeId: string }) {
  const [wantedTab] = useProfileTabParam();
  const href = `/events/${encodeURIComponent(nodeId)}`;
  return wantedTab ? (
    <NoteOnlyPage
      nodeId={nodeId}
      firstTab={EVENT_FIRST_TAB}
      href={href}
      ariaLabel="Event sections"
      notFoundTitle="Couldn't load this event."
    />
  ) : (
    <PageRedirect href={href} />
  );
}

/** The id of the live space this node stands for, or null if the node is a
 *  record with no space behind it.
 *
 *  Two node shapes have a real workspace:
 *
 *   * The node standing for the space you are IN. `isOwnSpaceNode` spots
 *     it, and the space id comes off the NODE rather than the id string.
 *     `spaceNodeId` only prefixes an id that lacks one, so a space
 *     already called `space:blackbird-ventures` has a node id identical to
 *     its space id — stripping `space:` there would 404 — while a
 *     space called `blackbird` gets the node id `space:blackbird` and
 *     does need the prefix gone. The node's own `space_id` is right in both.
 *   * A record carrying `metadata.spaceRef` — the field the create flow
 *     writes (createEntity, /api/nodes/search) when the thing you are recording
 *     is a space that actually runs here. Its `space_id` is the graph it
 *     was filed in, NOT the space it names, so the ref is the only honest
 *     answer.
 *
 *  Everything else is a record with nothing to redirect to.
 */
function liveSpaceId(node: NBNode | null, nodeId: string): string | null {
  if (!node) return null;
  const spaceId = node.space_id ?? null;
  if (isOwnSpaceNode({ id: node.id ?? nodeId, spaceId })) return spaceId;
  const ref = node.metadata?.spaceRef;
  return typeof ref === 'string' && ref.trim() ? ref.trim() : null;
}

// Every `space:` node gets a space page — the type is the page, whether
// the space runs here or is only recorded here for CRM. What differs is
// where the page comes from:
//
//  * A live space (its own node, or a record pointing at one via
//    `spaceRef`) has a workspace, members and events, so it redirects to
//    /spaces/<id> and that page renders from the overview API.
//  * A record has none of those, so it renders here from the node itself —
//    SpacePageContent, same visual language, minus the parts that need a
//    membership. Redirecting it would throw the reader out of the space
//    they were browsing and into a workspace that doesn't exist.
//
// Both need the node before they can decide, which is why this waits for it.
function SpaceRoute({ nodeId }: { nodeId: string }) {
  const [wantedTab] = useProfileTabParam();
  const { data, error } = useNodeProfile(nodeId);
  const node = data?.node ?? null;
  const liveId = liveSpaceId(node, nodeId);
  const href = liveId ? `/spaces/${encodeURIComponent(liveId)}` : null;

  // Null while the node is still loading: hold the redirect branch's skeleton
  // rather than flashing a page shell we may not want.
  if (node && !liveId) {
    return (
      <NodePage
        nodeId={nodeId}
        firstTab={SPACE_FIRST_TAB}
        ariaLabel="Space sections"
        notFoundTitle="Couldn't load this space."
        renderBody={(id) => <SpacePageContent nodeId={id} />}
      />
    );
  }

  if (wantedTab) {
    return (
      <NoteOnlyPage
        nodeId={nodeId}
        firstTab={SPACE_FIRST_TAB}
        href={href ?? '/spaces'}
        ariaLabel="Space sections"
        notFoundTitle="Couldn't load this space."
      />
    );
  }
  // A node that can't be read has no space to send us to; the index lists
  // every space the viewer can reach, which beats a dead end.
  return <PageRedirect href={error ? '/spaces' : href} />;
}

// A dedicated page lives outside the pane shell. Register empty chrome while the
// redirect is in flight, or the previous page's bar (and its note surface) would
// sit over the skeleton. A null href means the destination is still resolving —
// hold the skeleton rather than navigating somewhere wrong.
function PageRedirect({ href }: { href: string | null }) {
  const router = useSpaceRouter();
  useEffect(() => {
    if (href) router.replace(href);
  }, [href, router]);
  usePaneChrome({ tabs: null, activeId: null, onSelect: noop, attachedOpen: false, surface: null });
  return <ProfileSkeletonLoader mode="fullpage" />;
}

function NodeRoute() {
  const params = useParams();
  const nodeId = typeof params.nodeId === 'string' ? decodeURIComponent(params.nodeId) : '';

  if (nodeId.startsWith('event:')) {
    return <EventRoute nodeId={nodeId} />;
  }
  if (nodeId.startsWith('space:')) {
    return <SpaceRoute nodeId={nodeId} />;
  }
  if (nodeId.startsWith('person:')) {
    return <PersonRoute nodeId={nodeId} />;
  }
  if (nodeId.startsWith('resource:')) {
    return <ResourceNodePage nodeId={nodeId} />;
  }
  if (nodeId.startsWith('connector:')) {
    return <ConnectorRoute nodeId={nodeId} />;
  }
  if (nodeId.startsWith('model:')) {
    return <ModelRoute nodeId={nodeId} />;
  }
  if (nodeId.startsWith('agent:')) {
    return <AgentRoute nodeId={nodeId} />;
  }
  if (nodeId.startsWith('tool:')) {
    return <ToolRoute nodeId={nodeId} />;
  }
  if (isOrgId(nodeId)) {
    return (
      <NodePage
        nodeId={nodeId}
        firstTab={ORG_FIRST_TAB}
        ariaLabel="Page sections"
        notFoundTitle="Couldn't load this page."
        renderBody={(id) => <OrgPageContent nodeId={id} />}
      />
    );
  }
  // Channels, spaces, files, and any type that hasn't earned a page: the context
  // note is the whole of it.
  return (
    <ContextOnlyPage
      nodeId={nodeId}
      ariaLabel="Context sections"
      notFoundTitle="Couldn't load this page."
    />
  );
}

export default function NodePageRoute() {
  // Suspense boundary: the tab components read useSearchParams (?tab=context).
  return (
    <Suspense fallback={<ProfileSkeletonLoader mode="fullpage" />}>
      <NodeRoute />
    </Suspense>
  );
}
