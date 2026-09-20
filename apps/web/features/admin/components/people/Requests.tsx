'use client';

// Everybody waiting on an admin, in one queue near the top of Members.
//
// Two different things are being asked for — to join the space at all, and to
// reach something inside it — but from where the member stands they are the same
// act, so they are answered together, above the members they are asking to join.
//
// Nothing waiting means nothing rendered. A queue is an interruption; an empty
// one is not worth a line of the page, let alone the tab it used to have.

import { useState } from 'react';
import { Avatar, Button, ConfirmDialog, SettingsSection } from '@/components/ui';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import AccessRequests from './AccessRequests';
import { usePeopleSection } from './PeopleDataContext';

export default function Requests() {
  const { spaceId, data, busy, run } = usePeopleSection();
  const [deny, setDeny] = useState<{ userId: string; name: string } | null>(null);

  const pending = (data?.members ?? []).filter((m) => m.status === 'pending');
  const pendingAccess = (data?.requests ?? []).filter((r) => r.status === 'pending');

  const approve = (userId: string) =>
    run(() => fetchJsonBody(`/api/spaces/${spaceId}/members/${userId}`, 'PUT', { status: 'active' }));

  const removePending = (userId: string) =>
    run(() => fetchJson(`/api/spaces/${spaceId}/members/${userId}`, { method: 'DELETE' }));

  if (pending.length === 0 && pendingAccess.length === 0) return null;

  return (
    <>
      {/* Renders its own section, or nothing when no access request is waiting. */}
      <AccessRequests />

      {pending.length > 0 && (
        <SettingsSection title={`Wants to join (${pending.length})`}>
          <div className="divide-y divide-border-subtle">
            {pending.map((member) => (
              <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={member.user.name} imageUrl={member.user.image} size="sm" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text-primary">{member.user.name}</div>
                    <div className="truncate text-xs text-text-muted">{member.user.email}</div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="brand"
                    onClick={() => void approve(member.userId)}
                    disabled={busy}
                    className="!px-3 !py-1.5 !text-xs"
                  >
                    Approve
                  </Button>
                  <Button
                    variant="neutral"
                    onClick={() => setDeny({ userId: member.userId, name: member.user.name })}
                    disabled={busy}
                    className="!px-3 !py-1.5 !text-xs"
                  >
                    Deny
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </SettingsSection>
      )}

      <ConfirmDialog
        open={deny !== null}
        title={`Deny ${deny?.name ?? 'this request'}?`}
        confirmLabel="Deny"
        destructive
        onConfirm={async () => {
          if (!deny) return;
          const { userId } = deny;
          setDeny(null);
          await removePending(userId);
        }}
        onClose={() => setDeny(null)}
      />
    </>
  );
}
