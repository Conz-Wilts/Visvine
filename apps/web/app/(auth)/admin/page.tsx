'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCommunity } from '@/features/shared/contexts/CommunityContext';
import PeopleDataProvider from '@/features/admin/components/people/PeopleDataContext';
import PeoplePanel from '@/features/admin/components/people/PeoplePanel';
import AliasesPanel from '@/features/admin/components/people/AliasesPanel';
import InvitePanel from '@/features/admin/components/people/InvitePanel';
import CommunitySettingsPanel from '@/features/admin/components/CommunitySettingsPanel';
import TypesTab from '@/features/directory/components/data/TypesTab';
import CommunityToolsPanel from '@/features/admin/components/CommunityToolsPanel';
import ConsoleShell, { type ConsoleSection } from '@/features/admin/components/console/ConsoleShell';
import { LoadingText, Alert } from '@/components/ui';
import { Community } from '@/lib/types';
import { Settings2, Puzzle, Users, Tag, UserPlus, Shapes } from 'lucide-react';

// Aliases, Members and Invite are three top-level sections rather than tabs
// inside one, so nothing in the console is ever two clicks deep. They share a
// single data load (PeopleDataProvider), which is also where the Members badge
// count comes from — one definition of "waiting", not one per component.
function AdminConsole({ community, onSaved }: {
  community: Community;
  onSaved: (updated: Partial<Community>) => void;
}) {
  const [pending, setPending] = useState({ members: 0, requests: 0 });
  const handlePendingCount = useCallback(
    (counts: { members: number; requests: number }) => setPending(counts),
    [],
  );

  const sections: ConsoleSection[] = [
    { id: 'general', label: 'General', group: 'Settings', width: 'form', icon: <Settings2 size={18} /> },
    { id: 'tools', label: 'Tools', group: 'Settings', width: 'form', icon: <Puzzle size={18} /> },
    { id: 'types', label: 'Types', group: 'Content', width: 'form', icon: <Shapes size={18} /> },
    { id: 'aliases', label: 'Aliases', group: 'Members', width: 'wide', badge: pending.requests, icon: <Tag size={18} /> },
    { id: 'members', label: 'Members', group: 'Members', width: 'wide', badge: pending.members, icon: <Users size={18} /> },
    { id: 'invite', label: 'Invite', group: 'Members', width: 'form', icon: <UserPlus size={18} /> },
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
            case 'members':
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
        <Alert variant="info">Select a space you administer to access this page.</Alert>
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
