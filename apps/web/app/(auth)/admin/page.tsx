'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import PeopleDataProvider from '@/features/admin/components/people/PeopleDataContext';
import MembersPanel from '@/features/admin/components/people/MembersPanel';
import SpaceSettingsPanel from '@/features/admin/components/SpaceSettingsPanel';
import TypesPanel from '@/features/admin/components/TypesPanel';
import SpaceToolsPanel from '@/features/admin/components/SpaceToolsPanel';
import ConnectorsPanel from '@/features/connectors/components/ConnectorsPanel';
import ToolReviewPanel, { useToolReviewQueue } from '@/features/admin/components/ToolReviewPanel';
import {
  AuthoredToolsPanel,
  InstalledToolsPanel,
  ToolApprovalsPanel,
  useToolApprovalCount,
} from '@/features/tools/components/manage/ToolsConsole';
import ConsoleShell, { type ConsoleSection } from '@/features/admin/components/console/ConsoleShell';
import { useSession } from '@/features/auth/lib/auth-client';
import { LoadingText, Alert } from '@/components/ui';
import { Space } from '@/lib/types';

// Each section owns one job, and the job is one noun: General is the space's own
// record, Tools is a row per tool (whether the space has it, where it sits, who
// may open it, and which version it runs), Build is the tools written here,
// Approvals is what a member published and is waiting on an admin, Connectors is
// the space's gateways to the outside world, Types is what kinds of thing the
// space records, and Members is the people — the invite link, both request
// queues, the aliases they can hold, and the roll itself.
//
// There is no Tools destination outside this console: a tool is authored by a
// coding agent over MCP and previewed at /tools/preview/<name>, and every
// decision about one is admin work, which is what this console is.
// Types and Members share a single data load (PeopleDataProvider; Types shows the
// same alias chips under Person), which is also where the Members badge count
// comes from: one definition of "waiting", not one per component.
function AdminConsole({ space, onSaved }: {
  space: Space;
  onSaved: (updated: Partial<Space>) => void;
}) {
  const [pending, setPending] = useState({ members: 0, requests: 0 });
  const handlePendingCount = useCallback(
    (counts: { members: number; requests: number }) => setPending(counts),
    [],
  );

  // Tool review is the one section that is not about this space: the queue is
  // global and the gate is Visvine super admin, so a space admin never sees the
  // tab. The routes behind it are gated the same way — hiding it is the courtesy,
  // not the security.
  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.isSuperAdmin === true;
  const reviewQueue = useToolReviewQueue(isSuperAdmin);

  // This space's own queue — the versions its members published. Counted here
  // so the tab carries the badge, and re-read when the panel acts on one.
  const approvals = useToolApprovalCount();

  const sections: ConsoleSection[] = [
    { id: 'general', label: 'General', width: 'form' },
    { id: 'tools', label: 'Tools', width: 'form' },
    { id: 'build', label: 'Build', width: 'wide' },
    { id: 'approvals', label: 'Approvals', width: 'wide', badge: approvals.count },
    { id: 'types', label: 'Types', width: 'form' },
    // Connectors has no rail row of its own — it is admins-only by nature, so
    // this console IS its surface (lib/featureAccess NAV_HIDDEN_FEATURE_KEYS).
    { id: 'connectors', label: 'Connectors', width: 'form' },
    // Both queues a person can be waiting in — to join, and for context access —
    // are resolved here, so one badge counts them both.
    { id: 'members', label: 'Members', width: 'wide', badge: pending.members + pending.requests },
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
            // Not keyed on the stored featureConfig: this panel is the only
            // writer of every key it holds, so remounting it on its own save
            // would only interrupt the drag that caused it.
            case 'tools':
              return (
                <div className="space-y-8">
                  <SpaceToolsPanel key={space.id} space={space} onSaved={onSaved} />
                  <InstalledToolsPanel key={`${space.id}-installs`} />
                </div>
              );
            case 'build':
              return <AuthoredToolsPanel key={space.id} />;
            case 'approvals':
              return (
                <ToolApprovalsPanel
                  key={space.id}
                  onReviewed={approvals.refresh}
                />
              );
            case 'connectors':
              return <ConnectorsPanel key={space.id} />;
            case 'members':
              return <MembersPanel key={space.id} />;
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
