'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Database, Globe, KeyRound, Plug, Plus } from 'lucide-react';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { useCreateModal } from '@/lib/contexts/CreateModalContext';
import { PageTitle, Skeleton } from '@/components/ui';
import { fetchJson } from '@/lib/fetchJson';

/**
 * The Connectors tool: one page listing every connectors/<name>.md note in the
 * community, so the gateways agents can call are visible somewhere other than a
 * folder in Context. The note IS the connector, so each card links to the
 * connector's node page — where the Connector tab renders its config, its
 * secrets and a live test — rather than opening an editor of its own.
 *
 * Each card answers one question: can an agent use this right now? A connector
 * fails for three different reasons (frontmatter that doesn't parse, a secret
 * that was never stored, an empty allowlist) and they look identical from a
 * folder listing, so the card names which one it is.
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
  /** Referenced but never stored — the quiet reason a valid connector 500s. */
  missingSecrets: string[];
}

type Tone = 'ok' | 'warn' | 'bad';

/**
 * The card's verdict, in the order the failures actually bite: a note that
 * doesn't parse is refused before anything else is consulted, a missing secret
 * before the request is built, and an empty allowlist before it is sent.
 */
function statusOf(connector: ConnectorRow): { label: string; detail: string; tone: Tone } {
  if (connector.invalid) {
    return { label: 'Invalid', detail: connector.invalid, tone: 'bad' };
  }
  if (connector.missingSecrets.length > 0) {
    const names = connector.missingSecrets.join(', ');
    return {
      label: 'Missing secrets',
      detail: `${names} ${connector.missingSecrets.length === 1 ? 'is' : 'are'} not stored yet`,
      tone: 'warn',
    };
  }
  if (connector.alias === 'postgres') {
    return { label: 'Ready', detail: 'Read-only SQL', tone: 'ok' };
  }
  if (connector.allow.length === 0) {
    return { label: 'Docs only', detail: 'No calls permitted yet', tone: 'warn' };
  }
  return {
    label: 'Ready',
    detail: `${connector.allow.length} allowed request${connector.allow.length === 1 ? '' : 's'}`,
    tone: 'ok',
  };
}

const TONE_CLASSES: Record<Tone, string> = {
  ok: 'bg-brand-light-bg text-brand-dark-green',
  warn: 'bg-amber-50 text-amber-700',
  bad: 'bg-red-50 text-red-700',
};

function ConnectorCard({ connector }: { connector: ConnectorRow }) {
  const status = statusOf(connector);
  const Icon = connector.alias === 'postgres' ? Database : connector.alias === 'http' ? Globe : Plug;

  return (
    <Link
      href={`/directory/${encodeURIComponent(`connector:${connector.name}`)}`}
      className="group flex flex-col gap-3 rounded-2xl border border-border-subtle bg-surface-1 p-4 shadow-soft transition-all hover:-translate-y-0.5 hover:border-brand-green"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-light-bg text-brand-dark-green">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text-primary">{connector.name}</p>
            <p className="truncate font-mono text-[11px] text-text-muted">
              {connector.alias ?? 'no alias'}
            </p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASSES[status.tone]}`}>
          {status.label}
        </span>
      </div>

      {connector.description && (
        <p className="line-clamp-2 text-[13px] leading-snug text-text-muted">{connector.description}</p>
      )}

      <div className="mt-auto flex items-center gap-2 text-xs text-text-muted">
        {status.tone === 'ok' ? (
          <span className="truncate">{status.detail}</span>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5">
            <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${status.tone === 'bad' ? 'text-red-500' : 'text-amber-500'}`} />
            <span className="truncate">{status.detail}</span>
          </span>
        )}
        {connector.secrets.length > 0 && connector.missingSecrets.length === 0 && (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <KeyRound className="h-3.5 w-3.5" />
            {connector.secrets.length}
          </span>
        )}
      </div>
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

  const needsAttention = connectors.filter(c => statusOf(c).tone !== 'ok').length;

  const body = () => {
    if (communityLoading || loading) {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}
        </div>
      );
    }
    if (error) {
      return (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          {error}
        </div>
      );
    }
    if (connectors.length === 0) {
      return (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-default px-6 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-light-bg text-brand-dark-green">
            <Plug className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-text-primary">No connectors yet</p>
            <p className="mt-1 text-sm text-text-muted">
              Add one to let agents call an external API or query a database.
            </p>
          </div>
          <button
            type="button"
            onClick={() => open('connector')}
            className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New connector
          </button>
        </div>
      );
    }
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {connectors.map(connector => (
          <ConnectorCard key={connector.path} connector={connector} />
        ))}
      </div>
    );
  };

  return (
    <div className="mx-auto w-full max-w-4xl pb-16">
      <PageTitle
        title="Connectors"
        subtitle="Gateways to external APIs and databases. Each one is a note whose frontmatter is the config and whose body is the documentation agents read."
      />

      <div className="mt-6 flex items-center justify-between gap-3">
        <p className="text-xs text-text-muted">
          {connectors.length > 0 &&
            `${connectors.length} connector${connectors.length === 1 ? '' : 's'}${
              needsAttention > 0 ? ` · ${needsAttention} need${needsAttention === 1 ? 's' : ''} attention` : ''
            }`}
        </p>
        {connectors.length > 0 && (
          <button
            type="button"
            onClick={() => open('connector')}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-green px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New connector
          </button>
        )}
      </div>

      <div className="mt-4">{body()}</div>
    </div>
  );
}
