'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Modal, Skeleton } from '@/components/ui';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { fetchJson } from '@/lib/fetchJson';
import ConnectorsPanel from '@/features/connectors/components/ConnectorsPanel';

/**
 * Connectors, as a dialog off the account menu — the two kinds there are,
 * side by side.
 *
 * YOURS are accounts you signed in to: the vetted MCP servers and the
 * one-press Google recipes. The note lives in your personal space, so nobody
 * else can see it or reach the tokens, and it works in every space you are in
 * because a name a space has no connector for resolves to your own
 * (lib/connectors/service.ts#readConnectorNote). A space's own connector always
 * wins its name.
 *
 * THE SPACE'S are its configuration — the services an admin connected for the
 * team and the models its agents run on. An admin manages them here exactly as
 * in the Space Console (it is the same panel); a member sees what the space
 * has and signs in to their own account where a connector needs one.
 *
 * It is not a page: connecting one is a thing you do in a minute and then
 * forget, so the menu opens it over whatever you were doing and closing it
 * puts you back there. The one thing that leaves the app is the sign-in, and a
 * dialog cannot survive a round trip to a provider — so the return path is
 * THIS page plus `?connectors=<segment>`, which is what UserMenu re-opens the
 * dialog on, landing on the list showing the account you just linked.
 */
export const CONNECTORS_PARAM = 'connectors';

type Segment = 'personal' | 'space';

/** Which segment a `?connectors=` value opens — `1` is the old spelling of yours. */
export function connectorsSegment(value: string | null): Segment | null {
  if (value === 'space') return 'space';
  if (value === '1' || value === 'personal') return 'personal';
  return null;
}

export default function ConnectorsDialog({
  initial = 'personal',
  onClose,
}: {
  initial?: Segment;
  onClose: () => void;
}) {
  const { currentSpace, isAdmin } = useSpace();
  const [segment, setSegment] = useState<Segment>(currentSpace ? initial : 'personal');

  // Read once, at open: the path is where the provider sends the browser back.
  const [pathname] = useState(() => (typeof window === 'undefined' ? '/settings' : window.location.pathname));
  const returnTo = `${pathname}?${CONNECTORS_PARAM}=${segment === 'space' ? 'space' : '1'}`;

  const segments: Array<{ id: Segment; label: string }> = [
    { id: 'personal', label: 'Yours' },
    ...(currentSpace ? [{ id: 'space' as const, label: currentSpace.name }] : []),
  ];

  return (
    <Modal
      onClose={onClose}
      title="Connectors"
      size="md"
      // The panel is a list whose length changes with the segment and tab —
      // one connected server, then thirty available ones. A floor and a
      // ceiling keep the dialog one shape across that: it never collapses onto
      // a single row, and never grows past the viewport before the list starts
      // scrolling.
      panelClassName="bg-surface-1 rounded-xl shadow-float flex flex-col max-h-[85vh] min-h-[min(32rem,85vh)]"
    >
      {/* The panel's rows bleed 12px either side to draw their hover fill, so
          the body it sits in owns the gutter. */}
      <div className="flex flex-col gap-4 px-6 py-5">
        {segments.length > 1 && (
          <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
            {segments.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSegment(s.id)}
                aria-pressed={segment === s.id}
                className={`min-w-0 flex-1 truncate rounded-md px-3 py-1.5 text-sm transition-colors ${
                  segment === s.id
                    ? 'bg-surface-1 font-medium text-text-primary shadow-sm'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <p className="text-xs text-text-muted">
          {segment === 'personal'
            ? 'Accounts you sign in to. They work in every space you are in, and only ever spend your account.'
            : isAdmin
              ? 'What this space connected for everyone in it, and the models its agents run on.'
              : 'What this space connected for everyone in it. Sign in where a connector needs your own account.'}
        </p>

        {segment === 'personal' || !currentSpace ? (
          <PersonalConnectors returnTo={returnTo} />
        ) : (
          <>
            <ConnectorsPanel space={currentSpace.id} scope="space" returnTo={returnTo} onLeave={onClose} />
            {isAdmin && (
              <p className="text-xs text-text-muted">
                Also in the{' '}
                <Link href="/admin?section=connectors" onClick={onClose} className="font-medium text-text-secondary underline underline-offset-2 hover:text-text-primary">
                  Space Console
                </Link>
                .
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * Your own connectors need a real space id, and a personal space is
 * provisioned lazily, so the id is fetched rather than derived
 * (GET /api/user/personal-space).
 */
function PersonalConnectors({ returnTo }: { returnTo: string }) {
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ spaceId: string }>('/api/user/personal-space')
      .then((data) => { if (!cancelled) setSpaceId(data.spaceId); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!spaceId) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
      </div>
    );
  }

  return <ConnectorsPanel space={spaceId} scope="personal" returnTo={returnTo} />;
}
