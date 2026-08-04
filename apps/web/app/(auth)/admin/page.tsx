'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import PeopleDataProvider from '@/components/admin/people/PeopleDataContext';
import PeoplePanel from '@/components/admin/people/PeoplePanel';
import AliasesPanel from '@/components/admin/people/AliasesPanel';
import InvitePanel from '@/components/admin/people/InvitePanel';
import CommunitySettingsPanel from '@/components/admin/CommunitySettingsPanel';
import TypesTab from '@/components/data/TypesTab';
import CommunityToolsPanel from '@/components/admin/CommunityToolsPanel';
import ConsoleShell, { type ConsoleSection } from '@/components/console/ConsoleShell';
import { LoadingText, Alert } from '@/components/ui';
import { Community } from '@/lib/types';
import { Settings2, Puzzle, Users, Tag, UserPlus, Shapes } from 'lucide-react';

// People, Aliases and Invite are three top-level sections rather than tabs
// inside one, so nothing in the console is ever two clicks deep. They share a
// single data load (PeopleDataProvider), which is also where the People badge
// count comes from — one definition of "waiting", not one per component.
function AdminConsole({ community, onSaved }: {
  community: Community;
  onSaved: (updated: Partial<Community>) => void;
}) {
  const [pendingPeople, setPendingPeople] = useState(0);
  const handlePendingCount = useCallback((count: number) => setPendingPeople(count), []);

  const sections: ConsoleSection[] = [
    { id: 'general', label: 'General', group: 'Settings', width: 'form', icon: <Settings2 size={18} /> },
    { id: 'tools', label: 'Tools', group: 'Settings', width: 'form', icon: <Puzzle size={18} /> },
    { id: 'people', label: 'People', group: 'People', width: 'wide', badge: pendingPeople, icon: <Users size={18} /> },
    { id: 'aliases', label: 'Aliases', group: 'People', width: 'wide', icon: <Tag size={18} /> },
    { id: 'invite', label: 'Invite', group: 'People', width: 'form', icon: <UserPlus size={18} /> },
    { id: 'types', label: 'Types', group: 'Content', width: 'form', icon: <Shapes size={18} /> },
  ];

  return (
    <PeopleDataProvider
      key={community.id}
      communityId={community.id}
      onPendingCountChange={handlePendingCount}
    >
      <ConsoleShell
        sections={sections}
        renderSection={(id) => {
          switch (id) {
            case 'general':
              return <CommunitySettingsPanel community={community} onSaved={onSaved} />;
            case 'tools':
              return <CommunityToolsPanel key={community.id} community={community} onSaved={onSaved} />;
            case 'people':
              return <PeoplePanel />;
            case 'aliases':
              return <AliasesPanel />;
            case 'invite':
              return <InvitePanel />;
            case 'types':
              return <TypesTab key={`${community.id}-${JSON.stringify(community.nodeTypes)}`} communityId={community.id} />;
            default:
              return null;
          }
        }}
      />
    </PeopleDataProvider>
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
