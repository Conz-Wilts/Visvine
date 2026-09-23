'use client';

// Console → Members. One page, top to bottom, answering the questions in the
// order an admin actually has them: how does someone get in, who is waiting on
// me, who is here, and what any of them can be.
//
// It used to be four sub-tabs, and two of them weren't about members: the
// per-tool lock is a line on a tool's row (Console → Tools), and a queue is an
// interruption rather than a place you visit.
//
// Aliases are HANDED OUT here, not made: the list at the foot of the page is
// who holds each one, whether holding it owns the space, and which context
// folders it opens — the permission model, beside the people it is about. What
// an alias is CALLED and coloured is the Person type's vocabulary and lives on
// Types → Person, with every other type's labels. The toggles in a member's
// open row are this same list applied one person at a time.

import Link from '@/features/shared/components/SpaceLink';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { getNodeTypeConfig } from '@/lib/types';
import { Alert, SettingsSection } from '@/components/ui';
import AliasList from './AliasList';
import InviteLink from './InviteLink';
import MemberTable from './MemberTable';
import Requests from './Requests';
import { usePeopleSection } from './PeopleDataContext';

export default function MembersPanel() {
  const { spaceId, data, error, setError } = usePeopleSection();
  const { currentSpace } = useSpace();
  const active = (data?.members ?? []).filter((m) => m.status !== 'pending');
  const personColor = getNodeTypeConfig('person', currentSpace?.nodeTypes).color;

  return (
    <div className="space-y-8">
      {error && <Alert variant="error" onDismiss={() => setError(null)}>{error}</Alert>}

      {/* No description on any of these: the invite link looks like an invite
          link, a queue names the thing it is asking for, and a page an admin
          reads once does not want a sentence under every heading. */}
      <SettingsSection title="Invite link">
        <InviteLink spaceId={spaceId} />
      </SettingsSection>

      {/* Both queues, or nothing. */}
      <Requests />

      <SettingsSection title={`In this space${data ? ` (${active.length})` : ''}`}>
        {data === null ? <p className="text-sm text-fg-muted">Loading…</p> : <MemberTable />}
      </SettingsSection>

      {/* Last, because it is the vocabulary the roll above is written in: you
          read who is here, then what any of them can be and what that opens. */}
      <SettingsSection
        title="Aliases and access"
        description={
          <>
            Who holds each alias and what it opens. New ones are named on{' '}
            <Link href="/admin?section=types" className="underline underline-offset-2">
              Types → Person
            </Link>
            .
          </>
        }
      >
        <AliasList mode="permissions" typeColor={personColor} />
      </SettingsSection>
    </div>
  );
}
