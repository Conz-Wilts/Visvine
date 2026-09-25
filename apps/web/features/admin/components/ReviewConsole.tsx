'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Chip, ConfirmDialog, LoadingText, Tabs, ToastHost, Toggle, useToasts } from '@visvine/ui';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { timeAgo } from '@/lib/date';
import type { IncidentRow, ListingRow } from '@/lib/tools/reviewConsole';
import { color } from '@visvine/tokens';
import ToolReviewPanel, { type ToolReviewQueue } from './ToolReviewPanel';

type View = 'queue' | 'incidents' | 'listings';

const SEVERITY_COLOR: Record<string, string> = {
  severe: color.danger.default,
  flag: color.warning.default,
  quality: color.fg.muted,
  report: color.info.default,
};

const STATE_COLOR: Record<string, string> = {
  active: color.success.default,
  suspended: color.warning.default,
  revoked: color.danger.default,
};

/**
 * Visvine's review console — the one surface in the console that is not about
 * a space. The queue of listings to decide, the incidents monitoring and
 * members raised, and every listing with Visvine's hold over it and its word
 * on the publisher. Super admins only; the routes are gated the same way.
 */
export default function ReviewConsole({ queue }: { queue: ToolReviewQueue }) {
  const [view, setView] = useState<View>('queue');
  const { toasts, push, dismiss } = useToasts();
  const toast = useCallback((tone: 'success' | 'error', message: string) => push(tone, message), [push]);
  return (
    <div className="flex flex-col gap-6">
      <Tabs<View>
        label="Review"
        value={view}
        onChange={setView}
        options={[
          { id: 'queue', label: 'Queue' },
          { id: 'incidents', label: 'Incidents' },
          { id: 'listings', label: 'Listings' },
        ]}
      />
      {view === 'queue' && <ToolReviewPanel queue={queue} />}
      {view === 'incidents' && <IncidentsView toast={toast} />}
      {view === 'listings' && <ListingsView toast={toast} />}
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function IncidentsView({ toast }: { toast: (tone: 'success' | 'error', message: string) => void }) {
  const [rows, setRows] = useState<IncidentRow[] | null>(null);
  const [all, setAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    fetchJson<{ incidents: IncidentRow[] }>(`/api/tools/review/incidents${all ? '?status=all' : ''}`)
      .then((res) => live && setRows(res.incidents))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not load incidents'));
    return () => {
      live = false;
    };
  }, [all, nonce]);

  const resolve = async (id: string, action: 'clear' | 'confirm') => {
    try {
      await fetchJsonBody(`/api/tools/review/incidents/${encodeURIComponent(id)}`, 'POST', { action });
      setNonce((n) => n + 1);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not do that');
    }
  };

  if (error) return <Alert>{error}</Alert>;
  if (!rows) return <LoadingText text="Loading incidents…" />;
  return (
    <section className="flex flex-col gap-3">
      <label className="flex items-center gap-3 text-sm text-fg">
        <Toggle checked={all} onChange={setAll} aria-label="Resolved too" />
        Resolved too
      </label>
      {rows.length === 0 ? null : (
        <ul className="flex flex-col divide-y divide-line-subtle">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
              <Chip tone="solid" size="sm" color={SEVERITY_COLOR[row.severity]}>
                {row.kind}
              </Chip>
              <span className="min-w-0 flex-1">
                <span className="font-medium text-fg">{row.listing?.title ?? row.versionId ?? 'a tool'}</span>
                <span className="text-fg-muted">
                  {' · '}
                  {[
                    row.source,
                    row.space?.name,
                    timeAgo(row.createdAt, { style: 'short' }),
                    row.listing && row.listing.state !== 'active' ? row.listing.state : null,
                    row.status !== 'open' ? row.status : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {row.summary && <span className="block truncate text-xs text-fg-secondary">{row.summary}</span>}
              </span>
              {row.status === 'open' && (
                <span className="flex shrink-0 items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => void resolve(row.id, 'clear')}>
                    Clear
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void resolve(row.id, 'confirm')}>
                    Confirm
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ListingsView({ toast }: { toast: (tone: 'success' | 'error', message: string) => void }) {
  const [rows, setRows] = useState<ListingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [removing, setRemoving] = useState<ListingRow | null>(null);

  useEffect(() => {
    let live = true;
    fetchJson<{ listings: ListingRow[] }>('/api/tools/review/listings')
      .then((res) => live && setRows(res.listings))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not load listings'));
    return () => {
      live = false;
    };
  }, [nonce]);

  const act = async (id: string, body: object) => {
    try {
      await fetchJsonBody(`/api/tools/review/listings/${encodeURIComponent(id)}`, 'POST', body);
      setNonce((n) => n + 1);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not do that');
    }
  };

  const rescan = async () => {
    setScanning(true);
    try {
      const res = await fetchJsonBody<{ versions: number; incidents: number; changed: string[] }>('/api/tools/review/rescan', 'POST', { force: true });
      toast('success', `Rescanned ${res.versions} ${res.versions === 1 ? 'version' : 'versions'} · ${res.incidents} new`);
      setNonce((n) => n + 1);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not rescan');
    } finally {
      setScanning(false);
    }
  };

  if (error) return <Alert>{error}</Alert>;
  if (!rows) return <LoadingText text="Loading listings…" />;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => void rescan()} loading={scanning} loadingText="Rescanning…">
          Rescan
        </Button>
      </div>
      <ul className="flex flex-col divide-y divide-line-subtle">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
            <Chip tone="solid" size="sm" color={STATE_COLOR[row.state]}>
              {row.state}
            </Chip>
            <span className="min-w-0 flex-1">
              <span className="font-medium text-fg">{row.title}</span>
              <span className="text-fg-muted">
                {' · '}
                {[
                  row.publisher.name ?? row.publisher.spaceId,
                  `${row.installs} ${row.installs === 1 ? 'install' : 'installs'}`,
                  row.openIncidents ? `${row.openIncidents} open` : null,
                  row.stagedUntil && new Date(row.stagedUntil).getTime() > Date.now() ? 'staged' : null,
                  row.listedAt ? `listed ${timeAgo(row.listedAt, { style: 'short' })}` : 'not listed',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {row.stateReason && row.state !== 'active' && <span className="block truncate text-xs text-fg-secondary">{row.stateReason}</span>}
            </span>
            <label className="flex shrink-0 items-center gap-2 text-xs text-fg-muted">
              <Toggle
                checked={row.publisher.verified}
                onChange={(on) => void act(row.id, { verified: on })}
                aria-label={`Verify ${row.publisher.name ?? row.publisher.spaceId}`}
              />
              Verified
            </label>
            {row.state !== 'revoked' && (
              <span className="flex shrink-0 items-center gap-2">
                {row.state === 'active' && row.listedAt && (
                  <Button size="sm" variant="ghost" onClick={() => void act(row.id, { rerun: true })}>
                    Run review
                  </Button>
                )}
                {row.state === 'active' ? (
                  <Button size="sm" variant="ghost" onClick={() => void act(row.id, { hold: 'suspended' })}>
                    Suspend
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => void act(row.id, { hold: 'active' })}>
                    Reinstate
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setRemoving(row)}>
                  Remove
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.title ?? ''} for good?`}
        body="Every install outside its publisher stops, and it can never be listed again."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (removing) await act(removing.id, { hold: 'revoked' });
          setRemoving(null);
        }}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}
