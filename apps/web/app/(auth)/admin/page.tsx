'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import PeopleAccessPanel from '@/components/admin/people/PeopleAccessPanel';
import CommunitySettingsPanel from '@/components/admin/CommunitySettingsPanel';
import TypesTab from '@/components/data/TypesTab';
import CommunityToolsPanel from '@/components/admin/CommunityToolsPanel';
import ConsoleShell, { type ConsoleSection } from '@/components/console/ConsoleShell';
import { LoadingText, Alert } from '@/components/ui';
import { Community } from '@/lib/types';
import { Settings2, Puzzle, Users, Shapes } from 'lucide-react';

function AdminConsole({ community, onSaved }: {
  community: Community;
  onSaved: (updated: Partial<Community>) => void;
}) {
  const [pendingPeople, setPendingPeople] = useState(0);

  // Seed the People & access badge without opening the section: members waiting
  // to join + members waiting on context access, the same sum the panel reports
  // back once it's open.
  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/communities/${community.id}/members`)
        .then(r => (r.ok ? r.json() : null))
        .then(data => (data?.members
          ? data.members.filter((m: { status: string }) => m.status === 'pending').length
          : 0))
        .catch(() => 0),
      fetch(`/api/notes/access-requests?communityId=${encodeURIComponent(community.id)}`)
        .then(r => (r.ok ? r.json() : null))
        .then(data => (typeof data?.pending === 'number' ? data.pending : 0))
        .catch(() => 0),
    ]).then(([members, requests]) => {
      if (active) setPendingPeople(members + requests);
    });
    return () => { active = false; };
  }, [community.id]);

  const handlePendingCount = useCallback((count: number) => setPendingPeople(count), []);

  const sections: ConsoleSection[] = [
    { id: 'general', label: 'General', group: 'Settings', width: 'form', icon: <Settings2 size={18} /> },
    { id: 'tools', label: 'Tools', group: 'Settings', width: 'form', icon: <Puzzle size={18} /> },
    { id: 'members', label: 'People & access', group: 'People', width: 'wide', badge: pendingPeople, icon: <Users size={18} /> },
    { id: 'types', label: 'Types', group: 'Content', width: 'form', icon: <Shapes size={18} /> },
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
            return <PeopleAccessPanel key={community.id} communityId={community.id} onPendingCountChange={handlePendingCount} />;
          case 'types':
            return <TypesTab key={`${community.id}-${JSON.stringify(community.nodeTypes)}`} communityId={community.id} />;
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
