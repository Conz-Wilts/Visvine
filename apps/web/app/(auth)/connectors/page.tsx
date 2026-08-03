'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { useCreateModal } from '@/lib/contexts/CreateModalContext';
import { LoadingText, PageTitle } from '@/components/ui';
import { fetchJson } from '@/lib/fetchJson';

/**
 * The Connectors tool: one page listing every connectors/<name>.md note in the
 * community, so the gateways agents can call are visible somewhere other than a
 * folder in Context. The note IS the connector, so each row links to the
 * connector's node page rather than opening an editor of its own.
 *
 * Admins-only, and not by community choice — the list route 403s a member and
 * brainService.writeDenial gates writes to connectors/. That's declared once in
 * featureAccess.ADMIN_ONLY_FEATURE_KEYS, which keeps the nav row and this route
 * away from members, so nothing here re-states it.
 */

interface ConnectorRow {
  name: string;
  path: string;
  alias: string | null;
  description: string | null;
  allow: string[];
  invalid: string | null;
  secrets: string[];
}

/**
 * What this connector lets an agent do, in one line. `allow` is an http-only
 * field, so a postgres connector with an empty list is read-only SQL rather
 * than the documentation-only note an http one with no rules would be.
 */
function summarise(connector: ConnectorRow): string {
  if (connector.alias === 'postgres') return 'Read-only SQL';
  if (connector.allow.length === 0) return 'Documentation only';
  return `${connector.allow.length} allowed request${connector.allow.length === 1 ? '' : 's'}`;
}

function ConnectorRowLink({ connector }: { connector: ConnectorRow }) {
  return (
    <Link
      href={`/directory/${encodeURIComponent(`connector:${connector.name}`)}`}
      className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-surface-2"
    >
      <span className="flex items-center gap-2">
        <span className="truncate text-sm font-medium text-text-primary">{connector.name}</span>
        {connector.alias && (
          <span className="shrink-0 rounded-md bg-surface-3 px-1.5 py-0.5 text-xs text-text-muted">
            {connector.alias}
          </span>
        )}
      </span>
      {connector.description && (
        <span className="truncate text-xs text-text-muted">{connector.description}</span>
      )}
      {connector.invalid ? (
        <span className="text-xs text-red-500">{connector.invalid}</span>
      ) : (
        <span className="text-xs text-text-muted">
          {summarise(connector)}
          {connector.secrets.length > 0 && ` · uses ${connector.secrets.join(', ')}`}
        </span>
      )}
    </Link>
  );
}

export default function ConnectorsPage() {
  // The community has to resolve before the fetch: its id is half the URL, and
  // a switch mid-flight has to re-run this against the community now on screen.
  const { currentCommunity, loading: communityLoading } = useCommunity();
  const { open } = useCreateModal();
  const communityId = currentCommunity?.id;

  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (communityLoading) return;
    if (!communityId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchJson<{ connectors: ConnectorRow[] }>(`/api/communities/${communityId}/connectors`)
      .then(data => {
        if (cancelled) return;
        setConnectors(data.connectors);
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [communityId, communityLoading]);

  const body = () => {
    if (communityLoading || loading) return <LoadingText text="Loading connectors…" />;
    if (error) return <p className="py-12 text-center text-sm text-red-500">{error}</p>;
    if (connectors.length === 0) {
      return (
        <p className="py-12 text-center text-sm text-text-muted">
          No connectors yet. Add one to let agents call an external API or query a database.
        </p>
      );
    }
    return (
      <ul className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
        {connectors.map(connector => (
          <li key={connector.path}>
            <ConnectorRowLink connector={connector} />
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="mx-auto w-full max-w-4xl pb-16">
      <PageTitle
        title="Connectors"
        subtitle="Gateways to external APIs and databases. Each one is a note whose frontmatter is the config and whose body is the documentation agents read."
      />

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={() => open('connector')}
          className="rounded-lg bg-brand-green px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          New connector
        </button>
      </div>

      <div className="mt-4">{body()}</div>
    </div>
  );
}
