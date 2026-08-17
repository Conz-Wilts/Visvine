'use client';

import Link from 'next/link';
import { clsx } from 'clsx';
import { Chip } from '@/components/ui';
import type { ToolDegraded } from '@/lib/tools/protocol';

/** How each missing dimension is named to a reader. */
const GROUPS: ReadonlyArray<readonly [key: keyof ToolDegraded['missing'], label: string]> = [
  ['connectors', 'Connectors'],
  ['types', 'Node types'],
  ['agents', 'Agents'],
];

/**
 * The banner over a Tool that installed but cannot run whole.
 *
 * Missing dependencies never block an install — the Tool runs with the
 * unsatisfied reads coming back empty — so the one thing that must not happen
 * is a Tool silently showing nothing and looking broken. This says which pieces
 * the space is missing, and points an admin at the install where they can fix
 * it. Members see the same explanation without the link, because installing is
 * not theirs to do.
 */
export default function DegradedBanner({
  degraded,
  isAdmin,
  className,
}: {
  degraded: ToolDegraded;
  isAdmin: boolean;
  className?: string;
}) {
  const groups = GROUPS.filter(([key]) => degraded.missing[key].length > 0);
  if (groups.length === 0) return null;

  return (
    <div
      className={clsx(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800',
        className,
      )}
    >
      <span className="font-medium">Running with limits — this space is missing:</span>
      {groups.map(([key, label]) => (
        <span key={key} className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs uppercase tracking-wide text-amber-700">{label}</span>
          {degraded.missing[key].map((name) => (
            <Chip key={name} tone="soft" size="sm" color="#b45309">
              {name}
            </Chip>
          ))}
        </span>
      ))}
      {isAdmin && (
        <Link href="/tools?tab=installed" className="ml-auto font-medium text-amber-900 underline">
          Manage install
        </Link>
      )}
    </div>
  );
}
