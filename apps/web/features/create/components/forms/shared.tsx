'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';

/**
 * What every inline form in the Create panel is handed. A form is
 * self-contained: it collects what its kind needs, writes it, and reports the
 * page to land on. The panel closes on the route change.
 */
export interface InlineFormProps {
  spaceId: string;
  /** The space's name, for the root option of a folder picker. */
  contextName: string;
  /** A folder the caller was standing in, when the kind lands in one. */
  folder: string | null;
  /** The kind's colour. */
  accent: string;
  /** An alias picked from the list's tree, already on when the form opens. */
  initialAlias?: string | null;
  onDone: (href: string) => void;
}

/**
 * The one box a form is allowed: where you type. Placeholder text is the
 * label — nothing is written above a row.
 */
export const fieldClass =
  'w-full rounded-lg bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted ' +
  'transition-colors focus:bg-surface-1 focus:outline-none focus:ring-1 focus:ring-border-default';

/** Focus the first row once the panel has finished sliding out. */
export function useAutoFocus<T extends HTMLElement>(delayMs: number) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus({ preventScroll: true }), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);
  return ref;
}

/**
 * Runs a form's write once, holds its error, and hands the landing page to the
 * panel. A form calls `submit` from its <form onSubmit>; the footer reads the
 * rest.
 */
export function useCreateSubmit(run: () => Promise<string>, onDone: (href: string) => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      onDone(await run());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setSaving(false);
    }
  }, [run, onDone, saving]);
  return { saving, error, submit };
}

/** The form's one button, and the error when there is one. */
export function FormFooter({
  ready,
  saving,
  error,
  label = 'Create',
}: {
  ready: boolean;
  saving: boolean;
  error: string | null;
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-2 pt-1">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <Button type="submit" variant="brand" disabled={!ready || saving} loading={saving} loadingText="Saving…">
        {label}
      </Button>
    </div>
  );
}

/** Two or three choices in a row, one lit in the kind's colour. */
export function Segmented<T extends string>({
  value,
  options,
  onPick,
  accent,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onPick: (value: T) => void;
  accent: string;
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onPick(opt.value)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm transition-colors ${
              active ? 'text-text-primary' : 'bg-surface-2 text-text-secondary hover:text-text-primary'
            }`}
            style={active ? { background: `color-mix(in srgb, ${accent} 16%, transparent)` } : undefined}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Split a comma-separated tags row. */
export function splitTags(raw: string): string[] {
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}
