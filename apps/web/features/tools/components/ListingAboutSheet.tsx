'use client';

import { useEffect, useState } from 'react';
import { Button, Modal, Skeleton } from '@visvine/ui';
import { timeAgo } from '@/lib/date';
import type { ListingAboutResponse } from '@/lib/tools/api';
import { fetchListingAbout } from '../lib/client';
import GlobalInstallSheet, { listingFacts } from './GlobalInstallSheet';
import ListingSource from './ListingSource';
import ReachSentences from './ReachSentences';

/**
 * A listed Tool's About for someone who has not installed it — its package
 * page in Discover: what it is, who published it and how widely it runs, what
 * it can do in words, what can leave a space through it, and what changed.
 * Install opens the sheet for a space the viewer runs; Source is the code.
 */
export default function ListingAboutSheet({
  listingId,
  onClose,
  onInstalled,
}: {
  listingId: string;
  onClose: () => void;
  onInstalled: (message: string) => void;
}) {
  const [data, setData] = useState<ListingAboutResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'about' | 'install' | 'source'>('about');

  useEffect(() => {
    const ctl = new AbortController();
    fetchListingAbout(listingId, ctl.signal)
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load this tool');
      });
    return () => ctl.abort();
  }, [listingId]);

  if (data && view === 'install') {
    return <GlobalInstallSheet about={data.about} spaces={data.spaces} onClose={() => setView('about')} onInstalled={onInstalled} />;
  }
  if (data && view === 'source') {
    return <ListingSource listingId={listingId} title={data.about.title} onClose={() => setView('about')} />;
  }

  const about = data?.about;
  const canInstall = !!data && data.spaces.some((s) => !s.installed && !s.refusal);
  return (
    <Modal
      onClose={onClose}
      title={about?.title ?? 'Tool'}
      size="md"
      footer={
        data && data.spaces.length > 0 ? (
          <div className="flex items-center justify-between gap-2 px-6 py-3">
            <Button variant="ghost" size="sm" onClick={() => setView('source')}>
              Source
            </Button>
            <Button variant="brand" size="sm" onClick={() => setView('install')} disabled={!canInstall}>
              Install
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5 px-6 py-5 text-sm">
        {error ? (
          <p className="text-danger">{error}</p>
        ) : !about ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <>
            {about.description && <p className="text-fg">{about.description}</p>}
            <p className="text-fg-muted">
              {[about.release ?? `v${about.version}`, listingFacts(about), about.author ? `by ${about.author}` : null].filter(Boolean).join(' · ')}
            </p>

            <section className="border-t border-line-subtle pt-4">
              <h3 className="pb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Can</h3>
              <ReachSentences manifest={about.manifest} bindings={{}} space={null} />
            </section>

            <section className="border-t border-line-subtle pt-4">
              <h3 className="pb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Egress</h3>
              <p className="text-fg">{about.egress.length === 0 ? 'None' : about.egress.join(', ')}</p>
            </section>

            {about.history.some((h) => h.releaseNotes) && (
              <section className="border-t border-line-subtle pt-4">
                <h3 className="pb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Changes</h3>
                <ul className="flex flex-col gap-3">
                  {about.history
                    .filter((h) => h.releaseNotes)
                    .slice(0, 5)
                    .map((h) => (
                      <li key={h.version}>
                        <p className="text-xs text-fg-muted">
                          {[h.release ?? `v${h.version}`, h.reviewedAt ? timeAgo(new Date(h.reviewedAt).getTime(), { style: 'short' }) : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        <p className="whitespace-pre-line text-fg-secondary">{h.releaseNotes}</p>
                      </li>
                    ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
