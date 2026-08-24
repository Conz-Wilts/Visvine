'use client';

/**
 * The strip at the top of a person's profile that isn't connected to a member.
 *
 * The profile itself always renders — a person node stands in for one until a
 * member is behind it — so the action rides above it rather than replacing the
 * page. Binding the node to its Visvine record is the whole surface: a member
 * is never picked from a list here, the link comes from the person themself.
 * Purely presentational: state comes from useGlobalBinding.
 */

import React, { useState } from 'react';
import { chipClass } from '@/components/ui';
import { useNodeSearch } from '@/features/shared/hooks/useNodeSearch';
import { useGlobalBinding } from '../hooks/useGlobalBinding';
import type { ThemePalette } from '@/lib/profileTheme';
import { cssVars } from './profileCards';

export default function ProfileConnectBar({
  nodeId,
  name,
  theme,
  /** A personal space's notes are your own copy — nothing to bind them to. */
  readOnly = false,
  onBindingChange,
}: {
  nodeId: string;
  name: string;
  theme: ThemePalette;
  readOnly?: boolean;
  onBindingChange?: () => void;
}) {
  const binding = useGlobalBinding(nodeId, onBindingChange);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const search = useNodeSearch(searching ? query : '', 'person');
  const globalHits = search.results.filter((r) => r.global && r.identity_id);
  const bound = binding.state?.record ?? null;

  const action = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} disabled={binding.busy}
            className={chipClass({ tone: 'dashed', size: 'lg' })}
            style={cssVars({ '--accent': theme.dark })}>
      {label}
    </button>
  );

  const status = bound
    ? binding.state?.mode === 'follow'
      ? 'Following the Visvine record — name, details and context mirror the public record.'
      : 'A local copy of the Visvine record: edit it freely here.'
    : 'A record of someone in your space. Bind it to their Visvine record to take the public facts.';

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-2/60 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary">
            {bound ? 'Not connected to a member' : 'Not connected yet'}
          </p>
          <p className="max-w-[68ch] text-[13px] leading-relaxed text-text-muted">{status}</p>
        </div>

        {!readOnly && binding.state !== undefined && (
          <div className="flex flex-wrap items-center gap-2">
            {bound ? (
              <>
                {binding.state?.mode === 'follow'
                  ? action('Detach (keep a local copy)', () => void binding.detach())
                  : action('Follow the record', () => void binding.setMode('follow'))}
                {action('Unbind', () => void binding.unbind())}
              </>
            ) : !searching ? (
              action('Bind to a Visvine record', () => { setQuery(name); setSearching(true); })
            ) : null}
          </div>
        )}
      </div>

      {!readOnly && searching && !bound && (
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
      )}

      {binding.error && <span className="text-xs text-red-600">{binding.error}</span>}
    </section>
  );
}
