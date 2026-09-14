'use client';

import { useEffect, useRef } from 'react';

/**
 * What the draft surface (features/notes/components/DraftContextPanel) hands
 * to the kind being drafted.
 *
 * The draft owns the parts every kind shares — the title, the type chip, the
 * tags, the prose — and a kind surface owns only what its own kind needs
 * beyond those: a person's email, a channel's icon, the files being uploaded.
 * It reports when it is filled in enough to create and registers the write
 * that Create runs; the draft owns the button, the errors and the navigation,
 * so a kind surface never renders one of its own.
 */
export interface DraftShared {
  spaceId: string;
  /** The space's name, for the root row of a folder picker. */
  contextName: string;
  /** The title row's live value — a person's name, a channel's name. */
  title: string;
  setTitle: (title: string) => void;
  tags: string[];
  setTags: (tags: string[]) => void;
  /** The editor body, read at commit: it lives in a ref, not in state. */
  body: () => string;
  /** The folder the draft was opened in, where the kind files into one. */
  folder: string;
  /** The kind's colour. */
  accent: string;
}

/** Every kind surface takes the same three things. */
export interface DraftKindProps {
  shared: DraftShared;
  /** Whether this kind's own fields are filled in enough to create. */
  onReadyChange: (ready: boolean) => void;
  /** The write Create runs, returning the page to land on. */
  registerCommit: (commit: () => Promise<string>) => void;
}

/**
 * Register the kind's write and its readiness on every render, so the closure
 * the draft calls is always the one that can see what was last typed. The
 * registration writes to a ref on the draft rather than to state, so this
 * costs no re-render.
 */
export function useDraftCommit(
  { onReadyChange, registerCommit }: Pick<DraftKindProps, 'onReadyChange' | 'registerCommit'>,
  ready: boolean,
  commit: () => Promise<string>,
) {
  // No dependency array on purpose: the registered closure has to be the one
  // that can see what was last typed, and that changes on every keystroke.
  useEffect(() => { registerCommit(commit); });
  const lastReady = useRef<boolean | null>(null);
  useEffect(() => {
    if (lastReady.current === ready) return;
    lastReady.current = ready;
    onReadyChange(ready);
  }, [ready, onReadyChange]);
}

/** The one box a kind surface is allowed: where you type. */
export const fieldClass =
  'w-full rounded-lg bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted ' +
  'transition-colors focus:bg-surface-1 focus:outline-none focus:ring-1 focus:ring-border-default';

/** The heading over a kind's own rows, in the kind's colour. */
export function SetupSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 flex flex-col gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">{label}</h2>
      {children}
    </section>
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
