'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useNodeProfile } from '@/hooks/useNodeProfile';
import { useSession } from '@/lib/auth-client';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import ProfileSkeletonLoader from '@/components/profile/ProfileSkeletonLoader';
import ProfileHero from '@/components/profile/ProfileHero';
import ProfileTabBar, { type ProfileTab } from '@/components/profile/ProfileTabBar';
import ProfileAboutPanel from '@/components/profile/ProfileAboutPanel';
import ConnectionsGrid from '@/components/profile/ConnectionsGrid';
import CommunitiesPanel from '@/components/profile/CommunitiesPanel';
import ActivityFeed from '@/components/profile/ActivityFeed';
import IntroRequestModal from '@/components/intros/IntroRequestModal';
import ProfilePageContent from '@/components/profile/ProfilePageContent';

const DEMO_NODE_ID = 'person:alex-chen';
const DEMO_NODE_NAME = 'Alex Chen';
const DEMO_COMMUNITY_ID = 'intro-demo';

// ── Person nodes → LinkedIn profile ──────────────────────────────────────────

function PersonProfilePage({ nodeId }: { nodeId: string }) {
  const router = useRouter();
  return (
    <div className="w-full px-6">
      <div className="px-6 pt-4 pb-2">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-brand-grey hover:text-brand-black transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      </div>
      <ProfilePageContent nodeId={nodeId} />
    </div>
  );
}

// ── Non-person nodes → classic tab view ──────────────────────────────────────

function NodeTabPage({ nodeId }: { nodeId: string }) {
  const { data, loading, error } = useNodeProfile(nodeId);
  const [activeTab, setActiveTab] = useState<ProfileTab>('about');
  const [introOpen, setIntroOpen] = useState(false);
  const { data: session } = useSession();
  const { currentCommunity } = useCommunity();
  const router = useRouter();

  const requesterNodeId = session?.user?.nodeId ?? DEMO_NODE_ID;
  const requesterName = session?.user?.name ?? DEMO_NODE_NAME;

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

  const { node, connectionCount, communityCount, connections } = data;
  const canRequestIntro = node.type === 'People' && requesterNodeId !== nodeId;
  const communityId = currentCommunity?.id ?? data?.node?.community_id ?? DEMO_COMMUNITY_ID;
  const communities = node.community_id
    ? [{ id: node.community_id, name: node.community_id, role: 'member' }]
    : [];
  const activityItems = connections.slice(0, 10).map((conn, i) => ({
    id: `conn-${i}`,
    type: 'connected' as const,
    description: `Connected with ${conn.name}`,
    timestamp: conn.since || node.createdAt || new Date().toISOString(),
  }));

  return (
    <div className="w-full px-6">
      <div className="px-6 pt-4 pb-2">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-brand-grey hover:text-brand-black transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      </div>
      <ProfileHero
        node={node} mode="fullpage" ctaState="idle"
        connectionCount={connectionCount} communityCount={communityCount}
        mutualConnections={[]}
        onConnectionsClick={() => setActiveTab('connections')}
        onCommunitiesClick={() => setActiveTab('communities')}
        onRequestIntro={canRequestIntro ? () => setIntroOpen(true) : undefined}
      />
      <div className="mt-8">
        <ProfileTabBar
          nodeType={node.type} activeTab={activeTab} onTabChange={setActiveTab}
          connectionCount={connectionCount} communityCount={communityCount}
          activityCount={activityItems.length}
        />
      </div>
      <div role="tabpanel" className="px-6 py-6">
        {activeTab === 'about' && (
          <div className="flex flex-col lg:flex-row gap-10 max-w-5xl">
            <div className="flex-shrink-0 lg:w-80">
              <ProfileAboutPanel node={node} />
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
                  <button onClick={() => setActiveTab('connections')} className="mt-4 text-xs font-medium text-brand-dark-green hover:underline">
                    View all {connectionCount} connections →
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {activeTab === 'connections' && <ConnectionsGrid connections={connections} nodeType={node.type} />}
        {activeTab === 'communities' && <CommunitiesPanel communities={communities} />}
        {activeTab === 'activity' && <ActivityFeed items={activityItems} />}
      </div>
      {introOpen && (
        <IntroRequestModal
          communityId={communityId}
          targetNode={{ id: nodeId, name: node.name, type: node.type, subtitle: node.subtitle ?? null, imageUrl: node.image_url ?? null }}
          requesterNodeId={requesterNodeId}
          requesterName={requesterName}
          onClose={() => setIntroOpen(false)}
        />
      )}
    </div>
  );
}

// ── Route entry ───────────────────────────────────────────────────────────────

export default function NodeProfilePage() {
  const params = useParams();
  const nodeId = typeof params.nodeId === 'string' ? decodeURIComponent(params.nodeId) : '';

  if (nodeId.startsWith('person:')) {
    return <PersonProfilePage nodeId={nodeId} />;
  }
  return <NodeTabPage nodeId={nodeId} />;
}
