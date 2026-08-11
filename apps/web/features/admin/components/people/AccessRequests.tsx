'use client';

// The context access-request queue: "X wants access to Y".
//
// It sits at the top of Members, beside the join requests: from where the member
// stands both are the same act — asking an admin to be let in to something — so
// the one screen that answers people answers both. Approving one writes a grant
// exactly the way an alias's "Can access" list on Types does.

import { useState } from 'react';
import { FileText, Folder, Users } from 'lucide-react';
import { Avatar, Button, ConfirmDialog, SettingsSection } from '@/components/ui';
import { notesApi } from '@/features/notes/lib/notesApi';
import { describeOutcome, requestTargetLabel } from '@/lib/notes/shared/accessRequests';
import { levelName, type AccessLevelName } from '@/lib/notes/shared/authz';
import type { AccessRequest } from '@/lib/notes/shared/brainTypes';
import { usePeopleSection } from './PeopleDataContext';
import { LevelSelect } from './shared';

/** "3 hours ago" without pulling in a date library. */
function relativeTime(epochMs: number): string {
  const mins = Math.round((Date.now() - epochMs) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

function TargetChip({ path, contextName }: { path: string; contextName: string }) {
  const Icon = path === '' ? Users : path.endsWith('.md') ? FileText : Folder;
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 align-middle text-[11px] font-medium text-text-secondary">
      <Icon className="h-3 w-3 shrink-0 opacity-70" />
      <span className="truncate">{requestTargetLabel(path, contextName)}</span>
    </span>
  );
}

export default function AccessRequests() {
  const { communityId, data, busy, run } = usePeopleSection();
  const [denyRequest, setDenyRequest] = useState<AccessRequest | null>(null);
  // Level chosen per request before approving; absent = what was asked for.
  const [levels, setLevels] = useState<Record<string, AccessLevelName>>({});

  const requests = data?.requests ?? [];
  const pending = requests.filter((r) => r.status === 'pending');
  const resolved = requests.filter((r) => r.status !== 'pending').slice(0, 5);
  const contextName = data?.contextName ?? '';

  if (pending.length === 0) return null;

  const resolveRequest = (request: AccessRequest, approveIt: boolean) =>
    run(() =>
      notesApi.resolveAccessRequest(
        communityId,
        request.id,
        approveIt,
        approveIt ? (levels[request.id] ?? levelName(request.level) ?? 'view') : undefined,
      ),
    );

  return (
    <>
      <SettingsSection title={`Access requests (${pending.length})`}>
        <div className="divide-y divide-border-subtle">
          {pending.map((request) => (
            <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <Avatar name={request.requesterName ?? 'Member'} imageUrl={request.requesterImage ?? null} size="sm" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
                    <span className="font-medium text-text-primary">{request.requesterName ?? 'Member'}</span>
                    <span className="text-text-muted">wants access to</span>
                    <TargetChip path={request.resourcePath} contextName={contextName} />
                    <span className="text-xs text-text-muted">· {relativeTime(request.requestedAt)}</span>
                  </div>
                  {request.message && (
                    <p className="mt-1 border-l-2 border-border-default pl-2 text-xs italic text-text-secondary">
                      {request.message}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <LevelSelect
                  value={levels[request.id] ?? levelName(request.level) ?? 'view'}
                  onChange={(level) => setLevels((prev) => ({ ...prev, [request.id]: level }))}
                  disabled={busy}
                />
                <Button
                  variant="pill-primary"
                  onClick={() => void resolveRequest(request, true)}
                  disabled={busy}
                  className="!px-3 !py-1.5 !text-xs"
                >
                  Approve
                </Button>
                <Button
                  variant="pill-secondary"
                  onClick={() => setDenyRequest(request)}
                  disabled={busy}
                  className="!px-3 !py-1.5 !text-xs"
                >
                  Deny
                </Button>
              </div>
            </div>
          ))}
        </div>

        {resolved.length > 0 && (
          <div className="mt-4 space-y-1.5 border-t border-border-subtle pt-3">
            {resolved.map((request) => (
              <div key={request.id} className="flex items-center gap-2 text-xs text-text-muted">
                <span
                  className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 font-semibold ${
                    request.status === 'approved'
                      ? 'bg-brand-green/15 text-brand-green'
                      : 'bg-surface-2 text-text-muted'
                  }`}
                >
                  {request.status === 'approved' ? 'Approved' : 'Denied'}
                </span>
                <span className="min-w-0 truncate">
                  <span className="font-medium text-text-secondary">{request.requesterName ?? 'Member'}</span>
                  {' · '}
                  {describeOutcome(request, contextName)}
                  {request.resolvedAt && <> · {relativeTime(request.resolvedAt)}</>}
                </span>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      <ConfirmDialog
        open={denyRequest !== null}
        title="Deny this request?"
        body={
          denyRequest && (
            <>
              {denyRequest.requesterName ?? 'This member'} won’t get access to{' '}
              <span className="font-medium text-text-primary">
                {requestTargetLabel(denyRequest.resourcePath, contextName)}
              </span>
              . They can ask again.
            </>
          )
        }
        confirmLabel="Deny request"
        destructive
        onConfirm={async () => {
          const request = denyRequest;
          setDenyRequest(null);
          if (request) await resolveRequest(request, false);
        }}
        onClose={() => setDenyRequest(null)}
      />
    </>
  );
}
