'use client';

import { PlusIcon } from '@/features/shared/icons';

/**
 * The row that MAKES one more of whatever a list holds — "New space" at the
 * head of the switcher, "New type" at the head of the Create panel, "Add
 * model" and "Add a connector" at the head of the account panels. One shape
 * everywhere: a dashed square with a plus where the list's own marks go, then
 * the name, drawn as a row of the list it leads rather than as a button
 * beside it. It leads the list because it is the row you are looking for when
 * none of the ones below is the one you want.
 */
export default function NewRow({
  label,
  hint,
  onClick,
  disabled = false,
}: {
  label: string;
  /** A second line under the name — what making one gets you. */
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="-mx-3 flex min-h-14 w-[calc(100%+1.5rem)] items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-2 disabled:opacity-50"
    >
      <span
        aria-hidden
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-border-default text-text-muted [&>svg]:h-4 [&>svg]:w-4"
      >
        <PlusIcon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-text-primary">{label}</span>
        {hint && <span className="block truncate text-xs text-text-muted">{hint}</span>}
      </span>
    </button>
  );
}
