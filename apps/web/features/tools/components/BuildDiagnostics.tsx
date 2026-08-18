'use client';

/**
 * A Tool build's diagnostics, as an author reads them — on their Tool page and
 * on their preview page, which is why this is shared rather than written twice.
 *
 * Nothing here decides anything: `lib/tools/builds.ts#rebuildTool` already
 * produced these on the write that caused them, and this only renders what it
 * stored.
 */

import type { BuildDiagnostic, BuildSummary } from '@/lib/tools/builds';

/**
 * One diagnostic as an editor would address it — `ui.tsx:12:5 message`, or the
 * bare filename when the compiler had no location to give (a size cap, a
 * missing default export).
 *
 * Restated here rather than imported from lib/tools/builds.ts#toolDiagnosticLine:
 * that module reaches esbuild, so importing it for real would drag a bundler
 * into the browser. The two must stay identical — an author reading a line here
 * and an authoring agent reading the same line back from `write_tool` are
 * looking at the same defect, and a line that formatted differently in the two
 * places would read as two.
 */
export function toolDiagnosticLine(d: BuildDiagnostic): string {
  const at = d.line === null ? '' : `:${d.line}:${d.column ?? 0}`;
  return `${d.file}${at} ${d.message}`;
}

/**
 * The config error, the compile errors and the warnings, in the order they stop
 * a Tool from running. Null when the build is clean, so a caller can render it
 * unconditionally beside whatever it says about a build that works.
 */
export default function BuildDiagnostics({ build }: { build: BuildSummary | null }) {
  if (!build) return null;
  const { configError, errors, warnings } = build;
  if (!configError && errors.length === 0 && warnings.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {configError && (
        <p className="min-w-0 break-words rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <span className="font-mono">index.md</span> {configError}
        </p>
      )}
      {errors.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          {errors.map((d, i) => (
            <li key={i} className="min-w-0 break-words font-mono text-[12px] leading-relaxed text-red-700">
              {toolDiagnosticLine(d)}
            </li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          {warnings.map((d, i) => (
            <li key={i} className="min-w-0 break-words font-mono text-[12px] leading-relaxed text-amber-800">
              {toolDiagnosticLine(d)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
