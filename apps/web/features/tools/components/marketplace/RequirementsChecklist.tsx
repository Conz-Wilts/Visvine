'use client';

/**
 * What a Tool declared, against what this space actually has — the checklist an
 * admin reads before pressing Install, and the detail behind a degraded banner
 * afterwards.
 *
 * One line per declared connector, node type and agent, with a tick or a cross.
 * Deliberately per ITEM rather than per dimension: "No connector here matches
 * hubspot" is a sentence somebody can go and fix, where "connectors: 1 missing"
 * is not.
 *
 * The crosses never block anything. A missing dependency means the Tool installs
 * and runs DEGRADED behind a banner with those reads coming back empty, which is
 * the brief's rule and the reason this is a checklist and not a gate — so the
 * copy says exactly that rather than implying a failure.
 *
 * Note globs (`read`/`write`) are not on this list on purpose, and the server
 * agrees: a read glob is a shape, not a dependency, and `deals/**` matching
 * nothing today is an empty folder rather than a missing feature. The full reach
 * is shown by `PerimeterSummary` next to this.
 */

import type { ReactNode } from 'react';
import { CheckIcon, MinusIcon, XIcon } from '@/features/shared/icons';
import { clsx } from 'clsx';
import type { ToolPerimeter } from '@/lib/tools/perimeter';
import type { ToolRequirements } from '@/lib/tools/requirements';

/** The three dimensions a space can fail to satisfy, in the order to fix them. */
const DIMENSIONS: ReadonlyArray<readonly [key: keyof ToolRequirements, noun: string]> = [
  ['connectors', 'connector'],
  ['types', 'node type'],
  ['agents', 'agent'],
];

/** "Whatever this space has" — satisfied by a space with none, so never a cross. */
const ANY = '*';

type Verdict = 'met' | 'missing' | 'unchecked';

interface ChecklistLine {
  dimension: keyof ToolRequirements;
  noun: string;
  entry: string;
  verdict: Verdict;
}

/**
 * The declared entries, each with its verdict.
 *
 * `unchecked` names dimensions the caller could not resolve — the agents roster
 * is behind its own feature key, and a space that switched Agents off must read
 * as "checked on install" rather than as a missing dependency invented by the UI.
 */
function checklistLines(
  perimeter: ToolPerimeter,
  requirements: ToolRequirements,
  unchecked: ReadonlyArray<keyof ToolRequirements> = [],
): ChecklistLine[] {
  return DIMENSIONS.flatMap(([key, noun]) =>
    perimeter[key].map((entry): ChecklistLine => {
      const verdict: Verdict =
        entry === ANY
          ? 'met'
          : unchecked.includes(key)
            ? 'unchecked'
            : requirements[key].includes(entry)
              ? 'missing'
              : 'met';
      return { dimension: key, noun, entry, verdict };
    }),
  );
}

const ICONS: Record<Verdict, ReactNode> = {
  met: <CheckIcon className="h-3.5 w-3.5 text-green-600" aria-hidden />,
  missing: <XIcon className="h-3.5 w-3.5 text-amber-600" aria-hidden />,
  unchecked: <MinusIcon className="h-3.5 w-3.5 text-text-muted" aria-hidden />,
};

const VERDICT_LABEL: Record<Verdict, string> = {
  met: 'available',
  missing: 'missing',
  unchecked: 'not checked',
};

export default function RequirementsChecklist({
  perimeter,
  requirements,
  unchecked = [],
  className,
}: {
  perimeter: ToolPerimeter;
  requirements: ToolRequirements;
  unchecked?: ReadonlyArray<keyof ToolRequirements>;
  className?: string;
}) {
  const lines = checklistLines(perimeter, requirements, unchecked);
  if (lines.length === 0) {
    return (
      <p className={clsx('text-sm text-text-muted', className)}>
        This tool asks for no connectors, node types or agents — nothing here can be missing.
      </p>
    );
  }

  const missing = lines.filter((line) => line.verdict === 'missing');

  return (
    <div className={clsx('space-y-2', className)}>
      <ul className="space-y-1.5">
        {lines.map((line) => (
          <li key={`${line.dimension}:${line.entry}`} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 shrink-0">{ICONS[line.verdict]}</span>
            <span className="min-w-0 text-text-secondary">
              <span className="font-mono text-[13px] text-text-primary">{line.entry}</span>{' '}
              <span className="text-text-muted">
                — {line.noun}
                {line.verdict === 'met'
                  ? ' available here'
                  : line.verdict === 'missing'
                    ? ' not found in this space'
                    : ' not checked from here'}
              </span>
              <span className="sr-only"> ({VERDICT_LABEL[line.verdict]})</span>
            </span>
          </li>
        ))}
      </ul>

      {missing.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {missing.length === 1 ? 'One thing is' : `${missing.length} things are`} missing. The tool will still
          install and run — <span className="font-medium">degraded</span>, behind a banner, with the
          unsatisfied reads coming back empty. Add what it needs and press Re-check on the Installed tab.
        </p>
      )}
    </div>
  );
}
