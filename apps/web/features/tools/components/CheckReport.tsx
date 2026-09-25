'use client';

import { clsx } from 'clsx';
import type { CheckFinding, CheckReport as Report, StageResult, StageStatus } from '@/lib/tools/checks/findings';

const STATUS_WORD: Record<StageStatus, string> = { passed: 'Passed', flagged: 'Flagged', blocked: 'Blocked' };

const STATUS_CLASS: Record<StageStatus, string> = {
  passed: 'text-fg-muted',
  flagged: 'text-warning-strong',
  blocked: 'text-danger-strong',
};

const DOT_CLASS: Record<CheckFinding['severity'], string> = {
  high: 'bg-danger',
  medium: 'bg-warning-bright',
  low: 'bg-fg-muted',
  info: 'bg-line',
};

const STAGE_LABEL: Record<StageResult['stage'], string> = { compatibility: 'Compatibility', security: 'Security' };

/** `2 flags · risk 45`, or nothing to add. */
function stageFacts(stage: StageResult): string {
  const counted = stage.findings.filter((f) => f.severity !== 'info').length;
  const parts = [STATUS_WORD[stage.status]];
  if (counted > 0) parts.push(`${counted} ${counted === 1 ? 'finding' : 'findings'}`);
  if (stage.risk && stage.risk.level !== 'low') parts.push(`risk ${stage.risk.score}`);
  return parts.join(' · ');
}

/**
 * A Tool's check report, as the author, the space's admins and a Visvine
 * reviewer all read it: one row per stage, then what each found, worst first,
 * each naming its file and line.
 */
export default function CheckReport({ report, className }: { report: Report; className?: string }) {
  const findings = [...report.compatibility.findings, ...report.security.findings].filter((f) => f.severity !== 'info');
  return (
    <div className={clsx('flex flex-col gap-2 text-sm', className)}>
      {[report.compatibility, report.security].map((stage) => (
        <div key={stage.stage} className="flex items-baseline justify-between gap-4">
          <span className="text-fg">{STAGE_LABEL[stage.stage]}</span>
          <span className={STATUS_CLASS[stage.status]}>{stageFacts(stage)}</span>
        </div>
      ))}
      {findings.length > 0 && (
        <ul className="mt-1 flex flex-col gap-1.5 border-t border-line-subtle pt-3">
          {findings.map((f, i) => (
            <li key={`${f.rule}-${i}`} className="flex items-start gap-2">
              <span aria-hidden className={clsx('mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full', DOT_CLASS[f.severity])} />
              <span className="min-w-0 text-fg-secondary">
                {f.file && (
                  <span className="font-mono text-xs text-fg-muted">
                    {f.file}
                    {f.line ? `:${f.line}` : ''}{' '}
                  </span>
                )}
                {f.message}
              </span>
            </li>
          ))}
        </ul>
      )}
      {report.security.risk && report.security.risk.factors.length > 0 && report.security.risk.level !== 'low' && (
        <p className="text-xs text-fg-muted">{report.security.risk.factors.join(' · ')}</p>
      )}
    </div>
  );
}

/** The one word a list row shows for a report. */
export function checkWord(report: Report | null | undefined): string | null {
  if (!report) return null;
  const worst: StageStatus =
    report.compatibility.status === 'blocked' || report.security.status === 'blocked'
      ? 'blocked'
      : report.compatibility.status === 'flagged' || report.security.status === 'flagged'
        ? 'flagged'
        : 'passed';
  return worst === 'passed' ? null : STATUS_WORD[worst];
}
