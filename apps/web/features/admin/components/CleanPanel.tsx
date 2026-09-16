'use client';

// Console → Clean: the space's nightly clean — whether it runs, when, what it
// may write, whom it acts as, and what every pass did. Reach is one status
// line; a frozen folder or a lapsed admin is the only reach worth a sentence.

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, SettingsSection, Skeleton } from '@/components/ui';
import Select from '@/components/ui/Select';
import Toggle from '@/components/ui/Toggle';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { timeAgo } from '@/lib/date';
import { useConsoleAutosave } from '@/features/admin/components/console/ConsoleSaveContext';
import {
  CLEAN_FIX_KINDS,
  type CleanEmbedStatus,
  type CleanScheduleSettings,
} from '@/lib/notes/shared/cleanSchedule';

interface RunRow {
  id: string;
  trigger: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  runAs: { userId: string; name: string } | null;
  mode: string;
  targetPath: string | null;
  analyzedNotes: number;
  inScopeNotes: number;
  safeFixes: number;
  applied: number;
  appliedByKind: Record<string, number>;
  skipped: Array<{ path: string; reason: string }>;
  worklist: Array<{ kind: string; count: number; items: Array<{ path: string; detail: string }> }>;
  truncated: boolean;
  embed: { status: CleanEmbedStatus; notes: number; chunks: number; sources: number; message: string | null };
  errorMessage: string | null;
}

interface Schedule extends CleanScheduleSettings {
  spaceId: string;
  runAs: { userId: string; name: string; email: string; isAdmin: boolean } | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  timezone: string | null;
  embedKeyed: boolean;
  denial: string | null;
}

interface Reach {
  totalNotes: number;
  visibleNotes: number;
  restrictedFolders: string[];
  lockedFolders: string[];
  subspaces: number;
  embeddedNotes: number;
  chunkedNotes: number;
}

interface Payload {
  schedule: Schedule;
  reach: Reach | null;
  runs: RunRow[];
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function hourLabel(h: number): string {
  const suffix = h < 12 ? 'am' : 'pm';
  return `${h % 12 === 0 ? 12 : h % 12}:30${suffix}`;
}

function statusTone(status: string): string {
  if (status === 'failed') return 'text-red-600';
  if (status === 'skipped') return 'text-text-muted';
  return 'text-text-primary';
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function embedLine(embed: RunRow['embed']): string | null {
  switch (embed.status) {
    case 'failed':
      return `Embedding failed: ${embed.message ?? 'unknown error'}`;
    case 'succeeded':
      return `Embedded ${plural(embed.notes, 'note')}, ${plural(embed.chunks, 'chunk')}`;
    default:
      return null;
  }
}

/** One pass: when, and what it did. Open for the detail. */
function RunLine({ run }: { run: RunRow }) {
  const [open, setOpen] = useState(false);
  const worklistTotal = run.worklist.reduce((sum, g) => sum + g.count, 0);
  const embed = run.status === 'succeeded' ? embedLine(run.embed) : null;
  return (
    <div className="py-3">
      <button
        type="button"
        className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 text-left text-[13px]"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-text-primary">{timeAgo(run.startedAt)}</span>
        <span className={statusTone(run.status)}>{run.status}</span>
        <span className="ml-auto tabular-nums text-text-muted">
          {run.applied} fixed
          {worklistTotal > 0 && ` · ${worklistTotal} to review`}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-1 text-xs text-text-muted">
          <p>
            {run.trigger === 'manual' ? 'Manual' : 'Scheduled'} · {run.runAs?.name ?? 'former admin'} · {run.mode}
            {run.targetPath ? ` · ${run.targetPath}/` : ''} · {run.inScopeNotes}/{run.analyzedNotes} notes
          </p>
          {run.errorMessage && <p className="text-red-600">{run.errorMessage}</p>}
          {Object.keys(run.appliedByKind).length > 0 && (
            <p>
              {Object.entries(run.appliedByKind)
                .map(([kind, n]) => `${CLEAN_FIX_KINDS.find((k) => k.kind === kind)?.label ?? kind} ${n}`)
                .join(' · ')}
            </p>
          )}
          {run.truncated && <p>Stopped at 1,500 notes</p>}
          {run.worklist.length > 0 && (
            <ul className="space-y-0.5">
              {run.worklist.flatMap((g) =>
                g.items.slice(0, 5).map((item) => (
                  <li key={`${g.kind}:${item.path}`} className="truncate">
                    <span className="text-text-primary">{item.path}</span> {item.detail}
                  </li>
                )),
              )}
            </ul>
          )}
          {run.skipped.length > 0 && (
            <p>
              Refused {run.skipped.length} · {run.skipped[0].path}: {run.skipped[0].reason}
            </p>
          )}
          {embed && <p>{embed}</p>}
        </div>
      )}
    </div>
  );
}

export default function CleanPanel({ spaceId }: { spaceId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const payload = await fetchJson<Payload>(`/api/spaces/${spaceId}/clean`);
    setData(payload);
  }, [spaceId]);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<Payload>(`/api/spaces/${spaceId}/clean`)
      .then((payload) => { if (!cancelled) setData(payload); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the clean.'); });
    return () => { cancelled = true; };
  }, [spaceId]);

  // The whole section saves as one settings record — the schedule is a single
  // decision, and half of it applied would run at a time nobody chose.
  const { queue, flush } = useConsoleAutosave(async (patch) => {
    const payload = await fetchJsonBody<Payload>(`/api/spaces/${spaceId}/clean`, 'PUT', patch);
    setData((prev) => (prev ? { ...prev, schedule: payload.schedule, reach: payload.reach } : prev));
  });

  const update = (patch: Partial<CleanScheduleSettings>, opts?: { debounceMs?: number }) => {
    setData((prev) => (prev ? { ...prev, schedule: { ...prev.schedule, ...patch } } : prev));
    queue(patch as Record<string, unknown>, opts);
  };

  const runNow = async () => {
    setRunning(true);
    setNotice(null);
    try {
      const res = await fetchJsonBody<{ outcome: { status: string; reason: string | null } }>(
        `/api/spaces/${spaceId}/clean`,
        'POST',
        {},
      );
      if (res.outcome.status !== 'succeeded') setNotice(res.outcome.reason ?? 'The clean did not run.');
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not run the clean.');
    } finally {
      setRunning(false);
    }
  };

  if (error) return <Alert variant="error">{error}</Alert>;
  if (!data) return <Skeleton className="h-40 w-full" />;

  const { schedule, reach, runs } = data;

  if (schedule.denial) {
    return <Alert variant="info">{schedule.denial}</Alert>;
  }

  const kinds = schedule.fixKinds.length ? schedule.fixKinds : CLEAN_FIX_KINDS.map((k) => k.kind);
  const status = [
    schedule.runAs && `Runs as ${schedule.runAs.name}`,
    reach && `sees ${reach.visibleNotes} of ${reach.totalNotes} notes`,
    schedule.enabled && schedule.nextRunAt && `next ${timeAgo(schedule.nextRunAt)}`,
    schedule.lastRunAt && `last ${timeAgo(schedule.lastRunAt)}`,
  ].filter(Boolean);

  return (
    <div className="space-y-8">
      <SettingsSection
        title="Nightly clean"
        action={
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={runNow} disabled={running}>
              {running ? 'Running…' : 'Run now'}
            </Button>
            <Toggle
              checked={schedule.enabled}
              onChange={(enabled) => update({ enabled })}
              aria-label="Nightly clean"
            />
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <Select
            className="w-32"
            value={String(schedule.hour)}
            onChange={(e) => update({ hour: Number(e.target.value) })}
            aria-label="Time"
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>{hourLabel(h)}</option>
            ))}
          </Select>
          <Select
            className="w-28"
            value={schedule.mode}
            onChange={(e) => update({ mode: e.target.value as 'light' | 'full' })}
            aria-label="Depth"
          >
            <option value="light">Light</option>
            <option value="full">Full</option>
          </Select>
          <Input
            className="w-48"
            placeholder="Whole space"
            value={schedule.targetPath ?? ''}
            onChange={(e) => update({ targetPath: e.target.value || null }, { debounceMs: 600 })}
            onBlur={flush}
            aria-label="Folder"
          />
          <span className="text-xs text-text-muted">{schedule.timezone || 'UTC'}</span>
        </div>
        {status.length > 0 && (
          <p className="mt-3 text-xs tabular-nums text-text-muted">{status.join(' · ')}</p>
        )}
        {schedule.runAs && !schedule.runAs.isAdmin && (
          <p className="mt-1 text-xs text-red-600">{schedule.runAs.name} is no longer an admin. Turn it on again to take over.</p>
        )}
        {reach && reach.lockedFolders.length > 0 && (
          <p className="mt-1 text-xs text-text-muted">Frozen: {reach.lockedFolders.join(', ')}</p>
        )}
        {notice && <p className="mt-2 text-xs text-red-600">{notice}</p>}
      </SettingsSection>

      <SettingsSection
        title="Fixes"
        action={
          <Toggle
            checked={schedule.applyFixes}
            onChange={(applyFixes) => update({ applyFixes })}
            aria-label="Apply fixes"
          />
        }
      >
        <div className="space-y-2">
          {CLEAN_FIX_KINDS.map((fix) => (
            <label key={fix.kind} className="flex items-center gap-3 text-[13px] text-text-primary">
              <input
                type="checkbox"
                className="accent-brand-green"
                disabled={!schedule.applyFixes}
                checked={kinds.includes(fix.kind)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...new Set([...kinds, fix.kind])]
                    : kinds.filter((k) => k !== fix.kind);
                  update({ fixKinds: next });
                }}
              />
              {fix.label}
            </label>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Semantic search"
        action={
          <Toggle
            checked={schedule.embedEnabled}
            onChange={(embedEnabled) => update({ embedEnabled })}
            aria-label="Semantic search"
          />
        }
      >
        <Toggle
          checked={schedule.embedAfterClean}
          disabled={!schedule.embedEnabled}
          onChange={(embedAfterClean) => update({ embedAfterClean })}
          label="Re-embed after each clean"
        />
        {!schedule.embedKeyed ? (
          <Alert variant="info" className="mt-3">No embedding key on this deployment.</Alert>
        ) : (
          reach && schedule.embedEnabled && (
            <p className="mt-3 text-xs tabular-nums text-text-muted">
              {reach.embeddedNotes} of {reach.totalNotes} notes embedded
            </p>
          )
        )}
      </SettingsSection>

      {runs.length > 0 && (
        <SettingsSection title="History">
          <div className="divide-y divide-border-subtle">{runs.map((run) => <RunLine key={run.id} run={run} />)}</div>
        </SettingsSection>
      )}
    </div>
  );
}
