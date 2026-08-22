'use client';

/**
 * The Profile tab of a person node that isn't connected to a member yet.
 *
 * Every person node has a Profile tab; when there is no member behind it there
 * is no profile to show, so the tab IS the connect surface — the action sits in
 * the middle of the page rather than buried in the context note's header.
 * Purely presentational: state and permissions come from useMemberConnection.
 */

import React, { useState } from 'react';
import { chipClass } from '@/components/ui';
import { useNodeSearch } from '@/features/shared/hooks/useNodeSearch';
import { useGlobalBinding } from '../hooks/useGlobalBinding';
import PersonSilhouette from '@/components/ui/PersonSilhouette';
import type { ThemePalette } from '@/lib/profileTheme';
import type { useMemberConnection } from '../hooks/useMemberConnection';
import { cssVars } from './profileCards';

type Connection = ReturnType<typeof useMemberConnection>;

export default function ProfileConnectPrompt({
  nodeId,
  name,
  theme,
  /** Personal spaces have no member list to connect to — read-only copy only. */
  readOnly = false,
  connection,
  onBindingChange,
}: {
  nodeId: string;
  name: string;
  theme: ThemePalette;
  readOnly?: boolean;
  connection: Connection;
  onBindingChange?: () => void;
}) {
  const { members, picking, busy, error, connect, openPicker, cancelPicking, viewerId, isAdmin } = connection;
  const binding = useGlobalBinding(nodeId, onBindingChange);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const search = useNodeSearch(searching ? query : '', 'person');
  const globalHits = search.results.filter((r) => r.global && r.identity_id);
  const bound = binding.state?.record ?? null;

  const action = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} disabled={busy}
            className={chipClass({ tone: 'dashed', size: 'lg' })}
            style={cssVars({ '--accent': theme.dark })}>
      {label}
    </button>
  );

  return (
    <section className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 px-6 py-12 text-center sm:py-16">
      <div className="h-24 w-24 overflow-hidden rounded-lg bg-surface-2">
        <PersonSilhouette color={theme.base} />
      </div>

      <div className="flex flex-col gap-1.5">
        <h1 className="font-open-sauce text-xl font-bold tracking-tight text-text-primary">{name}</h1>
        {bound ? (
          <>
            <p className="text-sm font-medium text-text-secondary">
              {binding.state?.mode === 'follow' ? 'Following the Visvine record' : 'Bound to the Visvine record'}
            </p>
            <p className="max-w-[46ch] text-[13px] leading-relaxed text-text-muted">
              {binding.state?.mode === 'follow'
                ? 'Name, details and context mirror the public record and update when it does. Detach to keep a copy of your own.'
                : 'A local copy of the public record: edit it freely here. Follow it again to take the record\'s changes.'}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-text-secondary">Not connected yet</p>
            <p className="max-w-[46ch] text-[13px] leading-relaxed text-text-muted">
              This is a context — a record of someone in your space. Bind it to their Visvine record
              to take the public facts, or connect it to a member of this space.
            </p>
          </>
        )}
      </div>

      {!readOnly && binding.state !== undefined && (
        <div className="flex flex-col items-center gap-2">
          {bound ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {binding.state?.mode === 'follow'
                ? action('Detach (keep a local copy)', () => void binding.detach())
                : action('Follow the record', () => void binding.setMode('follow'))}
              {action('Unbind', () => void binding.unbind())}
            </div>
          ) : searching ? (
            <div className="flex w-full max-w-sm flex-col gap-1">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Visvine records…"
                className="rounded-md border border-border-default bg-surface-1 px-2 py-1.5 text-sm text-text-primary"
              />
              {search.loading && <span className="px-1 py-1 text-xs text-text-muted">Searching…</span>}
              {!search.loading && query.trim().length >= 2 && globalHits.length === 0 && (
                <span className="px-1 py-1 text-xs text-text-muted">No Visvine record by that name yet.</span>
              )}
              {globalHits.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  disabled={binding.busy}
                  onClick={() => { void binding.bind(r.identity_id!, 'follow'); setSearching(false); }}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-text-primary hover:bg-surface-2"
                >
                  <span className="truncate">{r.name}</span>
                  {r.subtitle && <span className="truncate text-xs text-text-muted">{r.subtitle}</span>}
                </button>
              ))}
              <button type="button" onClick={() => setSearching(false)} className="self-start px-1 py-1 text-xs text-text-muted">
                Cancel
              </button>
            </div>
          ) : (
            action('Bind to a Visvine record', () => { setQuery(name); setSearching(true); })
          )}
          {binding.error && <span className="text-xs text-red-600">{binding.error}</span>}
        </div>
      )}

      {!readOnly && (
        <div className="flex flex-col items-center gap-2">
          {picking ? (
            <select
              autoFocus
              disabled={busy || members === null}
              defaultValue=""
              onChange={(e) => { if (e.target.value) void connect(e.target.value); }}
              onBlur={cancelPicking}
              className="rounded-md border border-border-default bg-surface-1 px-2 py-1.5 text-sm text-text-primary"
            >
              <option value="" disabled>
                {members === null ? 'Loading members…' : 'Connect to member…'}
              </option>
              {(members ?? []).map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name} ({m.email})
                </option>
              ))}
            </select>
          ) : isAdmin ? (
            action('+ Connect to member', openPicker)
          ) : viewerId ? (
            action('This is me', () => void connect(viewerId))
          ) : null}
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      )}
    </section>
  );
}
