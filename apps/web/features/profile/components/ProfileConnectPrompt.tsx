'use client';

/**
 * The Profile tab of a person node that isn't connected to a member yet.
 *
 * Every person node has a Profile tab; when there is no member behind it there
 * is no profile to show, so the tab IS the connect surface — the action sits in
 * the middle of the page rather than buried in the context note's header.
 * Purely presentational: state and permissions come from useMemberConnection.
 */

import React from 'react';
import { chipClass } from '@/components/ui';
import PersonSilhouette from '@/components/ui/PersonSilhouette';
import type { ThemePalette } from '@/lib/profileTheme';
import type { useMemberConnection } from '../hooks/useMemberConnection';
import { cssVars } from './profileCards';

type Connection = ReturnType<typeof useMemberConnection>;

export default function ProfileConnectPrompt({
  name,
  theme,
  /** Personal spaces have no member list to connect to — read-only copy only. */
  readOnly = false,
  connection,
}: {
  name: string;
  theme: ThemePalette;
  readOnly?: boolean;
  connection: Connection;
}) {
  const { members, picking, busy, error, connect, openPicker, cancelPicking, viewerId, isAdmin } = connection;

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
        <p className="text-sm font-medium text-text-secondary">Not connected to a member yet</p>
        <p className="max-w-[46ch] text-[13px] leading-relaxed text-text-muted">
          This is a context — a record of someone in your space. Connect it to a member and their
          profile fills this tab.
        </p>
      </div>

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
