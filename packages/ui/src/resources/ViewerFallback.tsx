import type { ReactNode } from 'react';
import FileTypeIcon from './FileTypeIcon';

/**
 * What the viewer shows for a file it cannot draw: the file itself, large and
 * named, with its facts and the ways to open it. A designed screen, not an
 * apology — it says nothing about what is missing.
 */
export default function ViewerFallback({
  kind,
  name,
  meta,
  actions,
}: {
  kind: string;
  name: string;
  meta?: string;
  /** Download, Open in app, Open in browser. */
  actions?: ReactNode;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center">
      <FileTypeIcon kind={kind} size="xl" />
      <div className="max-w-sm">
        <p className="break-words text-base font-semibold text-fg">{name}</p>
        {meta && <p className="mt-1 text-sm text-fg-muted">{meta}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}
