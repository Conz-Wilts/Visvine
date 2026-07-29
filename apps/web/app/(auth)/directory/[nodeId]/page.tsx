'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useNodeProfile } from '@/hooks/useNodeProfile';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { isFeatureEnabled } from '@/lib/featureAccess';
import { entityKindOf, entityNotePath } from '@/lib/notes/entities';
import { useContextPanel } from '@/lib/contexts/ContextPanelContext';
import { CONTEXT_PANEL_W } from '@/features/shared/components/layout/Sidebar';
import type { CommunityFeatureConfig, NBNode } from '@/lib/types';
import ProfileSkeletonLoader from '@/components/profile/ProfileSkeletonLoader';
import ProfileTabBar, { type ProfileTab, type TabConfig } from '@/components/profile/ProfileTabBar';
import { type NoteMode } from '@/features/notes/components/NoteModeToggle';
import { usePrefetchEntityContext } from '@/features/notes/lib/contextPrefetch';
import { TabBarSlotProvider } from '@/lib/contexts/TabBarSlotContext';
import ProfilePageContent from '@/components/profile/ProfilePageContent';
import NodeProfileContent from '@/components/profile/NodeProfileContent';
import ResourcePreviewContent from '@/components/profile/ResourcePreviewContent';

// The Context tab pulls in Tiptap + the notes stack; load it only when a tab
// actually renders it (same rationale as the directory's deferred context view).
const EntityContextPanel = dynamic(
  () => import('@/features/notes/components/EntityContextPanel').then((m) => m.EntityContextPanel),
  { ssr: false, loading: () => null },
);

const ContextSidebar = dynamic(
  () => import('@/features/notes/components/ContextSidebar').then((m) => m.ContextSidebar),
  { ssr: false, loading: () => null },
);

// ── Docked context tree ───────────────────────────────────────────────────────

// An entity's Context tab is a note view like any other, so it keeps the same
// tree docked in the Sidebar that /context and the standalone note view use.
// Without it, opening a person from the context tree collapsed the whole panel
// column mid-navigation — the tree you just clicked in vanished under you.
// Mounted only while a note tab is open; switching back to Profile lowers the
// dock and the column closes.
function DockedContextTree({ notePath }: { notePath: string | null }) {
  const { setDockTopInset } = useContextPanel();

  // Start the tree below the tab bar: ProfileTabBar stacks the tab row and its
  // attached toolbar, both h-12 — same 96px the standalone note view sets.
  useEffect(() => {
    setDockTopInset(96);
    return () => setDockTopInset(0);
  }, [setDockTopInset]);

  return <ContextSidebar currentPath={notePath} />;
}

/** Inset for the note content while the tree is docked AND open, so the panel
 *  column never covers it. Mirrors the standalone note view. */
function useDockInsetStyle(): React.CSSProperties {
  const { dockRequested, contextOpen } = useContextPanel();
  return {
    paddingLeft: dockRequested && contextOpen ? CONTEXT_PANEL_W : undefined,
    transition: 'padding-left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
  };
}

/** The tab bar bleeds over the docked tree (raised z) so it reads as one
 *  continuous bar across the top rather than starting at the tree's right edge —
 *  see ProfileTabBar's edgeClass. Only while the tree is actually docked. */
function useTabBarEdgeClass(): string | undefined {
  const { dockRequested, contextOpen } = useContextPanel();
  return dockRequested && contextOpen ? '-ml-[23px] z-[45]' : undefined;
}

/** The entity's canonical note path — what the tree highlights. */
function useEntityNotePath(nodeId: string, node: NBNode | null): string | null {
  return node ? entityNotePath({ id: nodeId, type: node.type }) : null;
}

// ── Context-tab availability ──────────────────────────────────────────────────

// A profile carries a Context tab when the notes tool is enabled, the node is an
// entity kind (person/org/resource — the types with canonical context-note namespaces),
// and the node belongs to the current community (its brain owns the note).
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

// ── Person nodes → LinkedIn profile (+ Context tab) ──────────────────────────

const PERSON_TABS: TabConfig[] = [
  { id: 'about', label: 'Profile' },
  { id: 'context', label: 'Context' },
  { id: 'raw', label: 'Raw' },
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
  const dockInsetStyle = useDockInsetStyle();
  const edgeClass = useTabBarEdgeClass();
  // Warm the Context tab (Tiptap chunk + note/registry/config fetches) as soon
  // as the profile knows the tab exists, so clicking over paints immediately.
  usePrefetchEntityContext(nodeId, node, contextAvailable);
  // Deep link to ?tab=context/raw while community/node data still resolves: hold
  // a skeleton instead of flashing the profile and then swapping.
  const stillResolving = wantedTab !== null && !contextAvailable && (communityLoading || nodeLoading || !currentCommunity);
  // Note surface = the docked tree is (or is about to be) beside the content, so
  // the content insets to clear it and drops the centered profile container.
  const noteSurface = stillResolving || (contextAvailable && isNoteTab(activeTab));

  // Strip a stale ?tab=context/raw (tool off / non-entity / foreign node) once
  // everything needed to decide has resolved.
  useEffect(() => {
    if (wantedTab && !contextAvailable && !communityLoading && !nodeLoading && currentCommunity && node) {
      setTabParam('about');
    }
  }, [wantedTab, contextAvailable, communityLoading, nodeLoading, currentCommunity, node, setTabParam]);

  return (
    // Full-width shell: the sticky bars' divider lines run edge to edge across
    // the pane; non-context content re-applies the centered container below.
    // The provider spans the tab bar and the panel so the Context tab's editor
    // can portal its toolbar into the tab bar's attached region.
    <TabBarSlotProvider>
      <div className="profile-enter w-full pb-10">
        {/* ProfileTabBar must be a DIRECT child of the tall page container so its
            `sticky` has scroll range — a thin wrapper would confine it and it'd
            scroll away. Spacing below the tabs lives on the content instead.
            stickyTop is "-top-4 -mt-4" (not top-0): the <main> scroll container
            has pt-4 and sticky offsets resolve from below that padding — top-0
            would pin the bar 16px short of the navbar, letting content show in
            the gap. -mt-4 pulls the bar over that padding at rest too, so it
            sits flush under the navbar and never shifts when it pins. */}
        {contextAvailable && (
          <ProfileTabBar
            nodeType="Person" tabs={PERSON_TABS} activeTab={activeTab} onTabChange={setTabParam} stickyTop="-top-4 -mt-4"
            attachedOpen={activeTab === 'context'}
            edgeClass={isNoteTab(activeTab) ? edgeClass : undefined}
          />
        )}
        <div
          className={noteSurface ? '' : 'mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6 xl:max-w-6xl'}
          style={noteSurface ? dockInsetStyle : undefined}
        >
        {stillResolving ? (
          // The tree docks while the node still resolves too: arriving from it,
          // the panel must not blink shut for the length of a profile fetch.
          <>
            <DockedContextTree notePath={null} />
            <ProfileSkeletonLoader mode="fullpage" />
          </>
        ) : isNoteTab(activeTab) ? (
          <>
            <DockedContextTree notePath={notePath} />
            <EntityContextPanel nodeId={nodeId} mode={modeForTab(activeTab)} />
          </>
        ) : (
          /* No outer card wrapper — ProfilePageContent renders separate floating
             cards directly on the page background, matching the event detail page. */
          <ProfilePageContent nodeId={nodeId} />
        )}
        </div>
      </div>
    </TabBarSlotProvider>
  );
}

// ── Non-person nodes → classic tab view (+ Context tab for orgs) ─────────────

function NodeTabPage({ nodeId }: { nodeId: string }) {
  const { data, loading, error } = useNodeProfile(nodeId);
  const node = data?.node ?? null;
  const contextAvailable = useContextTabAvailable(node);
  const [wantedTab, setTabParam] = useProfileTabParam();
  const [activeTab, setActiveTab] = useState<ProfileTab>(wantedTab ?? 'about');
  const router = useRouter();
  // Same warm-start as the person page: prefetch the Context tab's chunk + data
  // while the user is still on Profile.
  usePrefetchEntityContext(nodeId, node, contextAvailable);
  const notePath = useEntityNotePath(nodeId, node);
  const dockInsetStyle = useDockInsetStyle();
  const edgeClass = useTabBarEdgeClass();

  // Tab changes keep local state (instant) and the URL (?tab=context) in sync.
  const changeTab = useCallback(
    (tab: ProfileTab) => {
      setActiveTab(tab);
      setTabParam(tab);
    },
    [setTabParam],
  );

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

  // Keep the tree docked through the node fetch when the URL already asks for a
  // note tab — otherwise arriving from the tree blinks the panel shut and open.
  if (loading && !data)
    return (
      <>
        {isNoteTab(activeTab) && <DockedContextTree notePath={null} />}
        <ProfileSkeletonLoader mode="fullpage" />
      </>
    );

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="text-5xl">😕</div>
        <h2 className="text-xl font-semibold text-text-primary">Profile not found</h2>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-border-default rounded-xl hover:bg-surface-2 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Go back
        </button>
      </div>
    );
  }

  const { node: nodeData } = data;

  // Tabs mirror the person profile's top bar — the entity view lives under a
  // "Profile" tab, Context is its peer.
  const tabs: TabConfig[] = [{ id: 'about', label: 'Profile' }];
  if (contextAvailable) tabs.push({ id: 'context', label: 'Context' }, { id: 'raw', label: 'Raw' });

  return (
    // Full-width shell (see PersonProfilePage) — divider lines run edge to edge.
    // Provider spans tab bar + panel so the Context editor's toolbar can portal
    // into the tab bar's attached region.
    <TabBarSlotProvider>
      <div className="profile-enter w-full pb-10">
        {/* Direct child of the tall page container so `sticky` actually pins —
            a thin wrapper would confine it. Spacing below lives on the panel.
            "-top-4 -mt-4" cancels <main>'s pt-4 both at rest and when pinned, so
            the bar sits flush under the navbar and never shifts on scroll. */}
        <ProfileTabBar
          nodeType={nodeData.type} tabs={tabs} activeTab={activeTab} onTabChange={changeTab} stickyTop="-top-4 -mt-4"
          attachedOpen={activeTab === 'context' && contextAvailable}
          edgeClass={isNoteTab(activeTab) && contextAvailable ? edgeClass : undefined}
        />

        <div
          role="tabpanel"
          className={isNoteTab(activeTab) ? '' : 'mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6 xl:max-w-6xl'}
          style={isNoteTab(activeTab) && contextAvailable ? dockInsetStyle : undefined}
        >
          {activeTab === 'about' && <NodeProfileContent nodeId={nodeId} />}
          {isNoteTab(activeTab) && contextAvailable && (
            <>
              <DockedContextTree notePath={notePath} />
              <EntityContextPanel nodeId={nodeId} mode={modeForTab(activeTab)} />
            </>
          )}
        </div>
      </div>
    </TabBarSlotProvider>
  );
}

// ── Resource nodes → Preview + Context (no generic profile) ──────────────────

// Resources are documents/links, not people — a Connect-button profile makes no
// sense for them. Default tab is a Preview of the resource URL; Context is the
// same notes panel entities get (entityKindOf covers resources).
function ResourceNodePage({ nodeId }: { nodeId: string }) {
  const { data, loading, error } = useNodeProfile(nodeId);
  const node = data?.node ?? null;
  const contextAvailable = useContextTabAvailable(node);
  const [wantedTab, setTabParam] = useProfileTabParam();
  const [activeTab, setActiveTab] = useState<ProfileTab>(wantedTab ?? 'preview');
  const router = useRouter();
  usePrefetchEntityContext(nodeId, node, contextAvailable);
  const notePath = useEntityNotePath(nodeId, node);
  const dockInsetStyle = useDockInsetStyle();
  const edgeClass = useTabBarEdgeClass();

  const changeTab = useCallback(
    (tab: ProfileTab) => {
      setActiveTab(tab);
      setTabParam(tab);
    },
    [setTabParam],
  );

  // Anything but preview/available-context falls back to Preview (retired deep
  // links, or ?tab=context when the notes tool is off for this community).
  useEffect(() => {
    const staleContext = isNoteTab(activeTab) && !loading && data && !contextAvailable;
    if ((activeTab !== 'preview' && !isNoteTab(activeTab)) || staleContext) {
      changeTab('preview');
    }
  }, [activeTab, loading, data, contextAvailable, changeTab]);

  // Keep the tree docked through the node fetch when the URL already asks for a
  // note tab — otherwise arriving from the tree blinks the panel shut and open.
  if (loading && !data)
    return (
      <>
        {isNoteTab(activeTab) && <DockedContextTree notePath={null} />}
        <ProfileSkeletonLoader mode="fullpage" />
      </>
    );

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="text-5xl">😕</div>
        <h2 className="text-xl font-semibold text-text-primary">Resource not found</h2>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-border-default rounded-xl hover:bg-surface-2 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Go back
        </button>
      </div>
    );
  }

  const { node: nodeData } = data;

  const tabs: TabConfig[] = [{ id: 'preview', label: 'Preview' }];
  if (contextAvailable) tabs.push({ id: 'context', label: 'Context' }, { id: 'raw', label: 'Raw' });

  return (
    // Full-width shell (see PersonProfilePage) — divider lines run edge to edge.
    <TabBarSlotProvider>
      <div className="profile-enter w-full pb-10">
        {/* Direct child of the tall page container so `sticky` actually pins;
            "-top-4 -mt-4" cancels <main>'s pt-4 (see NodeTabPage). */}
        <ProfileTabBar
          nodeType={nodeData.type} tabs={tabs} activeTab={activeTab} onTabChange={changeTab} stickyTop="-top-4 -mt-4"
          attachedOpen={activeTab === 'context' && contextAvailable}
          edgeClass={isNoteTab(activeTab) && contextAvailable ? edgeClass : undefined}
        />

        <div
          role="tabpanel"
          className={isNoteTab(activeTab) ? '' : 'mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6 xl:max-w-6xl'}
          style={isNoteTab(activeTab) && contextAvailable ? dockInsetStyle : undefined}
        >
          {activeTab === 'preview' && <ResourcePreviewContent node={nodeData} />}
          {isNoteTab(activeTab) && contextAvailable && (
            <>
              <DockedContextTree notePath={notePath} />
              <EntityContextPanel nodeId={nodeId} mode={modeForTab(activeTab)} />
            </>
          )}
        </div>
      </div>
    </TabBarSlotProvider>
  );
}

// ── Route entry ───────────────────────────────────────────────────────────────

function NodeProfileRoute() {
  const params = useParams();
  const router = useRouter();
  const nodeId = typeof params.nodeId === 'string' ? decodeURIComponent(params.nodeId) : '';
  const isEvent = nodeId.startsWith('event:');

  // Events have their own dedicated detail page (EventDetailClient). Anything that
  // links straight to /directory/event:… (context deep-links, shared URLs) is
  // redirected there rather than rendered with the generic node tab view.
  useEffect(() => {
    if (isEvent) router.replace(`/events/${encodeURIComponent(nodeId)}`);
  }, [isEvent, nodeId, router]);

  if (isEvent) {
    return <ProfileSkeletonLoader mode="fullpage" />;
  }
  if (nodeId.startsWith('person:')) {
    return <PersonProfilePage nodeId={nodeId} />;
  }
  // Resources get a Preview + Context view instead of the generic profile —
  // ids are consistently `resource:`-prefixed (create modal + seeds), matching
  // the person:/event: prefix convention above.
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
