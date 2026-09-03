'use client';

import { clsx } from 'clsx';
import { CheckIcon, LoaderCircleIcon, RefreshCwIcon } from '@/features/shared/icons';
import type { SaveStatus as SaveStatusValue } from '@/lib/autosave';

/**
 * Small pill that narrates the console's autosave state: nothing at rest,
 * "Saving…" while a request is in flight, a brief "Saved", and a red
 * "Couldn't save · Retry" on failure. Purely presentational — feed it the
 * status from `useAutosave`/`ConsoleSaveContext`.
 */
interface SaveStatusProps {
  status: SaveStatusValue;
  onRetry?: (() => void) | null;
  className?: string;
}

export default function SaveStatus({ status, onRetry, className }: SaveStatusProps) {
  if (status === 'idle') return null;

  if (status === 'error') {
    return (
      <span
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-600',
          className,
        )}
      >
        Couldn&apos;t save
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:opacity-80"
          >
            <RefreshCwIcon size={11} />
            Retry
          </button>
        )}
      </span>
    );
  }

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-text-muted',
        className,
      )}
    >
      {status === 'saving' ? (
        <>
          <LoaderCircleIcon size={12} className="animate-spin" />
          Saving…
        </>
      ) : (
        <>
          <CheckIcon size={12} className="text-brand-dark-green" />
          Saved
        </>
      )}
    </span>
  );
}
