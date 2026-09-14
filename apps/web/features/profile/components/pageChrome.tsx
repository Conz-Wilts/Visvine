'use client';

import { useState } from 'react';
import { Trash2Icon } from '@/features/shared/icons';
import { fetchJsonBody } from '@/lib/fetchJson';

/**
 * What a connector's page and a model's page share: the flat section over a
 * rule (no box — the page is one thing, and each section a part of it), the
 * input and button classes, and the write-only editor for a secret chip.
 */

export const FIELD =
  'w-full min-w-0 rounded-lg border border-border-default bg-surface-1 px-3 py-1.5 font-mono text-[13px] text-text-primary outline-none focus:border-brand-green';
export const GHOST_BUTTON =
  'rounded-lg border border-border-default px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';
export const SAVE_BUTTON =
  'rounded-lg bg-brand-green px-3 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50';

export interface SecretStatus {
  name: string;
  set: boolean;
  updatedAt: string | null;
}

/**
 * Title, an optional one-word meta, and at most one action, over a rule. No
 * box: the page is one connector, and each section is a part of it rather than
 * a thing of its own.
 */
export function Section({
  title,
  meta,
  action,
  children,
}: {
  title: string;
  meta?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border-subtle py-5">
      <header className="flex items-center justify-between gap-3 pb-3">
        <h2 className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-text-primary">{title}</span>
          {meta && <span className="shrink-0 font-mono text-[11px] text-text-muted">{meta}</span>}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

/**
 * The write-only form for the one secret chip that was clicked. Values are
 * never read back, so this is always a fresh write — there is nothing to
 * pre-fill and no reason to keep more than one open.
 */
export function SecretEditor({
  secret,
  spaceId,
  onChanged,
  onClose,
}: {
  secret: SecretStatus;
  spaceId: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await fetchJsonBody(`/api/spaces/${spaceId}/secrets`, 'PUT', {
        name: secret.name,
        value,
      });
      setValue('');
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await fetchJsonBody(`/api/spaces/${spaceId}/secrets`, 'DELETE', { name: secret.name });
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-border-subtle bg-surface-2 px-3 py-2.5">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.length > 0) void save();
        }}
      >
        <input
          type="password"
          autoComplete="off"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`Value for ${secret.name}`}
          className={`${FIELD} min-w-0 flex-1`}
        />
        <button type="submit" disabled={busy || value.length === 0} className={SAVE_BUTTON}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onClose} disabled={busy} className={GHOST_BUTTON}>
          Cancel
        </button>
        {secret.set && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            aria-label={`Clear ${secret.name}`}
            title={`Clear ${secret.name}`}
            className="rounded-lg border border-border-default p-1.5 text-text-muted transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          >
            <Trash2Icon className="h-3.5 w-3.5" />
          </button>
        )}
      </form>
      <p className="mt-1.5 text-xs text-text-muted">Encrypted on save, never shown again.</p>
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  );
}
