'use client';

// Entity routes. The pane chrome (tab bar, docked tree, note panel) lives in the
// persistent shell (directory/layout.tsx → PaneShell); these pages keep the
// deciding logic — node-type dispatch, ?tab= semantics, Context-tab
// availability, deep-link resolution — and register the resulting chrome with
// the shell. Only non-note bodies render here as page children.
//
// A node only earns a first tab when there is something behind it that isn't the
// context note. People get a profile, organisations an Overview, connectors
// their configuration, resources a preview, and events/communities a link out to
// their dedicated routes (/events/<id>, /communities/<id>). Everything else —
// channels, spaces, notes, files, any type we haven't given a page — is nothing
// but its context, so those get Context/Raw and no first tab at all.

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useNodeProfile } from '@/hooks/useNodeProfile';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { isFeatureEnabled } from '@/lib/featureAccess';
import { entityKindOf, entityNotePath } from '@/lib/notes/entities';
import { isOwnCommunityNode } from '@/lib/types/context';
import type { CommunityFeatureConfig, NBNode } from '@/lib/types';
import ProfileSkeletonLoader from '@/components/profile/ProfileSkeletonLoader';
import { type NoteMode } from '@/features/notes/components/NoteModeToggle';
import { usePrefetchEntityContext } from '@/features/notes/lib/contextPrefetch';
import { usePaneChrome, type PaneTabItem } from '@/lib/contexts/PaneShellContext';
import ProfilePageContent from '@/components/profile/ProfilePageContent';
import OrgPageContent from '@/components/profile/OrgPageContent';
import ResourcePreviewContent from '@/components/profile/ResourcePreviewContent';

/** URL-level tab ids. Kept as a type for the ?tab= plumbing — the bar itself
 *  takes plain string ids via the shell registration. */
type ProfileTab = 'about' | 'context' | 'raw' | 'preview' | 'connections' | 'communities';

/** The entity's canonical note path — what the tree highlights. */
function useEntityNotePath(nodeId: string, node: NBNode | null): string | null {
  return node ? entityNotePath({ id: nodeId, type: node.type }) : null;
}

// A profile carries a Context tab when the notes tool is enabled, the node is an
// entity kind (the types with canonical context-note namespaces), and the node
// belongs to the current community (its brain owns the note).
function useContextTabAvailable(node: NBNode | null): boolean {
  const { currentCommunity } = useCommunity();
  const featureConfig = (currentCommunity?.featureConfig as CommunityFeatureConfig | undefined) ?? null;
  return (
    !!currentCommunity &&
    isFeatureEnabled(featureConfig, 'notes') &&
    !!node &&
    entityKindOf(node.type) !== null &&
    (!node.community_id || node.community_id === currentCommunity.id)
  );
}

// Tab state lives in the URL (?tab=context / ?tab=raw) so tree/context/backlink
// deep links land directly on an entity's context. Default tab = bare URL.
// Context and Raw are the same note behind the same availability gate — Raw is
// just the editor in raw mode, promoted to a tab of its own.
function useProfileTabParam(): [ProfileTab | null, (tab: ProfileTab) => void] {
  const router = useRouter();
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

function NotFoundState({ title }: { title: string }) {
  const router = useRouter();
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="text-5xl">😕</div>
      <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-border-default rounded-xl hover:bg-surface-2 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Go back
      </button>
    </div>
  );
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
  ariaLabel: string;
  onSelect: (id: string) => void;
}): void {
  const { firstTab, activeTab, nodeId, notePath, loading, error, contextAvailable } = args;
  const noteTab = isNoteTab(activeTab);
  const hasContext = loading ? noteTab : contextAvailable;

  // With no first tab the bar is the note's own two tabs — and if there's no
  // context either there is nothing left to show, so the bar goes away.
  const tabs = hasContext
    ? firstTab
      ? [firstTab, CONTEXT_TAB, RAW_TAB]
      : [CONTEXT_TAB, RAW_TAB]
    : firstTab
      ? [firstTab]
      : null;

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

function PersonProfilePage({ nodeId }: { nodeId: string }) {
  // Deduped + cached alongside ProfilePageContent's own fetch; needed here for
  // the community-membership half of the Context-tab condition.
  const { data, loading: nodeLoading } = useNodeProfile(nodeId);
  const node = data?.node ?? null;
  const { currentCommunity, loading: communityLoading } = useCommunity();
  const contextAvailable = useContextTabAvailable(node);
  const [wantedTab, setTabParam] = useProfileTabParam();

  const activeTab: ProfileTab = wantedTab && contextAvailable ? wantedTab : 'about';
  const notePath = useEntityNotePath(nodeId, node);
  // Warm the Context tab (Tiptap chunk + note/registry/config fetches) as soon
  // as the profile knows the tab exists, so clicking over paints immediately.
  usePrefetchEntityContext(nodeId, node, contextAvailable);
  // Deep link to ?tab=context/raw while community/node data still resolves: keep
  // the predicted bar + docked tree up instead of blinking them out for the
  // length of the fetch.
  const stillResolving = wantedTab !== null && !contextAvailable && (communityLoading || nodeLoading || !currentCommunity);
  const noteSurface = stillResolving || (contextAvailable && isNoteTab(activeTab));
  // activeTab falls back to 'about' until contextAvailable resolves, but while
  // resolving the URL's tab is where we're heading — underlining it keeps the
  // bar from correcting itself a beat after arrival.
  const barTab: ProfileTab = stillResolving && wantedTab ? wantedTab : activeTab;

  const handleSelect = useCallback((id: string) => setTabParam(id as ProfileTab), [setTabParam]);

  const barVisible = contextAvailable || stillResolving;
  usePaneChrome({
    tabs: barVisible ? PERSON_TABS : null,
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
    if (wantedTab && !contextAvailable && !communityLoading && !nodeLoading && currentCommunity && node) {
      setTabParam('about');
    }
  }, [wantedTab, contextAvailable, communityLoading, nodeLoading, currentCommunity, node, setTabParam]);

  // Note surfaces are entirely shell-rendered (PaneSurfaceHost).
  if (noteSurface) return null;

  return (
    <div className="w-full pb-10">
      {/* No outer card wrapper — ProfilePageContent renders separate floating
          cards on the page background. profile-enter stays on the content only:
          the persistent bar above it must not play an entrance. */}
      <div className="profile-enter mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6 xl:max-w-6xl">
        <ProfilePageContent nodeId={nodeId} />
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
// retired spellings before settling on `community:`, all of which now land on
// communities/<slug>.md. Current data never reaches this list: a `community:`
// id is forked on by CommunityRoute instead, which needs the node to tell a
// record apart from the community itself. An id with no prefix at all is a
// legacy directory row: those predate the structural types entirely, so an
// organisation is the right guess for them too.
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

  // Tab changes keep local state (instant) and the URL (?tab=context) in sync.
  const changeTab = useCallback(
    (tab: ProfileTab) => {
      setActiveTab(tab);
      setTabParam(tab);
    },
    [setTabParam],
  );
  const handleSelect = useCallback((id: string) => changeTab(id as ProfileTab), [changeTab]);

  // A tab with no panel behind it falls back to the first tab: ?tab=connections
  // and ?tab=communities are retired links, and context resolves late (tool off
  // / non-entity node), so it can only be judged once the node has loaded.
  useEffect(() => {
    const retired = activeTab === 'connections' || activeTab === 'communities';
    const staleContext = isNoteTab(activeTab) && !loading && data && !contextAvailable;
    if (retired || staleContext) {
      changeTab('about');
    }
  }, [activeTab, loading, data, contextAvailable, changeTab]);

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

  return (
    <div className="w-full pb-10">
      <div
        role="tabpanel"
        className="profile-enter mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6 xl:max-w-6xl"
      >
        {activeTab === 'about' && renderBody(nodeId)}
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

  const changeTab = useCallback(
    (tab: ProfileTab) => {
      setActiveTab(tab);
      setTabParam(tab);
    },
    [setTabParam],
  );
  const handleSelect = useCallback((id: string) => changeTab(id as ProfileTab), [changeTab]);

  // Only the two note tabs exist here, so anything else (a retired deep link)
  // lands back on Context.
  useEffect(() => {
    if (!isNoteTab(activeTab)) changeTab('context');
  }, [activeTab, changeTab]);

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
    ariaLabel,
    onSelect: handleSelect,
  });

  if (errorState) return <NotFoundState title={notFoundTitle} />;
  // The note surface is shell-rendered; while loading the predicted bar and the
  // docked tree already stand in for it.
  if (loadingState || contextAvailable) return null;

  // Notes tool off, or the node belongs to another community's brain: there is
  // no note to show and nothing else this page could offer.
  return <NotFoundState title="No context for this yet" />;
}

// ── Nodes owning a page elsewhere → Context/Raw here, the page for the rest ──

// Events and communities have dedicated pages (/events/<id>, /communities/<id>)
// rather than anything profile-shaped, but their context note is a first-class
// note like any entity's — the tree, backlinks and [[mentions]] all deep-link to
// /directory/<id>?tab=context. So note tabs render here, and the first tab jumps
// out to the real page.
const EVENT_FIRST_TAB: PaneTabItem = { id: 'about', label: 'Event' };
const COMMUNITY_FIRST_TAB: PaneTabItem = { id: 'about', label: 'Community' };

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
  const router = useRouter();
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

  const changeTab = useCallback(
    (tab: ProfileTab) => {
      setActiveTab(tab);
      setTabParam(tab);
    },
    [setTabParam],
  );
  const handleSelect = useCallback((id: string) => changeTab(id as ProfileTab), [changeTab]);

  // Anything but preview/available-context falls back to Preview (retired deep
  // links, or ?tab=context when the notes tool is off for this community).
  useEffect(() => {
    const staleContext = isNoteTab(activeTab) && !loading && data && !contextAvailable;
    if ((activeTab !== 'preview' && !isNoteTab(activeTab)) || staleContext) {
      changeTab('preview');
    }
  }, [activeTab, loading, data, contextAvailable, changeTab]);

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
    ariaLabel: 'Resource sections',
    onSelect: handleSelect,
  });

  if (loadingState) {
    return isNoteTab(activeTab) ? null : <ProfileSkeletonLoader mode="fullpage" />;
  }

  if (errorState) return <NotFoundState title="Resource not found" />;

  if (noteSurface) return null;

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
      notFoundTitle="Event not found"
    />
  ) : (
    <PageRedirect href={href} />
  );
}

// `community:` ids cover two different things, so this route forks on which.
//
//  * The node standing for the community you are IN. Its page is
//    /communities/<id>; the node only exists here to carry its context note.
//  * An organisation recorded inside that community — what used to be the Group
//    type. It is a directory record like any other and keeps its profile here.
//    Redirecting it would throw the reader out of the community they were
//    browsing and into a workspace that may not even exist.
//
// `isOwnCommunityNode` tells them apart, and the community id comes off the
// NODE rather than the id string. `communityNodeId` only prefixes an id that
// lacks one, so a community already called `community:local-dev` has a node id
// identical to its community id — stripping `community:` there would redirect
// to a 404 — while a community called `blackbird` gets the node id
// `community:blackbird` and does need the prefix gone. The node's own
// `community_id` is the right answer in both cases, which is why this waits for
// the node before deciding anything.
function CommunityRoute({ nodeId }: { nodeId: string }) {
  const [wantedTab] = useProfileTabParam();
  const { data, error } = useNodeProfile(nodeId);
  const node = data?.node ?? null;
  const communityId = node?.community_id ?? null;
  const href = communityId ? `/communities/${encodeURIComponent(communityId)}` : null;

  // Null while the node is still loading: hold the redirect branch's skeleton
  // rather than flashing a profile shell we may not want.
  if (node && !isOwnCommunityNode({ id: node.id ?? nodeId, communityId })) {
    return (
      <NodePage
        nodeId={nodeId}
        firstTab={ORG_FIRST_TAB}
        ariaLabel="Page sections"
        notFoundTitle="Page not found"
        renderBody={(id) => <OrgPageContent nodeId={id} />}
      />
    );
  }

  if (wantedTab) {
    return (
      <NoteOnlyPage
        nodeId={nodeId}
        firstTab={COMMUNITY_FIRST_TAB}
        href={href ?? '/communities'}
        ariaLabel="Community sections"
        notFoundTitle="Community not found"
      />
    );
  }
  // A node that can't be read has no community to send us to; the index lists
  // every community the viewer can reach, which beats a dead end.
  return <PageRedirect href={error ? '/communities' : href} />;
}

// A dedicated page lives outside the pane shell. Register empty chrome while the
// redirect is in flight, or the previous page's bar (and its note surface) would
// sit over the skeleton. A null href means the destination is still resolving —
// hold the skeleton rather than navigating somewhere wrong.
function PageRedirect({ href }: { href: string | null }) {
  const router = useRouter();
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
  if (nodeId.startsWith('community:')) {
    return <CommunityRoute nodeId={nodeId} />;
  }
  if (nodeId.startsWith('person:')) {
    return <PersonProfilePage nodeId={nodeId} />;
  }
  if (nodeId.startsWith('resource:')) {
    return <ResourceNodePage nodeId={nodeId} />;
  }
  if (nodeId.startsWith('connector:')) {
    // The note IS the connector — frontmatter is the config, the body is the doc
    // agents read — so there is nothing left for a first tab to show.
    return (
      <ContextOnlyPage
        nodeId={nodeId}
        ariaLabel="Connector sections"
        notFoundTitle="Connector not found"
      />
    );
  }
  if (isOrgId(nodeId)) {
    return (
      <NodePage
        nodeId={nodeId}
        firstTab={ORG_FIRST_TAB}
        ariaLabel="Page sections"
        notFoundTitle="Page not found"
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
      notFoundTitle="Page not found"
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
