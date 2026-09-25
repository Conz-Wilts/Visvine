'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSpaceRouter } from '@/features/shared/hooks/useSpaceRouter';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import PeopleDataProvider from '@/features/admin/components/people/PeopleDataContext';
import ModelsPanel from '@/features/models/components/ModelsPanel';
import MembersPanel from '@/features/admin/components/people/MembersPanel';
import SpaceSettingsPanel from '@/features/admin/components/SpaceSettingsPanel';
import TypesPanel from '@/features/admin/components/TypesPanel';
import SpaceToolsPanel from '@/features/admin/components/SpaceToolsPanel';
import ConnectorsPanel from '@/features/connectors/components/ConnectorsPanel';
import { useConnectorRequestCount } from '@/features/connectors/hooks/useConnectorRequestCount';
import { useToolReviewQueue } from '@/features/admin/components/ToolReviewPanel';
import ReviewConsole from '@/features/admin/components/ReviewConsole';
import {
  InstalledToolsPanel,
  ListingOffersPanel,
  ToolApprovalsPanel,
  useToolApprovalQueue,
} from '@/features/tools/components/manage/ToolsConsole';
import ConsoleShell, { type ConsoleSection } from '@/features/admin/components/console/ConsoleShell';
import { useAuth } from '@/features/auth/contexts/AuthContext';
import { LoadingText, Alert } from '@visvine/ui';
import { Space } from '@/lib/types';

// Each section owns one job, and the job is one noun: General is the space's own
// record, Tools is a row per tool (whether the space has it, where it sits, who
// may open it, and which version it runs), Approvals is what a member published
// and is waiting on an admin, Connectors is the space's gateways to the outside world, Types is what kinds of thing the
// space records, Members is the people — the invite link, both request
// queues, the aliases they can hold, and the roll itself — and, for a Visvine
// super admin alone, Review is the tools listed for every space.
//
// There is no Tools destination outside this console: a tool is authored by a
// coding agent over MCP and previewed at /tools/preview/<name>; publishing it
// happens on the tool's own page, and every other decision about one is here.
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

  // Review is the one section that is not about this space: the queue, the
  // incidents and the listings are global and the gate is Visvine super
  // admin, so a space admin never sees it. The routes behind it are gated the
  // same way — hiding it is the courtesy, not the security.
  const { session } = useAuth();
  const isSuperAdmin = session?.user?.isSuperAdmin === true;
  const reviewQueue = useToolReviewQueue(isSuperAdmin);

  // This space's own queue — the versions its members published. Read once
  // here: the tab carries the count, the panel lists the rows, and acting on
  // one re-reads both.
  const approvals = useToolApprovalQueue();
  // What members asked the space to connect — the Connectors badge.
  const connectorRequests = useConnectorRequestCount();

  const sections: ConsoleSection[] = [
    { id: 'general', label: 'General', width: 'form' },
    { id: 'tools', label: 'Tools', width: 'form' },
    { id: 'approvals', label: 'Approvals', width: 'wide', badge: approvals.count },
    { id: 'types', label: 'Types', width: 'form' },
    // Connectors has no rail row of its own — it is admins-only by nature, so
    // this console IS its surface (lib/featureAccess NAV_HIDDEN_FEATURE_KEYS).
    { id: 'connectors', label: 'Connectors', width: 'form', badge: connectorRequests.count },
    // What the space's agents run on: the space's, and an admin's to set.
    { id: 'models', label: 'Models', width: 'form' },
    // Both queues a person can be waiting in — to join, and for context access —
    // are resolved here, so one badge counts them both.
    { id: 'members', label: 'Members', width: 'wide', badge: pending.members + pending.requests },
    // Visvine's review — not about this space at all, and a super admin's alone.
    ...(isSuperAdmin ? [{ id: 'review', label: 'Review', width: 'wide' as const, badge: reviewQueue.items.length }] : []),
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
                  <ListingOffersPanel key={`${space.id}-offers`} />
                </div>
              );
            // Not keyed on the space: the queue outlives whichever space the
            // console happens to be pointed at.
            case 'review':
              return isSuperAdmin ? <ReviewConsole queue={reviewQueue} /> : null;
            case 'approvals':
              return (
                <ToolApprovalsPanel
                  key={space.id}
                  queue={approvals.queue}
                  onReviewed={approvals.refresh}
                />
              );
            case 'connectors':
              return <ConnectorsPanel key={space.id} onRequestsChanged={connectorRequests.refresh} />;
            case 'models':
              return <ModelsPanel key={space.id} space={space.id} />;
            case 'members':
              return <MembersPanel key={space.id} />;
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
  const router = useSpaceRouter();
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
