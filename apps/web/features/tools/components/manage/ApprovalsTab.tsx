'use client';

/**
 * Approvals — this space's own queue: the versions its members published that
 * nobody with the authority to say yes has looked at yet.
 *
 * This is the half of the Tool loop that used to be missing. A member edits a
 * Tool, publishes it, and the version waits HERE rather than going anywhere
 * near another space; an admin reads what it reaches, approves, and the
 * space's installs of that Tool are offered the upgrade (which is still applied
 * by hand, over on Installed). Rejecting keeps the version and its note, so the
 * author reads why rather than guessing.
 *
 * Admins only, because the queue IS the decision: a member reading a list of
 * things they cannot act on is a list. The tab is hidden for everyone else.
 */

import { useState } from 'react';
import { Chip, EmptyState, Skeleton, Textarea, Button } from '@visvine/ui';
import { ClipboardListIcon } from '@/features/shared/icons';
import PerimeterSummary from '@/features/tools/components/PerimeterSummary';
import CheckReport from '@/features/tools/components/CheckReport';
import { fetchInstalls, reviewSpaceVersion } from '@/features/tools/lib/client';
import InstallSheet from '@/features/tools/components/InstallSheet';
import { timeAgo } from '@/lib/date';
import type { ApprovalQueueItem } from '@/lib/tools/api';
import { color } from '@visvine/tokens';

export default function ApprovalsTab({
  spaceId,
  queue,
  onReviewed,
  onToast,
}: {
  spaceId: string | null;
  /** The queue the console already read for its badge; null while loading. */
  queue: ApprovalQueueItem[] | null;
  /** The queue changed — the console re-reads it, and the badge with it. */
  onReviewed: () => void;
  onToast: (tone: 'success' | 'error' | 'warning' | 'info', message: string) => void;
}) {
  if (queue === null) return <QueueSkeleton />;
  if (queue.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardListIcon className="h-6 w-6" />}
        title="Nothing waiting"
        description="Nothing is waiting on you. When a member publishes a tool written in this space, it lands here before anything installs."
      />
    );
  }

  return (
    <div className="space-y-6">
      {queue.map((item) => (
        <QueueRow
          key={item.id}
          spaceId={spaceId}
          item={item}
          onDone={onReviewed}
          onToast={onToast}
        />
      ))}
    </div>
  );
}

function QueueRow({
  spaceId,
  item,
  onDone,
  onToast,
}: {
  spaceId: string | null;
  item: ApprovalQueueItem;
  onDone: () => void;
  onToast: (tone: 'success' | 'error' | 'warning' | 'info', message: string) => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // Approved and not yet running here: the next act is installing it, so the
  // sheet opens straight away rather than sending the admin elsewhere.
  const [installing, setInstalling] = useState(false);

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!spaceId || busy) return;
    setBusy(true);
    try {
      const answer = await reviewSpaceVersion(spaceId, item.id, decision, note.trim() || undefined);
      onToast(
        'success',
        decision === 'approved'
          ? `${item.title} v${item.version} approved${
              answer.upgraded > 0
                ? ` — ${answer.upgraded} ${answer.upgraded === 1 ? 'install is' : 'installs are'} offered the upgrade.`
                : '.'
            }`
          : `${item.title} v${item.version} rejected. The author can read your note.`,
      );
      if (decision === 'approved') {
        const installed = await fetchInstalls(spaceId).then((r) => r.installs.some((i) => i.key === item.key)).catch(() => true);
        if (!installed) {
          setInstalling(true);
          return;
        }
      }
      onDone();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'The decision did not go through.');
      setBusy(false);
    }
  };

  return (
    <section className="border-t border-line-subtle pt-5 first:border-t-0 first:pt-0">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-fg">{item.title}</h3>
            <Chip tone="solid" size="sm" color={color.warning.default}>
              v{item.version} · Waiting
            </Chip>
          </div>
          <p className="truncate font-mono text-[11px] text-fg-muted">
            {item.name} · {item.author.name ?? 'someone who has since left'} ·{' '}
            {timeAgo(item.submittedAt)}
          </p>
          {item.description && (
            <p className="mt-1 line-clamp-2 text-sm text-fg-secondary">{item.description}</p>
          )}
        </div>
      </header>

      {item.releaseNotes && (
        <p className="mt-3 border-l-2 border-line pl-3 text-sm text-fg-secondary">
          <span className="font-medium text-fg">What changed</span> — {item.releaseNotes}
        </p>
      )}
      {item.reviewNote && (
        <p className="mt-2 border-l-2 border-line pl-3 text-sm text-fg-secondary">
          <span className="font-medium text-fg">Note to you</span> — {item.reviewNote}
        </p>
      )}

      {/* The decision itself: not what the code says, but what it can reach —
          and, when this space approved an earlier version, what has MOVED. */}
      <PerimeterSummary
        className="mt-4"
        perimeter={item.perimeter}
        diff={item.previousVersion ? item.perimeterDiff : undefined}
      />
      <p className="mt-2 text-xs text-fg-muted">
        {item.previousVersion
          ? `Compared with v${item.previousVersion.version}, the last version this space approved.`
          : 'The first version of this tool — everything it declares is new here.'}
      </p>

      {/* What the automated stages found — the same report its author read. */}
      {item.checks && <CheckReport className="mt-4" report={item.checks} />}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Textarea
          className="min-w-[16rem] flex-1"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="A note for the author — required reading if you reject"
          aria-label="Note for the author"
        />
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void decide('rejected')}>
            Reject
          </Button>
          <Button variant="brand" size="sm" disabled={busy} onClick={() => void decide('approved')}>
            Approve
          </Button>
        </div>
      </div>
      {installing && spaceId && (
        <InstallSheet
          spaceId={spaceId}
          version={item}
          onClose={() => {
            setInstalling(false);
            onDone();
          }}
          onInstalled={(message) => {
            setInstalling(false);
            onToast('success', message);
            onDone();
          }}
        />
      )}
    </section>
  );
}

function QueueSkeleton() {
  return (
    <div className="space-y-6">
      {[0, 1].map((row) => (
        <div key={row} className="space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-72" />
          <Skeleton className="h-16 w-full" />
        </div>
      ))}
    </div>
  );
}
