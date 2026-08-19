'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { KeyRoundIcon, PlugIcon, TriangleAlertIcon } from '@/features/shared/icons';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { PageTitle, Skeleton } from '@/components/ui';
import { fetchJson } from '@/lib/fetchJson';
import { TONE_CHIP, TONE_CLASSES } from '@/features/shared/lib/statusTone';

/**
 * The Connectors tool: one page listing every connectors/<name>.md note in the
 * space, so the gateways agents can call are visible somewhere other than a
 * folder in Context. The note IS the connector, so each card links to the
 * connector's node page — where the Connector tab renders its config, its
 * secrets and a live test — rather than opening an editor of its own.
 *
 * Read-only: connectors are created by writing the note (in Context or over
 * MCP), never from here, so the page has no builder of its own to keep in step
 * with the note format.
 *
 * Each card answers one question: can an agent use this right now? A connector
 * fails for three different reasons (frontmatter that doesn't parse, a secret
 * that was never stored, an empty allowlist) and they look identical from a
 * folder listing, so the card names which one it is.
 *
 * Admins-only, and not by space choice — the list route 403s a member and
 * contextService.writeDenial gates writes to connectors/. That's declared once in
 * featureAccess.ADMIN_ONLY_FEATURE_KEYS, which keeps the nav row and this route
 * away from members, so nothing here re-states it.
 */

interface ConnectorRow {
  name: string;
  path: string;
  /** `model` = an LLM provider the space's agents run on; never runnable, keyed by MODEL_KEY_*. */
  kind: 'http' | 'model';
  model: { provider: string; providerLabel: string; baseURL: string | null; keySecret: string } | null;
  alias: string | null;
  description: string | null;
  hosts: string[];
  allow: string[];
  invalid: string | null;
  warnings: string[];
  secrets: string[];
  /** Referenced but never stored — the quiet reason a valid connector fails. */
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
    if (connector.kind === 'model') {
      return {
        label: 'No key',
        detail: `Add the ${connector.model?.providerLabel ?? 'provider'} API key on the connector's page`,
        tone: 'warn',
      };
    }
    const names = connector.missingSecrets.join(', ');
    return {
      label: 'Missing secrets',
      detail: `${names} ${connector.missingSecrets.length === 1 ? 'is' : 'are'} not stored yet`,
      tone: 'warn',
    };
  }
  if (connector.warnings.length > 0) {
    return { label: 'Needs migration', detail: connector.warnings[0], tone: 'warn' };
  }
  if (connector.kind === 'model') {
    // A model connector has no perimeter to be empty: with its key stored it
    // is ready, and its "hosts" are the provider's pinned endpoint.
    const detail = connector.model?.baseURL
      ? new URL(connector.model.baseURL).host
      : 'custom endpoint (agent settings)';
    return { label: 'Ready', detail: `${connector.model?.providerLabel ?? 'Model'} · ${detail}`, tone: 'ok' };
  }
  if (connector.hosts.length === 0) {
    return { label: 'No network', detail: 'No hosts declared yet', tone: 'warn' };
  }
  return { label: 'Ready', detail: connector.hosts.join(', '), tone: 'ok' };
}

function ConnectorCard({ connector }: { connector: ConnectorRow }) {
  const status = statusOf(connector);

  return (
    <Link
      href={`/directory/${encodeURIComponent(`connector:${connector.name}`)}`}
      className="group flex flex-col gap-3 rounded-2xl border border-border-subtle bg-surface-1 p-4 shadow-soft transition-all hover:-translate-y-0.5 hover:border-brand-green"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text-primary">{connector.name}</p>
            <p className="truncate font-mono text-[11px] text-text-muted">
              {connector.alias ?? 'no alias'}
            </p>
          </div>
        </div>
        {/* A healthy connector says nothing: the badge is there to flag the
            three ways one fails, not to congratulate the working ones. */}
        {status.tone !== 'ok' && (
          <span className={`shrink-0 ${TONE_CHIP} ${TONE_CLASSES[status.tone]}`}>
            {status.label}
          </span>
        )}
      </div>

      {connector.description && (
        <p className="line-clamp-2 text-[13px] leading-snug text-text-muted">{connector.description}</p>
      )}

      <div className="mt-auto flex items-center gap-2 text-xs text-text-muted">
        {status.tone === 'ok' ? (
          <span className="truncate">{status.detail}</span>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5">
            <TriangleAlertIcon className={`h-3.5 w-3.5 shrink-0 ${status.tone === 'bad' ? 'text-red-500' : 'text-amber-500'}`} />
            <span className="truncate">{status.detail}</span>
          </span>
        )}
        {connector.secrets.length > 0 && connector.missingSecrets.length === 0 && (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <KeyRoundIcon className="h-3.5 w-3.5" />
            {connector.secrets.length}
          </span>
        )}
      </div>
    </Link>
  );
}

export default function ConnectorsPage() {
  // The space has to resolve before the fetch: its id is half the URL, and
  // a switch mid-flight has to re-run this against the space now on screen.
  const { currentSpace, loading: spaceLoading } = useSpace();
  const spaceId = currentSpace?.id;

  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (spaceLoading) return;
    if (!spaceId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchJson<{ connectors: ConnectorRow[] }>(`/api/communities/${spaceId}/connectors`)
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
  }, [spaceId, spaceLoading]);

  const body = () => {
    if (spaceLoading || loading) {
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
            <PlugIcon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-text-primary">No connectors yet</p>
            <p className="mt-1 text-sm text-text-muted">
              Add one by writing a <code className="font-mono text-[13px]">connectors/&lt;name&gt;.md</code> note
              in Context, or over MCP.
            </p>
          </div>
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
      <PageTitle title="Connectors" />

      <div className="mt-4">{body()}</div>
    </div>
  );
}
