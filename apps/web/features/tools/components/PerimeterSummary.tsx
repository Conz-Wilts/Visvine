'use client';

import { clsx } from 'clsx';
import { Chip } from '@visvine/ui';
import type { PerimeterDiff, ToolPerimeter } from '@/lib/tools/perimeter';
import { color } from '@visvine/tokens';

/** Added and removed paint semantically, not in the space's accent. */
const ADDED_COLOR = color.success.default;
const REMOVED_COLOR = color.danger.default;

/**
 * The five dimensions in the order a reviewer should read them: what it can
 * see, then what it can change, then what else it can reach.
 */
const GROUPS: ReadonlyArray<readonly [key: keyof ToolPerimeter, label: string]> = [
  ['read', 'Reads'],
  ['write', 'Writes'],
  ['types', 'Node types'],
  ['connectors', 'Connectors'],
  ['agents', 'Agents'],
];

/** Reads and writes are always stated — "writes nothing" is the reassuring line. */
const ALWAYS_SHOWN: ReadonlyArray<keyof ToolPerimeter> = ['read', 'write'];

type EntryState = 'same' | 'added' | 'removed';

/**
 * A Tool's declared reach, as chips.
 *
 * This is the screen an admin decides on: it is shown before an install, before
 * an upgrade, and in the super-admin review queue, and it is the only place the
 * perimeter is ever read by a human. Pass `diff` and it becomes the upgrade
 * question instead — green for reach the new version is asking for, red struck
 * through for reach it is giving up — so "what is this version asking for that
 * the last one didn't" is a glance rather than a comparison.
 */
export default function PerimeterSummary({
  perimeter,
  diff,
  extra = [],
  className,
}: {
  perimeter: ToolPerimeter;
  /** Change against the previously approved version, when there is one. */
  diff?: PerimeterDiff;
  /** A manifest 2 Tool's other families of reach — records, resources, actions, AI — shown when present. */
  extra?: ReadonlyArray<{ key: string; label: string; entries: readonly string[] }>;
  className?: string;
}) {
  const rows = GROUPS.map(([key, label]) => {
    const added = new Set(diff ? diff[key].added : []);
    const entries: Array<{ value: string; state: EntryState }> = [
      ...perimeter[key].map((value) => ({
        value,
        state: (added.has(value) ? 'added' : 'same') as EntryState,
      })),
      // Removed entries are gone from `perimeter` by definition, so they are
      // appended from the diff rather than found in it.
      ...(diff ? diff[key].removed.map((value) => ({ value, state: 'removed' as EntryState })) : []),
    ];
    return { key: key as string, label, entries };
  })
    .filter((row) => row.entries.length > 0 || ALWAYS_SHOWN.includes(row.key as keyof ToolPerimeter))
    .concat(
      extra
        .filter((row) => row.entries.length > 0)
        .map((row) => ({ ...row, entries: row.entries.map((value) => ({ value, state: 'same' as EntryState })) })),
    );

  return (
    <dl className={clsx('space-y-2', className)}>
      {rows.map((row) => (
        <div key={row.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <dt className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {row.label}
          </dt>
          <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {row.entries.length === 0 ? (
              <span className="text-sm text-fg-muted">nothing</span>
            ) : (
              row.entries.map((entry) => (
                <Chip
                  key={`${entry.state}:${entry.value}`}
                  tone={entry.state === 'same' ? 'muted' : 'solid'}
                  size="sm"
                  color={
                    entry.state === 'added'
                      ? ADDED_COLOR
                      : entry.state === 'removed'
                        ? REMOVED_COLOR
                        : undefined
                  }
                  className={clsx('font-mono', entry.state === 'removed' && 'line-through')}
                  title={
                    entry.state === 'added'
                      ? 'New in this version'
                      : entry.state === 'removed'
                        ? 'Dropped in this version'
                        : undefined
                  }
                >
                  {entry.value}
                </Chip>
              ))
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
