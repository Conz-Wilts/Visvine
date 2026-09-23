'use client';

import { ExternalLinkIcon, RefreshCwIcon, TriangleAlertIcon } from '@/features/shared/icons';
import Link from '@/features/shared/components/SpaceLink';
import { clsx } from 'clsx';
import { Button } from '@visvine/ui';

/**
 * What a Tool's pane shows when the Tool is the thing that broke.
 *
 * The rule from the brief is "a crash or timeout renders an in-pane error card
 * with a report path — never a broken app shell", so this card is deliberately
 * modest: it occupies the space the Tool would have, says what happened in one
 * sentence, and offers exactly two moves — try again, or go look at the Tool
 * itself. No stack trace: the viewer of a marketplace Tool is not its author,
 * and the author reads the compile/run diagnostics on the Tool's own page.
 */
export default function ToolErrorCard({
  title,
  message,
  reportHref,
  reportLabel = 'View this Tool',
  onReload,
  className,
}: {
  /** The Tool's name, so the card says which one failed. */
  title: string;
  message: string;
  /** Where to go to look into it — the Tool's page or its marketplace entry. */
  reportHref: string;
  reportLabel?: string;
  onReload: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={clsx(
        'flex w-full flex-col items-center justify-center gap-3 px-6 py-10 text-center',
        className,
      )}
    >
      <TriangleAlertIcon className="h-5 w-5 text-warning" />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-fg">{title} stopped working</p>
        <p className="mx-auto max-w-[46ch] text-sm text-fg-muted">{message}</p>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onReload} className="inline-flex items-center gap-1.5">
          <RefreshCwIcon className="h-3.5 w-3.5" />
          Reload
        </Button>
        <Link
          href={reportHref}
          className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium text-fg-secondary hover:text-fg"
        >
          <ExternalLinkIcon className="h-3.5 w-3.5" />
          {reportLabel}
        </Link>
      </div>
    </div>
  );
}
