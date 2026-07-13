'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useNodeProfile } from '@/hooks/useNodeProfile';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { isFeatureEnabled } from '@/lib/featureAccess';
import { entityKindOf } from '@/lib/notes/entities';
import type { CommunityFeatureConfig, NBNode } from '@/lib/types';
import ProfileSkeletonLoader from '@/components/profile/ProfileSkeletonLoader';
import ProfileHero from '@/components/profile/ProfileHero';
import ProfileTabBar, { type ProfileTab, type TabConfig } from '@/components/profile/ProfileTabBar';
import ProfileAboutPanel from '@/components/profile/ProfileAboutPanel';
import ConnectionsGrid from '@/components/profile/ConnectionsGrid';
import CommunitiesPanel from '@/components/profile/CommunitiesPanel';
import ActivityFeed from '@/components/profile/ActivityFeed';
import ProfilePageContent from '@/components/profile/ProfilePageContent';

// The Context tab pulls in Tiptap + the notes stack; load it only when a tab
// actually renders it (same rationale as the directory's deferred graph view).
const EntityContextPanel = dynamic(
  () => import('@/features/notes/components/EntityContextPanel').then((m) => m.EntityContextPanel),
  { ssr: false, loading: () => null },
);

// ── Context-tab availability ──────────────────────────────────────────────────

// A profile carries a Context tab when the notes tool is enabled, the node is an
// entity kind (person/org — the types with canonical context-note namespaces),
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

// Tab state lives in the URL (?tab=context) so tree/graph/backlink deep links
// land directly on an entity's context. Default tab = bare URL.
function useProfileTabParam(): [boolean, (tab: ProfileTab) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const wantsContext = searchParams.get('tab') === 'context';

  const setTabParam = useCallback(
    (tab: ProfileTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === 'context') params.set('tab', 'context');
      else params.delete('tab');
      const q = params.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  return [wantsContext, setTabParam];
}

// ── Person nodes → LinkedIn profile (+ Context tab) ──────────────────────────

const PERSON_TABS: TabConfig[] = [
  { id: 'about', label: 'Profile' },
  { id: 'context', label: 'Context' },
];

function PersonProfilePage({ nodeId }: { nodeId: string }) {
  // Deduped + cached alongside ProfilePageContent's own fetch; needed here for
  // the community-membership half of the Context-tab condition.
  const { data, loading: nodeLoading } = useNodeProfile(nodeId);
  const node = data?.node ?? null;
  const { currentCommunity, loading: communityLoading } = useCommunity();
  const contextAvailable = useContextTabAvailable(node);
  const [wantsContext, setTabParam] = useProfileTabParam();

  const activeTab: ProfileTab = wantsContext && contextAvailable ? 'context' : 'about';
  // Deep link to ?tab=context while community/node data still resolves: hold a
  // skeleton instead of flashing the profile and then swapping.
  const stillResolving = wantsContext && !contextAvailable && (communityLoading || nodeLoading || !currentCommunity);

  // Strip a stale ?tab=context (tool off / non-entity / foreign node) once
  // everything needed to decide has resolved.
  useEffect(() => {
    if (wantsContext && !contextAvailable && !communityLoading && !nodeLoading && currentCommunity && node) {
      setTabParam('about');
    }
  }, [wantsContext, contextAvailable, communityLoading, nodeLoading, currentCommunity, node, setTabParam]);

  return (
    <div className="profile-enter w-full max-w-5xl xl:max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-10">
      {contextAvailable && (
        <div className="mb-6">
          <ProfileTabBar nodeType="Person" tabs={PERSON_TABS} activeTab={activeTab} onTabChange={setTabParam} />
        </div>
      )}
      {stillResolving ? (
        <ProfileSkeletonLoader mode="fullpage" />
      ) : activeTab === 'context' ? (
        <EntityContextPanel nodeId={nodeId} />
      ) : (
        /* No outer card wrapper — ProfilePageContent renders separate floating
           cards directly on the page background, matching the event detail page. */
        <ProfilePageContent nodeId={nodeId} />
      )}
    </div>
  );
}

// ── Non-person nodes → classic tab view (+ Context tab for orgs) ─────────────

function NodeTabPage({ nodeId }: { nodeId: string }) {
  const { data, loading, error } = useNodeProfile(nodeId);
  const node = data?.node ?? null;
  const contextAvailable = useContextTabAvailable(node);
  const [wantsContext, setTabParam] = useProfileTabParam();
  const [activeTab, setActiveTab] = useState<ProfileTab>(wantsContext ? 'context' : 'about');
  const router = useRouter();

  // Tab changes keep local state (instant) and the URL (?tab=context) in sync.
  const changeTab = useCallback(
    (tab: ProfileTab) => {
      setActiveTab(tab);
      setTabParam(tab);
    },
    [setTabParam],
  );

  // A stale context tab (tool off / non-entity node) falls back once resolved.
  useEffect(() => {
    if (activeTab === 'context' && !loading && data && !contextAvailable) {
      changeTab('about');
    }
  }, [activeTab, loading, data, contextAvailable, changeTab]);

  if (loading) return <ProfileSkeletonLoader mode="fullpage" />;

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="text-5xl">😕</div>
        <h2 className="text-xl font-semibold text-brand-black">Profile not found</h2>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Go back
        </button>
      </div>
    );
  }

  const { node: nodeData, connectionCount, communityCount, connections } = data;
  const communities = nodeData.community_id
    ? [{ id: nodeData.community_id, name: nodeData.community_id, role: 'member' }]
    : [];
  const activityItems = connections.slice(0, 10).map((conn, i) => ({
    id: `conn-${i}`,
    type: 'connected' as const,
    description: `Connected with ${conn.name}`,
    timestamp: conn.since || nodeData.createdAt || new Date().toISOString(),
  }));

  return (
    <div className="profile-enter w-full max-w-5xl mx-auto px-6">
      <div className="px-6 pt-4 pb-2">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-brand-grey hover:text-brand-black transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      </div>
      <ProfileHero
        node={nodeData} mode="fullpage" ctaState="idle"
        connectionCount={connectionCount} communityCount={communityCount}
        mutualConnections={[]}
        onConnectionsClick={() => changeTab('connections')}
        onCommunitiesClick={() => changeTab('communities')}
      />
      <div className="mt-8">
        <ProfileTabBar
          nodeType={nodeData.type} activeTab={activeTab} onTabChange={changeTab}
          connectionCount={connectionCount} communityCount={communityCount}
          activityCount={activityItems.length}
          showContextTab={contextAvailable}
        />
      </div>
      <div role="tabpanel" className="px-6 py-6">
        {activeTab === 'about' && (
          <div className="flex flex-col lg:flex-row gap-10 max-w-5xl">
            <div className="flex-shrink-0 lg:w-80">
              <ProfileAboutPanel node={nodeData} />
            </div>
            {connections.length > 0 && (
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-brand-black mb-4">
                  Connections ({connectionCount})
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {connections.slice(0, 6).map((conn) => {
                    const words = conn.name.trim().split(/\s+/);
                    const initials = words.length === 1
                      ? words[0].substring(0, 2).toUpperCase()
                      : (words[0][0] + words[words.length - 1][0]).toUpperCase();
                    return (
                      <div key={conn.id} className="flex flex-col items-center gap-2 p-3 bg-gray-50 rounded-xl border border-gray-100 hover:border-gray-200 transition-colors cursor-pointer">
                        {conn.image_url
                          ? <img src={conn.image_url} alt={conn.name} className="w-14 h-[72px] rounded-xl object-cover" />
                          : <div className="w-14 h-[72px] rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-semibold">{initials}</div>
                        }
                        <p className="text-xs font-medium text-brand-black text-center line-clamp-1">{conn.name}</p>
                      </div>
                    );
                  })}
                </div>
                {connectionCount > 6 && (
                  <button onClick={() => changeTab('connections')} className="mt-4 text-xs font-medium text-brand-dark-green hover:underline">
                    View all {connectionCount} connections →
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {activeTab === 'context' && contextAvailable && <EntityContextPanel nodeId={nodeId} />}
        {activeTab === 'connections' && <ConnectionsGrid connections={connections} nodeType={nodeData.type} />}
        {activeTab === 'communities' && <CommunitiesPanel communities={communities} />}
        {activeTab === 'activity' && <ActivityFeed items={activityItems} />}
      </div>
    </div>
  );
}

// ── Route entry ───────────────────────────────────────────────────────────────

function NodeProfileRoute() {
  const params = useParams();
  const router = useRouter();
  const nodeId = typeof params.nodeId === 'string' ? decodeURIComponent(params.nodeId) : '';
  const isEvent = nodeId.startsWith('event:');

  // Events have their own dedicated detail page (EventDetailClient). Anything that
  // links straight to /directory/event:… (graph deep-links, shared URLs) is
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
