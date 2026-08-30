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
import ConnectorsPanel from '@/features/connectors/components/ConnectorsPanel';
import AgentsPanel, { useAgentRoster } from '@/features/agents/components/AgentsPanel';
import ToolReviewPanel, { useToolReviewQueue } from '@/features/admin/components/ToolReviewPanel';
import ConsoleShell, { type ConsoleSection } from '@/features/admin/components/console/ConsoleShell';
import { useSession } from '@/features/auth/lib/auth-client';
import { LoadingText, Alert } from '@/components/ui';
import { Space } from '@/lib/types';

// Each section owns one job: General is the space's own record, Tools decides
// which surfaces exist and how the sidebar is ordered, Connectors is the space's
// gateways to the outside world, Agents is what runs on a schedule and who
// turned it on, Types describes what kinds
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

  // Tool review is the one section that is not about this space: the queue is
  // global and the gate is Visvine super admin, so a space admin never sees the
  // tab. The routes behind it are gated the same way — hiding it is the courtesy,
  // not the security.
  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.isSuperAdmin === true;
  const reviewQueue = useToolReviewQueue(isSuperAdmin);
  // Loaded here rather than in the panel so the badge and the section agree on
  // what is waiting, and the count is there before the section is opened.
  const roster = useAgentRoster(space.id);

  const sections: ConsoleSection[] = [
    { id: 'general', label: 'General', width: 'form' },
    { id: 'tools', label: 'Tools', width: 'form' },
    // Connectors has no rail row of its own — it is admins-only by nature, so
    // this console IS its surface (lib/featureAccess NAV_HIDDEN_FEATURE_KEYS).
    { id: 'connectors', label: 'Connectors', width: 'form' },
    // Agents is here for the same reason Connectors is: turning one on is an
    // admin act, so this console is its surface. An agent's brief, runs and
    // spend stay on the agent's own page — this section is the roster and the
    // switch.
    { id: 'agents', label: 'Agents', width: 'wide', badge: roster.waiting },
    { id: 'types', label: 'Types', width: 'form' },
    // Both queues a person can be waiting in — to join, and for context access —
    // are resolved here, so one badge counts them both.
    { id: 'members', label: 'Members', width: 'wide', badge: pending.members + pending.requests },
    { id: 'invite', label: 'Invite', width: 'form' },
    ...(isSuperAdmin
      ? ([{ id: 'review', label: 'Tool review', width: 'wide', badge: reviewQueue.items.length }] as const)
      : []),
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
            // Tools seeds `adminOnly` into local state but does not edit it —
            // Members does — so it is keyed on the config it read: once a lock
            // changes there, onSaved bubbles the new record up and this panel
            // re-seeds instead of re-sending a stale array on its next save.
            // Members isn't keyed that way on purpose: remounting it on every
            // toggle would throw you back to its first sub-tab.
            case 'tools':
              return <SpaceToolsPanel key={configKey} space={space} onSaved={onSaved} />;
            case 'connectors':
              return <ConnectorsPanel key={space.id} />;
            case 'agents':
              return <AgentsPanel roster={roster} />;
            case 'members':
              return <MembersPanel key={space.id} space={space} onSaved={onSaved} />;
            case 'invite':
              return <InvitePanel />;
            case 'types':
              return <TypesPanel key={`${space.id}-${JSON.stringify(space.nodeTypes)}`} />;
            // Not keyed on the space: the queue outlives whichever space the
            // console happens to be pointed at.
            case 'review':
              return isSuperAdmin ? <ToolReviewPanel queue={reviewQueue} /> : null;
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
