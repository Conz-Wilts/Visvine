'use client';

import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import type { NBNode } from '@/lib/types';
import { getInitials } from '@/lib/avatarUtils';
import { useNodeProfile, type ProfileConnection } from '@/hooks/useNodeProfile';
import ProfilePageContent from './ProfilePageContent';
import ProfileHero from './ProfileHero';
import ProfileSkeletonLoader from './ProfileSkeletonLoader';
import ProfileTabBar, { type ProfileTab } from './ProfileTabBar';
import ProfileAboutPanel from './ProfileAboutPanel';
import ConnectionsGrid from './ConnectionsGrid';
import CommunitiesPanel from './CommunitiesPanel';
import ActivityFeed from './ActivityFeed';
import EventFullProfile from './EventFullProfile';

interface FullProfileOverlayProps {
  nodeId: string | null;
  initialNode?: NBNode;
  initialConnections?: ProfileConnection[];
  onClose: () => void;
}

export default function FullProfileOverlay({
  nodeId,
  initialNode,
  initialConnections = [],
  onClose,
}: FullProfileOverlayProps) {
  const [rendered, setRendered] = useState(false);
  const [visible, setVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<ProfileTab>('about');

  // For non-person nodes, fetch via the old API
  const isPerson = !!nodeId?.startsWith('person:');
  const isEvent = !!nodeId?.startsWith('event:');
  const { data } = useNodeProfile(isPerson || isEvent ? null : nodeId);

  const node = data?.node ?? initialNode;
  const connectionCount = data?.connectionCount ?? initialConnections.length;
  const communityCount = data?.communityCount ?? 1;
  const connections = data?.connections ?? initialConnections;

  useEffect(() => {
    if (nodeId) {
      setRendered(true);
      setActiveTab('about');
      const raf = requestAnimationFrame(() =>
        requestAnimationFrame(() => setVisible(true))
      );
      return () => cancelAnimationFrame(raf);
    }
  }, [nodeId]);

  function handleClose() {
    setVisible(false);
    setTimeout(() => {
      setRendered(false);
      onClose();
    }, 350);
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  if (!rendered) return null;

  const communities = node?.community_id
    ? [{ id: node.community_id, name: node.community_id, role: 'member' }]
    : [];
  const activityItems = connections.slice(0, 10).map((conn, i) => ({
    id: `conn-${i}`,
    type: 'connected' as const,
    description: `Connected with ${conn.name}`,
    timestamp: conn.since || node?.createdAt || new Date().toISOString(),
  }));

  return (
    <div
      className="fixed inset-0 z-50 bg-brand-bg overflow-y-auto"
      style={{
        transform: visible ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 350ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      <div className="w-full max-w-7xl mx-auto px-6 pt-8 pb-8">

        {/* Person nodes → new profile design */}
        {isPerson && nodeId ? (
          <div className="relative bg-surface-1 rounded-2xl border border-border-subtle overflow-hidden shadow-float" style={{ minHeight: 'calc(100vh - 4rem)' }}>
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 z-10 p-2 rounded-xl text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
            <ProfilePageContent nodeId={nodeId} />
          </div>
        ) : isEvent && nodeId ? (
          <EventFullProfile nodeId={nodeId} node={initialNode} onClose={handleClose} />
        ) : (
          /* Non-person nodes → classic tab view */
          <>
            {!node ? (
              <ProfileSkeletonLoader mode="fullpage" />
            ) : (
              <div className="relative bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <button
                  onClick={handleClose}
                  className="absolute top-4 right-4 z-10 p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
                <ProfileHero
                  node={node}
                  mode="fullpage"
                  ctaState="idle"
                  connectionCount={connectionCount}
                  communityCount={communityCount}
                  mutualConnections={[]}
                  onConnectionsClick={() => setActiveTab('connections')}
                  onCommunitiesClick={() => setActiveTab('communities')}
                />
                <div className="mt-8">
                  <ProfileTabBar
                    nodeType={node.type}
                    activeTab={activeTab}
                    onTabChange={setActiveTab}
                    connectionCount={connectionCount}
                    communityCount={communityCount}
                    activityCount={activityItems.length}
                    stickyTop="top-0"
                  />
                </div>
                <div className="px-8 py-8">
                  {activeTab === 'about' && (
                    <div className="flex flex-col lg:flex-row gap-10">
                      <div className="flex-shrink-0 lg:w-72">
                        <ProfileAboutPanel node={node} />
                      </div>
                      {connections.length > 0 && (
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-semibold text-brand-black mb-4">
                            Connections ({connectionCount})
                          </h3>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {connections.slice(0, 6).map((conn) => {
                              const initials = getInitials(conn.name);
                              return (
                                <div key={conn.id} className="flex flex-col items-center gap-2 p-3 bg-gray-50 rounded-xl border border-gray-100 hover:border-gray-200 transition-colors cursor-pointer">
                                  {conn.image_url
                                    ? <img src={conn.image_url} alt={conn.name} className="w-14 h-14 rounded-xl object-cover" />
                                    : <div className="w-14 h-14 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-semibold">{initials}</div>
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
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
