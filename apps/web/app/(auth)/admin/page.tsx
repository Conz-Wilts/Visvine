'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import PeopleDataProvider from '@/features/admin/components/people/PeopleDataContext';
import MembersPanel from '@/features/admin/components/people/MembersPanel';
import InvitePanel from '@/features/admin/components/people/InvitePanel';
import SpaceSettingsPanel from '@/features/admin/components/SpaceSettingsPanel';
import TypesPanel from '@/features/admin/components/TypesPanel';
import SpaceToolsPanel from '@/features/admin/components/SpaceToolsPanel';
import ConsoleShell, { type ConsoleSection } from '@/features/admin/components/console/ConsoleShell';
import { LoadingText, Alert } from '@/components/ui';
import { Space } from '@/lib/types';
import { Settings2, Puzzle, Users, UserPlus, Shapes } from 'lucide-react';

// Each section owns one job: General is the space's own record, Tools decides
// which surfaces exist and how the sidebar is ordered, Types describes what kinds
// of thing the space records, and Members owns every permission — people, aliases
// and their grants, which tools members can open, and both request queues. Types,
// Members and Invite share a single data load (PeopleDataProvider; Types still
// reads it for the read-only Person chips), which is also where the Members badge
// count comes from: one definition of "waiting", not one per component.
function AdminConsole({ space, onSaved }: {
  space: Space;
  onSaved: (updated: Partial<Space>) => void;
}) {
  const [pending, setPending] = useState({ members: 0, requests: 0 });
  const handlePendingCount = useCallback(
    (counts: { members: number; requests: number }) => setPending(counts),
    [],
  );

  const configKey = `${space.id}-${JSON.stringify(space.featureConfig ?? {})}`;

  const sections: ConsoleSection[] = [
    { id: 'general', label: 'General', group: 'Settings', width: 'form', icon: <Settings2 size={18} /> },
    { id: 'tools', label: 'Tools', group: 'Settings', width: 'form', icon: <Puzzle size={18} /> },
    { id: 'types', label: 'Types', group: 'Content', width: 'form', icon: <Shapes size={18} /> },
    // Both queues a person can be waiting in — to join, and for context access —
    // are resolved here, so one badge counts them both.
    { id: 'members', label: 'Members', group: 'Members', width: 'wide', badge: pending.members + pending.requests, icon: <Users size={18} /> },
    { id: 'invite', label: 'Invite', group: 'Members', width: 'form', icon: <UserPlus size={18} /> },
  ];

  return (
    <PeopleDataProvider
      key={space.id}
      spaceId={space.id}
      onPendingCountChange={handlePendingCount}
    >
      <ConsoleShell
        sections={sections}
        renderSection={(id) => {
          switch (id) {
            case 'general':
              return <SpaceSettingsPanel space={space} onSaved={onSaved} />;
            // Tools seeds `adminOnly` into local state but no longer edits it —
            // Members does — so it is keyed on the config it read: once a lock
            // changes there, onSaved bubbles the new record up and this panel
            // re-seeds instead of re-sending a stale array on its next save.
            // Members isn't keyed that way on purpose: remounting it on every
            // toggle would throw you back to its first sub-tab.
            case 'tools':
              return <SpaceToolsPanel key={configKey} space={space} onSaved={onSaved} />;
            case 'members':
              return <MembersPanel key={space.id} space={space} onSaved={onSaved} />;
            case 'invite':
              return <InvitePanel />;
            case 'types':
              return <TypesPanel key={`${space.id}-${JSON.stringify(space.nodeTypes)}`} />;
            default:
              return null;
          }
        }}
      />
    </PeopleDataProvider>
  );
}

export default function AdminPage() {
  const { currentSpace, isAdmin, loading, refreshSpace } = useSpace();
  const router = useRouter();
  const [localSpace, setLocalSpace] = useState<Space | null>(null);

  useEffect(() => {
    if (currentSpace) setLocalSpace(currentSpace);
  }, [currentSpace]);

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

  if (!currentSpace || !isAdmin) {
    return (
      <div className="w-full px-6 py-8">
        <Alert variant="info">Select a space you administer to access this page.</Alert>
      </div>
    );
  }

  const space = localSpace ?? currentSpace;

  return (
    <Suspense
      fallback={
        <div className="w-full px-6 py-8">
          <LoadingText text="Loading…" />
        </div>
      }
    >
      <AdminConsole
        space={space}
        onSaved={updated => {
          setLocalSpace(prev => prev ? { ...prev, ...updated } : prev);
          refreshSpace();
        }}
      />
    </Suspense>
  );
}
