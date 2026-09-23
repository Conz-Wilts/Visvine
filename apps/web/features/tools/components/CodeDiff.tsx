'use client';

import { useMemo } from 'react';
import { clsx } from 'clsx';
import { diffLines, type DiffLine } from '../lib/diff';

/** Per-kind painting. Keys match `DiffLine['kind']`. */
const LINE_CLASS: Record<DiffLine['kind'], string> = {
  context: 'text-fg-secondary',
  add: 'bg-success-wash text-success-strong',
  remove: 'bg-danger-wash text-danger-strong',
};

const MARKER: Record<DiffLine['kind'], string> = { context: ' ', add: '+', remove: '-' };

/**
 * One file's changes, unified-diff style.
 *
 * Used wherever a human is asked to approve code they did not write: the
 * super-admin review queue (this version vs the last approved one) and the
 * upgrade dialog an admin sees. Whole files are not shown on purpose — a
 * reviewer given 800 unchanged lines reads none of them.
 */
export default function CodeDiff({
  before,
  after,
  filename,
  className,
}: {
  before: string;
  after: string;
  filename: string;
  className?: string;
}) {
  const diff = useMemo(() => diffLines(before, after), [before, after]);

  return (
    <div className={clsx('overflow-hidden rounded-lg border border-line-subtle bg-surface', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line-subtle bg-surface-subtle px-3 py-2">
        <span className="truncate font-mono text-xs font-semibold text-fg-secondary">{filename}</span>
        {diff.unchanged ? (
          <span className="shrink-0 text-xs text-fg-muted">no changes</span>
        ) : (
          <span className="shrink-0 font-mono text-xs">
            <span className="text-success">+{diff.added}</span>{' '}
            <span className="text-danger-strong">−{diff.removed}</span>
          </span>
        )}
      </div>

      {diff.truncated && (
        <p className="border-b border-line-subtle bg-warning-wash px-3 py-1.5 text-xs text-warning-strong">
          Too large to compare line by line — shown as a wholesale replacement.
        </p>
      )}

      {diff.unchanged ? (
        <p className="px-3 py-4 text-sm text-fg-muted">This file is identical in both versions.</p>
      ) : (
        <div className="overflow-x-auto">
          {diff.hunks.map((hunk) => (
            <div key={`${hunk.beforeStart}:${hunk.afterStart}`}>
              <div className="bg-surface-muted px-3 py-1 font-mono text-[11px] text-fg-muted">
                @@ -{hunk.beforeStart},{hunk.beforeCount} +{hunk.afterStart},{hunk.afterCount} @@
              </div>
              <table className="w-full border-collapse font-mono text-xs leading-5">
                <tbody>
                  {hunk.lines.map((line, index) => (
                    <tr key={`${line.before ?? 'x'}:${line.after ?? 'x'}:${index}`} className={LINE_CLASS[line.kind]}>
                      <td className="w-10 select-none px-2 text-right align-top text-fg-muted">
                        {line.before ?? ''}
                      </td>
                      <td className="w-10 select-none px-2 text-right align-top text-fg-muted">
                        {line.after ?? ''}
                      </td>
                      <td className="w-4 select-none pl-1 align-top">{MARKER[line.kind]}</td>
                      {/* `pre-wrap` rather than a horizontal scroll per row: a
                          reviewer must not be able to miss the tail of a long
                          line that happens to be the interesting one. */}
                      <td className="whitespace-pre-wrap break-all py-0 pr-3 align-top">{line.text || ' '}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
