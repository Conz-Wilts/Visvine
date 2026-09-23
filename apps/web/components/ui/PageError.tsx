'use client';

/**
 * Something didn't load. One line saying so, and — where trying again could
 * actually work — a Retry beside it.
 *
 * Deliberately the quietest thing in the app: no illustration, no heading, no
 * paragraph guessing at what went wrong. A failure is an interruption, and the
 * shortest way through it is the whole design. Every page-level "not found" and
 * "failed to load" in the app renders through here so they all read the same.
 */
export default function PageError({
  message,
  onRetry,
  /** `page` takes the viewport's middle; `inline` sits inside a panel or tab. */
  size = 'page',
}: {
  message: string;
  onRetry?: () => void;
  size?: 'page' | 'inline';
}) {
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-center gap-3 text-center ${size === 'page' ? 'py-24' : 'py-10'}`}
    >
      <p className="text-sm text-fg-muted">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-surface-subtle hover:text-fg"
        >
          Retry
        </button>
      )}
    </div>
  );
}
