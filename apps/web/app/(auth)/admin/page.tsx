'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import MembersPanel from '@/components/admin/MembersPanel';
import CommunitySettingsPanel from '@/components/admin/CommunitySettingsPanel';
import ActivityLogPanel from '@/components/admin/ActivityLogPanel';
import TypesTab from '@/components/data/TypesTab';
import AnalyticsPanel from '@/components/analytics/AnalyticsPanel';
import CommunityToolsPanel from '@/components/admin/CommunityToolsPanel';
import ConsoleShell, { type ConsoleSection } from '@/components/console/ConsoleShell';
import { LoadingText, Alert } from '@/components/ui';
import { Community } from '@/lib/types';
import { Settings2, Puzzle, Users, Shapes, History, BarChart3 } from 'lucide-react';

function AdminConsole({ community, onSaved }: {
  community: Community;
  onSaved: (updated: Partial<Community>) => void;
}) {
  const [pendingMembers, setPendingMembers] = useState(0);

  // Seed the Members badge without opening the section.
  useEffect(() => {
    let active = true;
    fetch(`/api/communities/${community.id}/members`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (active && data?.members) {
          setPendingMembers(data.members.filter((m: { status: string }) => m.status === 'pending').length);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [community.id]);

  const handlePendingCount = useCallback((count: number) => setPendingMembers(count), []);

  const sections: ConsoleSection[] = [
    { id: 'general', label: 'General', group: 'Settings', width: 'form', icon: <Settings2 size={18} />, description: 'Name, details, and access' },
    { id: 'tools', label: 'Tools', group: 'Settings', width: 'form', icon: <Puzzle size={18} />, description: 'Enable community tools' },
    { id: 'members', label: 'Members', group: 'People', width: 'wide', badge: pendingMembers, icon: <Users size={18} />, description: 'Roles and requests' },
    { id: 'types', label: 'Types', group: 'Content', width: 'form', icon: <Shapes size={18} />, description: 'Directory node types' },
    { id: 'activity', label: 'Activity', group: 'Insights', width: 'wide', icon: <History size={18} />, description: 'Recent admin actions' },
    { id: 'analytics', label: 'Analytics', group: 'Insights', width: 'wide', icon: <BarChart3 size={18} />, description: 'Engagement and growth' },
  ];

  return (
    <ConsoleShell
      sections={sections}
      renderSection={(id) => {
        switch (id) {
          case 'general':
            return <CommunitySettingsPanel community={community} onSaved={onSaved} />;
          case 'tools':
            return <CommunityToolsPanel key={community.id} community={community} onSaved={onSaved} />;
          case 'members':
            return <MembersPanel communityId={community.id} onPendingCountChange={handlePendingCount} />;
          case 'types':
            return <TypesTab key={`${community.id}-${JSON.stringify(community.nodeTypes)}`} communityId={community.id} />;
          case 'activity':
            return <ActivityLogPanel communityId={community.id} />;
          case 'analytics':
            return <AnalyticsPanel communityId={community.id} />;
          default:
            return null;
        }
      }}
    />
  );
}

export default function AdminPage() {
  const { currentCommunity, isAdmin, loading, refreshCommunity } = useCommunity();
  const router = useRouter();
  const [localCommunity, setLocalCommunity] = useState<Community | null>(null);

  useEffect(() => {
    if (currentCommunity) setLocalCommunity(currentCommunity);
  }, [currentCommunity]);

  // Redirect non-admins away once we know their status
  useEffect(() => {
    if (!loading && !isAdmin) {
      router.replace('/directory');
    }
  }, [loading, isAdmin, router]);

  if (loading) {
    return (
      <div className="w-full px-6 py-8">
        <LoadingText text="Loading…" />
      </div>
    );
  }

  if (!currentCommunity || !isAdmin) {
    return (
      <div className="w-full px-6 py-8">
        <Alert variant="info">Select a community you administer to access this page.</Alert>
      </div>
    );
  }

  const community = localCommunity ?? currentCommunity;

  return (
    <Suspense
      fallback={
        <div className="w-full px-6 py-8">
          <LoadingText text="Loading…" />
        </div>
      }
    >
      <AdminConsole
        community={community}
        onSaved={updated => {
          setLocalCommunity(prev => prev ? { ...prev, ...updated } : prev);
          refreshCommunity();
        }}
      />
    </Suspense>
  );
}
