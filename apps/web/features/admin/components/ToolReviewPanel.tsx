'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Alert, Button, Chip, ConfirmDialog, Field, LoadingText, Textarea } from '@/components/ui';
import { Trash2Icon } from '@/features/shared/icons';
import PerimeterSummary from '@/features/tools/components/PerimeterSummary';
import CodeDiff from '@/features/tools/components/CodeDiff';
import ToolIcon from '@/features/tools/components/toolIcons';
import { diffLines } from '@/features/tools/lib/diff';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { timeAgo } from '@/lib/date';
import { formatBytes } from '@/lib/utils';
import type {
  ReviewDecisionResponse,
  ReviewDetailResponse,
  ReviewQueueItem,
  ReviewQueueResponse,
  ToolVersionSummary,
} from '@/lib/tools/api';

/**
 * The Visvine super admin's Tool review queue.
 *
 * This is the one screen in the console that is not about a space: the queue is
 * global, the gate is `isSuperAdmin`, and the question being answered is
 * "should every space be able to install this code?". So it shows the two things
 * that question needs and nothing else — the declared perimeter (diffed against
 * the last approved version, because a v4 asking for one new glob is a different
 * decision from a v1 asking for five) and the code itself, as a diff for the
 * same reason.
 *
 * Explicit Approve / Reject buttons, not the console's autosave: every other
 * section edits the space's own record, where a save is a correction. A verdict
 * is a publication, and publications are pressed.
 */

/** The three files a version is made of, in the order a reviewer reads them. */
const FILES = [
  { key: 'uiSource', filename: 'ui.tsx' },
  { key: 'dataSource', filename: 'data.js' },
  { key: 'indexSource', filename: 'index.md' },
] as const;

const STATUS_COLOR: Record<string, string> = {
  approved: '#16a34a',
  rejected: '#dc2626',
  pending: '#d97706',
  withdrawn: '#6b7280',
};

export interface ToolReviewQueue {
  items: ReviewQueueItem[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * The pending queue, fetched once and shared by the console's badge and this
 * panel. `enabled` is false for everyone but a super admin — a regular admin's
 * console must not call a route that would only 403 at them, and the section
 * they never see must not cost them a request.
 */
export function useToolReviewQueue(enabled: boolean): ToolReviewQueue {
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    fetchJson<ReviewQueueResponse>('/api/tools/review')
      .then((data) => {
        if (!live) return;
        setItems(data.queue);
        setError(null);
      })
      .catch((err: Error) => {
        if (live) setError(err.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [enabled, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { items, loading, error, refresh };
}

/** "ui.tsx +12 −3" — the one line that says whether this is a tweak or a rewrite. */
function changeSummary(detail: ReviewDetailResponse): string {
  const parts = FILES.map(({ key, filename }) => {
    const diff = diffLines(detail.previous?.[key] ?? '', detail.version[key] ?? '');
    if (diff.unchanged) return `${filename} unchanged`;
    return `${filename} +${diff.added} −${diff.removed}`;
  });
  const perimeter = detail.version.perimeterDiff;
  const added = Object.values(perimeter).reduce((n, group) => n + group.added.length, 0);
  const removed = Object.values(perimeter).reduce((n, group) => n + group.removed.length, 0);
  if (added || removed) parts.push(`perimeter +${added} −${removed}`);
  return parts.join(' · ');
}

/** One row in either list — same shape for a submission and for a decision. */
function VersionRow({
  version,
  selected,
  subtitle,
  onSelect,
}: {
  version: ToolVersionSummary;
  selected: boolean;
  subtitle: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected}
      className={clsx(
        'w-full rounded-xl px-3 py-2.5 text-left transition-colors',
        selected ? 'bg-surface-2 ring-1 ring-border-default' : 'hover:bg-surface-2',
      )}
    >
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
          {version.title}
        </span>
        <span className="shrink-0 font-mono text-xs text-text-muted">v{version.version}</span>
      </span>
      <span className="mt-0.5 block truncate text-xs text-text-muted">{subtitle}</span>
    </button>
  );
}

export default function ToolReviewPanel({ queue }: { queue: ToolReviewQueue }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReviewDetailResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [note, setNote] = useState('');
  const [deciding, setDeciding] = useState<'approved' | 'rejected' | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((text: string, tone: 'success' | 'error') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // Land on the oldest waiting submission, which is what a queue is for. Only
  // while nothing is chosen, so a refresh after a verdict doesn't yank the
  // reviewer off the version they just decided.
  useEffect(() => {
    setSelectedId((current) => current ?? queue.items[0]?.id ?? null);
  }, [queue.items]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let live = true;
    setDetailLoading(true);
    setDetailError(null);
    setNote('');
    fetchJson<ReviewDetailResponse>(`/api/tools/review/${selectedId}`)
      .then((data) => {
        if (live) setDetail(data);
      })
      .catch((err: Error) => {
        if (!live) return;
        setDetail(null);
        setDetailError(err.message);
      })
      .finally(() => {
        if (live) setDetailLoading(false);
      });
    return () => {
      live = false;
    };
  }, [selectedId]);

  const summary = useMemo(() => (detail ? changeSummary(detail) : null), [detail]);

  async function decide(decision: 'approved' | 'rejected') {
    if (!detail) return;
    setDeciding(decision);
    try {
      const trimmed = note.trim();
      const result = await fetchJsonBody<ReviewDecisionResponse>(
        `/api/tools/review/${detail.version.id}`,
        'POST',
        { decision, ...(trimmed ? { note: trimmed } : {}) },
      );
      // The version left the queue. The selection stays put so the verdict is
      // visible where the buttons were.
      queue.refresh();
      setDetail((prev) => (prev ? { ...prev, version: { ...prev.version, ...result.version } } : prev));
      setNote('');
      showToast(
        decision === 'approved'
          ? `Approved ${result.version.title} v${result.version.version}${
              result.upgraded ? ` — ${result.upgraded} install${result.upgraded === 1 ? '' : 's'} offered the upgrade` : ''
            }.`
          : `Rejected ${result.version.title} v${result.version.version}.`,
        'success',
      );
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setDeciding(null);
    }
  }

  /**
   * Delete the selected version from the registry outright. The server refuses
   * it (409) while any space runs it — its sentence lands in the toast.
   */
  async function removeVersion() {
    if (!detail) return;
    const target = detail.version;
    setConfirmingDelete(false);
    setDeleting(true);
    try {
      await fetchJson<{ ok: true }>(`/api/tools/review/${target.id}`, { method: 'DELETE' });
      queue.refresh();
      setSelectedId(null);
      setDetail(null);
      showToast(`Deleted ${target.title} v${target.version} from the registry.`, 'success');
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setDeleting(false);
    }
  }

  const version = detail?.version;
  const pendingDecision = version?.status === 'pending';

  return (
    <div className="w-full">
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* What is waiting. Decided versions leave the screen — a past verdict
            is read on the Tool's own version trail, not here. */}
        <div className="w-full shrink-0 space-y-6 lg:w-72">
          <section>
            <h2 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
              Waiting {queue.items.length > 0 && `(${queue.items.length})`}
            </h2>
            {queue.loading ? (
              <div className="px-3">
                <LoadingText text="Loading queue…" />
              </div>
            ) : queue.error ? (
              <Alert variant="error">{queue.error}</Alert>
            ) : queue.items.length === 0 ? (
              <p className="px-3 text-sm text-text-muted">Nothing is waiting for review.</p>
            ) : (
              <div className="space-y-1">
                {queue.items.map((item) => (
                  <VersionRow
                    key={item.id}
                    version={item}
                    selected={item.id === selectedId}
                    subtitle={`${item.author.name ?? 'Unknown author'} · ${timeAgo(item.submittedAt, { style: 'short' })}`}
                    onSelect={() => setSelectedId(item.id)}
                  />
                ))}
              </div>
            )}
          </section>

        </div>

        {/* The submission itself. */}
        <div className="min-w-0 flex-1">
          {detailLoading && !detail ? (
            <LoadingText text="Loading submission…" />
          ) : detailError ? (
            <Alert variant="error">{detailError}</Alert>
          ) : !version ? null : (
            <div className="space-y-6">
              <header>
                <div className="flex flex-wrap items-center gap-2">
                  {/* A Tool that ships its own glyph is asking to draw in every
                      installing space's sidebar. The reviewer approving that
                      should be looking at it, not at the word "custom". The
                      markup is sanitized at build time (lib/tools/iconSvg.ts)
                      and stored sanitized — this renders, it does not re-check. */}
                  {version.surfaces.rail && (
                    <span
                      className="shrink-0 text-text-primary"
                      title={version.iconSvg ? 'This tool ships its own icon' : 'Built-in icon'}
                    >
                      <ToolIcon name={version.surfaces.rail.icon} svg={version.iconSvg} />
                    </span>
                  )}
                  <h2 className="text-base font-semibold text-text-primary">{version.title}</h2>
                  <Chip tone="solid" size="sm" color={STATUS_COLOR[version.status]}>
                    {version.status}
                  </Chip>
                  {version.iconSvg && (
                    <Chip tone="muted" size="sm">
                      custom icon
                    </Chip>
                  )}
                  {/* The reviewer's bin: removes this version row from the
                      registry for good. Refused server-side while any space
                      runs it, so a stray click can never strand an install. */}
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    disabled={deleting}
                    aria-label={`Delete ${version.title} v${version.version} from the registry`}
                    title="Delete this version from the registry"
                    className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                  >
                    <Trash2Icon className="h-4 w-4" />
                  </button>
                </div>
                {version.description && (
                  <p className="mt-1 text-sm text-text-secondary">{version.description}</p>
                )}
                {/* Who is asking, from where, and how long it has waited — the
                    provenance a reviewer needs before reading a line of code. */}
                <dl className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                  <dd className="font-mono">{version.key}</dd>
                  <dd>·</dd>
                  <dd className="font-mono">v{version.version}</dd>
                  <dd>·</dd>
                  <dd>{version.author.name ?? 'Unknown author'}</dd>
                  <dd>·</dd>
                  <dd className="font-mono">{version.sourceSpaceId}</dd>
                  <dd>·</dd>
                  <dd>submitted {timeAgo(version.submittedAt)}</dd>
                  <dd>·</dd>
                  <dd>{formatBytes(version.sizeBytes)}</dd>
                </dl>
              </header>

              {/* What the author says changed — read before the diff, because
                  it is the claim the diff either bears out or doesn't. */}
              {version.releaseNotes && (
                <section>
                  <h3 className="mb-1 text-sm font-semibold text-text-primary">Release notes</h3>
                  <p className="whitespace-pre-line rounded-lg bg-surface-2 px-3 py-2 text-sm text-text-secondary">
                    {version.releaseNotes}
                  </p>
                </section>
              )}
              {version.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {version.tags.map((tag) => (
                    <Chip key={tag} tone="solid" size="sm">
                      {tag}
                    </Chip>
                  ))}
                </div>
              )}

              <section>
                <h3 className="mb-2 text-sm font-semibold text-text-primary">
                  Declared reach
                  {detail.previous && (
                    <span className="ml-2 font-normal text-text-muted">
                      against v{detail.previous.version}
                    </span>
                  )}
                </h3>
                <PerimeterSummary perimeter={version.perimeter} diff={version.perimeterDiff} />
              </section>

              {/* One line before three diffs: a reviewer should know whether
                  this is a typo fix or a new Tool before scrolling. */}
              <p className="rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs text-text-secondary">
                {detail.previous ? summary : `First submission · ${summary}`}
              </p>

              <section className="space-y-3">
                {FILES.map(({ key, filename }) => (
                  <CodeDiff
                    key={filename}
                    filename={filename}
                    before={detail.previous?.[key] ?? ''}
                    after={version[key] ?? ''}
                  />
                ))}
              </section>

              {pendingDecision ? (
                <section className="space-y-3 border-t border-border-subtle pt-4">
                  {/* The note is the author's only channel back — a rejection
                      with nothing in here is a verdict with no reason. */}
                  <Field label="Note to the author (optional)">
                    <Textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={3}
                      maxLength={4000}
                      placeholder="Why this is approved, or what has to change."
                    />
                  </Field>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="brand"
                      onClick={() => decide('approved')}
                      disabled={deciding !== null}
                      loading={deciding === 'approved'}
                      loadingText="Approving…"
                    >
                      Approve
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => decide('rejected')}
                      disabled={deciding !== null}
                      loading={deciding === 'rejected'}
                      loadingText="Rejecting…"
                    >
                      Reject
                    </Button>
                    <p className="text-xs text-text-muted">
                      Approving lets any space install this version and offers it as an upgrade to
                      spaces already running an older one — it never changes code under them.
                    </p>
                  </div>
                </section>
              ) : (
                <Alert variant={version.status === 'approved' ? 'success' : 'info'}>
                  {version.status === 'approved' ? 'Approved' : `Marked ${version.status}`}
                  {version.reviewedAt ? ` ${timeAgo(version.reviewedAt)}` : ''}
                  {version.reviewNote ? ` — “${version.reviewNote}”` : '.'}
                </Alert>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete ${version?.title ?? ''} v${version?.version ?? ''}?`}
        body={
          <>
            This removes the version from the registry for good — it leaves the marketplace and can never
            be installed again. It is refused while any space still runs it. The author&rsquo;s working copy
            in their space is untouched.
          </>
        }
        confirmLabel="Delete version"
        destructive
        onConfirm={removeVersion}
        onClose={() => setConfirmingDelete(false)}
      />

      {toast && (
        <div
          role="status"
          className={clsx(
            'fixed bottom-6 right-6 z-50 max-w-sm rounded-xl px-4 py-3 text-sm shadow-float',
            toast.tone === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-red-600 text-white',
          )}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
