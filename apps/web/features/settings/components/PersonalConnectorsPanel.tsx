'use client';

import { useEffect, useState } from 'react';
import { Alert, Skeleton } from '@/components/ui';
import { fetchJson } from '@/lib/fetchJson';
import ConnectorsPanel from '@/features/connectors/components/ConnectorsPanel';

/**
 * Your own connectors: the vetted MCP servers. Sign in to one here, and it
 * works in every space you are in.
 *
 * The note lives in your personal space, so nobody else can see it, run it or
 * reach the tokens — but connector resolution looks there whenever the space
 * you are in has no connector by that name
 * (lib/connectors/service.ts#ConnectorSource). That is the whole mechanism:
 * your Notion is yours wherever you go, and it is still only ever YOUR account
 * being spent, because a run resolves through the person it runs as.
 *
 * Only what you sign in to is offered here — the vetted MCP servers and the
 * one-press Google recipes (lib/connectors/catalog.ts#catalogForScope). An API
 * key, an OAuth app you register, a database or a model key is a space's
 * configuration, and lives in the Space Console.
 *
 * A space's own connector always wins its name. An admin who has configured
 * `notion-mcp` for the team has decided what its agents reach and whose
 * credentials they use, and a personal note must never quietly displace that.
 *
 * The panel needs a real space id, and a personal space is provisioned lazily,
 * so the id is fetched rather than derived (GET /api/user/personal-space).
 *
 * It has no page of its own — PersonalConnectorsDialog opens it from the
 * account menu — so where the OAuth round trip lands is the caller's to say.
 */

export default function PersonalConnectorsPanel({ returnTo }: { returnTo: string }) {
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
