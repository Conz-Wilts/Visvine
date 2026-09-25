'use client';

import { useEffect, useState } from 'react';
import { Modal, Skeleton } from '@visvine/ui';
import { fetchJson } from '@/lib/fetchJson';
import { timeAgo } from '@/lib/date';
import type { ToolAbout as ToolAboutData } from '@/lib/tools/about';

/**
 * A Tool's About — its package page, opened from the ⋯ menu on its page. What
 * it is, which release, who made it, what it can do in words, what can leave
 * the space through it, and how widely it runs. Facts, joined by `·`.
 */
export default function ToolAbout({
  spaceId,
  installId,
  onClose,
}: {
  spaceId: string;
  installId: string;
  onClose: () => void;
}) {
  const [about, setAbout] = useState<ToolAboutData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchJson<{ about: ToolAboutData }>(
      `/api/spaces/${encodeURIComponent(spaceId)}/tools/${encodeURIComponent(installId)}/about`,
    )
      .then((res) => live && setAbout(res.about))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not load this tool'));
    return () => {
      live = false;
    };
  }, [spaceId, installId]);

  return (
    <Modal onClose={onClose} title={about?.title ?? 'About'} size="sm">
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
              {[
                `v${about.version}`,
                about.publisher.here ? 'made in this space' : about.publisher.name ? `from ${about.publisher.name}` : null,
                about.verified ? 'verified' : null,
                about.author ? `by ${about.author}` : null,
                timeAgo(new Date(about.publishedAt).getTime(), { style: 'short' }),
                about.listed
                  ? `reviewed by Visvine${about.reviewedAt ? ` ${timeAgo(new Date(about.reviewedAt).getTime(), { style: 'short' })}` : ''}`
                  : null,
                `${about.installs} ${about.installs === 1 ? 'space' : 'spaces'}`,
                about.license,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {about.stopped && <p className="text-danger">{about.stopped}</p>}

            <section className="border-t border-line-subtle pt-4">
              <h3 className="pb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Can</h3>
              <ul className="flex flex-col gap-1 text-fg">
                {about.reach.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>

            <section className="border-t border-line-subtle pt-4">
              <h3 className="pb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Egress</h3>
              <p className="text-fg">{about.egress.length === 0 ? 'None' : about.egress.join(', ')}</p>
            </section>

            {about.releaseNotes && (
              <section className="border-t border-line-subtle pt-4">
                <h3 className="pb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  v{about.version}
                </h3>
                <p className="whitespace-pre-line text-fg-secondary">{about.releaseNotes}</p>
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
