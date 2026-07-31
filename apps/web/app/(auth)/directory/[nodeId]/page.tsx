'use client';

// Entity profile routes. The pane chrome (tab bar, docked tree, note panel)
// lives in the persistent shell (directory/layout.tsx → PaneShell); these pages
// keep the deciding logic — node-type dispatch, ?tab= semantics, Context-tab
// availability, deep-link resolution — and register the resulting chrome with
// the shell. Only non-note bodies render here as page children.

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useNodeProfile } from '@/hooks/useNodeProfile';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { isFeatureEnabled } from '@/lib/featureAccess';
import { entityKindOf, entityNotePath } from '@/lib/notes/entities';
import type { CommunityFeatureConfig, NBNode } from '@/lib/types';
import ProfileSkeletonLoader from '@/components/profile/ProfileSkeletonLoader';
import { type NoteMode } from '@/features/notes/components/NoteModeToggle';
import { usePrefetchEntityContext } from '@/features/notes/lib/contextPrefetch';
import { usePaneChrome, type PaneTabItem } from '@/lib/contexts/PaneShellContext';
import ProfilePageContent from '@/components/profile/ProfilePageContent';
import NodeProfileContent from '@/components/profile/NodeProfileContent';
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
  firstTab: PaneTabItem;
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

  usePaneChrome({
    tabs: error ? null : hasContext ? [firstTab, CONTEXT_TAB, RAW_TAB] : [firstTab],
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

// ── Non-person nodes → classic tab view (+ Context tab for orgs) ─────────────

const NODE_FIRST_TAB: PaneTabItem = { id: 'about', label: 'Profile' };

function NodeTabPage({ nodeId }: { nodeId: string }) {
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

  // A tab with no panel behind it falls back to Profile: ?tab=connections and
  // ?tab=communities are retired links, and context resolves late (tool off /
  // non-entity node), so it can only be judged once the node has loaded.
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
    firstTab: NODE_FIRST_TAB,
    activeTab,
    nodeId,
    notePath,
    loading: loadingState,
    error: errorState,
    contextAvailable,
    ariaLabel: 'Profile sections',
    onSelect: handleSelect,
  });

  if (loadingState) {
    // Note-tab arrivals keep the predicted bar + docked tree with an empty body
    // — the note that follows reveals on data.
    return isNoteTab(activeTab) ? null : <ProfileSkeletonLoader mode="fullpage" />;
  }

  if (errorState) return <NotFoundState title="Profile not found" />;

  if (noteSurface) return null;

  return (
    <div className="w-full pb-10">
      <div
        role="tabpanel"
        className="profile-enter mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6 xl:max-w-6xl"
      >
        {activeTab === 'about' && <NodeProfileContent nodeId={nodeId} />}
      </div>
    </div>
  );
}

// ── Event nodes → Context/Raw here, the event page for everything else ───────

// Events have a dedicated detail page instead of a generic profile, but their
// context note is a first-class note like any entity's — the tree, backlinks
// and [[mentions]] all deep-link to /directory/event:…?tab=context. So note
// tabs render here, and the first tab jumps to the real event page.
const EVENT_FIRST_TAB: PaneTabItem = { id: 'about', label: 'Event' };

function EventContextPage({ nodeId }: { nodeId: string }) {
  const { data, loading, error } = useNodeProfile(nodeId);
  const node = data?.node ?? null;
  const contextAvailable = useContextTabAvailable(node);
  const [wantedTab, setTabParam] = useProfileTabParam();
  const [activeTab, setActiveTab] = useState<ProfileTab>(wantedTab ?? 'context');
  const router = useRouter();
  usePrefetchEntityContext(nodeId, node, contextAvailable);
  const notePath = useEntityNotePath(nodeId, node);
  const noteSurface = isNoteTab(activeTab) && contextAvailable;

  const eventHref = `/events/${encodeURIComponent(nodeId)}`;

  // The Event tab is a link out, not a panel: the event's real page owns
  // everything that isn't the context note.
  const changeTab = useCallback(
    (tab: ProfileTab) => {
      if (!isNoteTab(tab)) {
        router.push(eventHref);
        return;
      }
      setActiveTab(tab);
      setTabParam(tab);
    },
    [router, eventHref, setTabParam],
  );
  const handleSelect = useCallback((id: string) => changeTab(id as ProfileTab), [changeTab]);

  // Context resolved as unavailable (notes tool off / foreign node): there is
  // nothing to render here, so fall through to the event page.
  useEffect(() => {
    const staleContext = isNoteTab(activeTab) && !loading && data && !contextAvailable;
    if (staleContext) router.replace(eventHref);
  }, [activeTab, loading, data, contextAvailable, router, eventHref]);

  const loadingState = loading && !data;
  const errorState = !loadingState && (!!error || !data);

  usePaneChrome({
    tabs: errorState ? null : [EVENT_FIRST_TAB, CONTEXT_TAB, RAW_TAB],
    activeId: errorState ? null : activeTab,
    onSelect: handleSelect,
    attachedOpen: !errorState && activeTab === 'context',
    ariaLabel: 'Event sections',
    surface: errorState
      ? null
      : loadingState || !contextAvailable
        ? { kind: 'tree-only', notePath: null }
        : noteSurface
          ? { kind: 'entity', nodeId, notePath, mode: modeForTab(activeTab) }
          : null,
  });

  if (errorState) return <NotFoundState title="Event not found" />;

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
  return wantedTab ? <EventContextPage nodeId={nodeId} /> : <EventRedirect nodeId={nodeId} />;
}

// The event detail page lives outside the pane shell. Register empty chrome
// while the redirect is in flight, or the previous page's bar (and its note
// surface) would sit over the skeleton.
function EventRedirect({ nodeId }: { nodeId: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/events/${encodeURIComponent(nodeId)}`);
  }, [nodeId, router]);
  usePaneChrome({ tabs: null, activeId: null, onSelect: noop, attachedOpen: false, surface: null });
  return <ProfileSkeletonLoader mode="fullpage" />;
}

function NodeProfileRoute() {
  const params = useParams();
  const nodeId = typeof params.nodeId === 'string' ? decodeURIComponent(params.nodeId) : '';

  if (nodeId.startsWith('event:')) {
    return <EventRoute nodeId={nodeId} />;
  }
  if (nodeId.startsWith('person:')) {
    return <PersonProfilePage nodeId={nodeId} />;
  }
  if (nodeId.startsWith('resource:')) {
    return <ResourceNodePage nodeId={nodeId} />;
  }
  return <NodeTabPage nodeId={nodeId} />;
}

export default function NodeProfilePage() {
  // Suspense boundary: the tab components read useSearchParams (?tab=context).
  return (
    <Suspense fallback={<ProfileSkeletonLoader mode="fullpage" />}>
      <NodeProfileRoute />
    </Suspense>
  );
}
