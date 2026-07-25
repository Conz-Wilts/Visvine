'use client';

// Console → People & access → Requests: the review queue for context access
// requests filed from the product's denial surfaces (features/notes/components/
// AccessRequestCard.tsx). Approving writes a grant at EXACTLY the requested path
// — no widening — at whatever level the reviewer picks, defaulting to what was
// asked for. Resolved rows stay as the trail of who let whom in.

import { useMemo, useState } from 'react';
import { Folder, FileText, Users } from 'lucide-react';
import { Avatar, Button, ConfirmDialog, SettingsSection } from '@/components/ui';
import { notesApi } from '@/features/notes/lib/notesApi';
import { describeOutcome, requestTargetLabel } from '@/lib/notes/shared/accessRequests';
import { levelName, type AccessLevelName } from '@/lib/notes/shared/authz';
import type { AccessRequest } from '@/lib/notes/shared/brainTypes';
import { LevelSelect, type PeopleData } from './shared';

interface Props {
  communityId: string;
  data: PeopleData;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}

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

export default function RequestsTab({ communityId, data, busy, run }: Props) {
  // Level chosen per row before approving; absent = grant what was asked for.
  const [levels, setLevels] = useState<Record<string, AccessLevelName>>({});
  const [confirm, setConfirm] = useState<AccessRequest | null>(null);

  const pending = useMemo(() => data.requests.filter((r) => r.status === 'pending'), [data.requests]);
  const resolved = useMemo(
    () => data.requests.filter((r) => r.status !== 'pending').slice(0, 10),
    [data.requests],
  );

  const resolve = (request: AccessRequest, approve: boolean) =>
    run(() =>
      notesApi.resolveAccessRequest(
        communityId,
        request.id,
        approve,
        approve ? (levels[request.id] ?? levelName(request.level) ?? 'view') : undefined,
      ),
    );

  return (
    <div className="space-y-8">
      <SettingsSection
        title={`Pending requests (${pending.length})`}
        description="People who hit something they couldn’t open and asked for access. Approving grants them exactly the folder or note they asked for — nothing wider."
      >
        {pending.length === 0 ? (
          <p className="text-sm text-text-muted">No one is waiting for access.</p>
        ) : (
          <div className="space-y-3">
            {pending.map((request) => (
              <div
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface-1 px-3 py-2.5"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Avatar name={request.requesterName ?? 'Member'} imageUrl={request.requesterImage ?? null} size="sm" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
                      <span className="font-medium text-text-primary">{request.requesterName ?? 'Member'}</span>
                      <span className="text-text-muted">wants access to</span>
                      <TargetChip path={request.resourcePath} contextName={data.contextName} />
                      <span className="text-xs text-text-muted">· {relativeTime(request.requestedAt)}</span>
                    </div>
                    {request.requesterEmail && (
                      <div className="truncate text-xs text-text-muted">{request.requesterEmail}</div>
                    )}
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
                    onClick={() => void resolve(request, true)}
                    disabled={busy}
                    className="!px-3 !py-1.5 !text-xs"
                  >
                    Approve
                  </Button>
                  <Button
                    variant="pill-secondary"
                    onClick={() => setConfirm(request)}
                    disabled={busy}
                    className="!px-3 !py-1.5 !text-xs"
                  >
                    Deny
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      {resolved.length > 0 && (
        <SettingsSection
          title="Recently resolved"
          description="The last few decisions, and who made them."
        >
          <div className="space-y-2">
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
                  {describeOutcome(request, data.contextName)}
                  {request.resolvedByName && <> · by {request.resolvedByName}</>}
                  {request.resolvedAt && <> · {relativeTime(request.resolvedAt)}</>}
                </span>
              </div>
            ))}
          </div>
        </SettingsSection>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title="Deny this request?"
        body={
          confirm && (
            <>
              {confirm.requesterName ?? 'This member'} won’t get access to{' '}
              <span className="font-medium text-text-primary">
                {requestTargetLabel(confirm.resourcePath, data.contextName)}
              </span>
              . They can ask again.
            </>
          )
        }
        confirmLabel="Deny request"
        destructive
        onConfirm={async () => {
          const request = confirm;
          setConfirm(null);
          if (request) await resolve(request, false);
        }}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
