'use client';

// Console → Clean: the space's nightly clean — whether it runs, when, what it
// is allowed to write, what it can actually reach, and what every pass did.
//
// The panel is deliberately blunt about REACH, because a clean is unattended
// and acts as a person: it runs as the admin who turned it on, sees only what
// they can read, writes only where they can write, never touches a folder
// frozen for AI, and never leaves this space — a public sub-space's context is
// read here but cleaned in the space that owns it. All four of those are stated
// on the page rather than left to be discovered from a run that did nothing.

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, SettingsSection, Skeleton } from '@/components/ui';
import Select from '@/components/ui/Select';
import Toggle from '@/components/ui/Toggle';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { timeAgo } from '@/lib/date';
import { useConsoleAutosave } from '@/features/admin/components/console/ConsoleSaveContext';
import {
  CLEAN_FIX_KINDS,
  describeCleanSchedule,
  embedAfterCleanStatus,
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

function embedLine(embed: RunRow['embed']): string {
  switch (embed.status) {
    case 'off':
      return 'Embedding is off for this space.';
    case 'no-key':
      return 'Not embedded — the deployment has no embedding key.';
    case 'skipped':
      return 'Not embedded — embed after clean is off.';
    case 'failed':
      return `Embedding failed: ${embed.message ?? 'unknown error'}`;
    default:
      return `Embedded ${embed.notes} note${embed.notes === 1 ? '' : 's'}, ${embed.chunks} chunk${embed.chunks === 1 ? '' : 's'}${
        embed.sources ? `, ${embed.sources} source chunk${embed.sources === 1 ? '' : 's'}` : ''
      }.${embed.message ? ` ${embed.message}` : ''}`;
  }
}

/** One pass, as a row: when, who it acted as, what it saw, what it wrote. */
function RunLine({ run }: { run: RunRow }) {
  const [open, setOpen] = useState(false);
  const worklistTotal = run.worklist.reduce((sum, g) => sum + g.count, 0);
  return (
    <div className="border-t border-border-subtle py-3 first:border-t-0">
      <button
        type="button"
        className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 text-left text-[13px]"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-text-primary">{timeAgo(run.startedAt)}</span>
        <span className="text-text-muted">{run.trigger === 'manual' ? 'run by hand' : 'scheduled'}</span>
        <span className={statusTone(run.status)}>{run.status}</span>
        <span className="ml-auto tabular-nums text-text-muted">
          {run.applied} applied · {run.inScopeNotes}/{run.analyzedNotes} notes in scope
          {worklistTotal > 0 && ` · ${worklistTotal} for a person`}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-2 pl-1 text-xs text-text-muted">
          <p>
            Ran as {run.runAs?.name ?? 'someone who has since left'} · mode {run.mode}
            {run.targetPath ? ` · ${run.targetPath}/` : ''} · {run.safeFixes} safe fixes found
          </p>
          {run.errorMessage && <p className="text-red-600">{run.errorMessage}</p>}
          {Object.keys(run.appliedByKind).length > 0 && (
            <p>
              Applied:{' '}
              {Object.entries(run.appliedByKind)
                .map(([kind, n]) => `${n} × ${CLEAN_FIX_KINDS.find((k) => k.kind === kind)?.label ?? kind}`)
                .join(', ')}
            </p>
          )}
          {run.truncated && (
            <p>Full mode looked at the first 1,500 notes by path; narrow the folder to reach the rest.</p>
          )}
          {run.worklist.length > 0 && (
            <div className="space-y-1">
              <p>Left for a person: {run.worklist.map((g) => `${g.count} ${g.kind}`).join(', ')}</p>
              <ul className="space-y-0.5 pl-3">
                {run.worklist.flatMap((g) =>
                  g.items.slice(0, 5).map((item) => (
                    <li key={`${g.kind}:${item.path}`} className="truncate">
                      <span className="text-text-primary">{item.path}</span> — {item.detail}
                    </li>
                  )),
                )}
              </ul>
            </div>
          )}
          {run.skipped.length > 0 && (
            <p>
              Refused at the gate: {run.skipped.length} —{' '}
              {run.skipped[0].path}: {run.skipped[0].reason}
            </p>
          )}
          {run.status === 'succeeded' && <p>{embedLine(run.embed)}</p>}
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
    const payload = await fetchJson<Payload>(`/api/communities/${spaceId}/clean`);
    setData(payload);
  }, [spaceId]);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<Payload>(`/api/communities/${spaceId}/clean`)
      .then((payload) => { if (!cancelled) setData(payload); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the clean.'); });
    return () => { cancelled = true; };
  }, [spaceId]);

  // The whole section saves as one settings record — the schedule is a single
  // decision, and half of it applied would run at a time nobody chose.
  const { queue, flush } = useConsoleAutosave(async (patch) => {
    const payload = await fetchJsonBody<Payload>(`/api/communities/${spaceId}/clean`, 'PUT', patch);
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
        `/api/communities/${spaceId}/clean`,
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

  return (
    <div className="space-y-8">
      <SettingsSection
        title="Nightly clean"
        description={`${describeCleanSchedule(schedule, schedule.timezone)} — the mechanical fixes applied, everything that needs judgment left as a worklist.`}
        action={
          <Button variant="ghost" size="sm" onClick={runNow} disabled={running}>
            {running ? 'Running…' : 'Run now'}
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-4">
          <Toggle
            checked={schedule.enabled}
            onChange={(enabled) => update({ enabled })}
            label={schedule.enabled ? 'On' : 'Off'}
          />
          <Select
            className="w-36"
            value={String(schedule.hour)}
            onChange={(e) => update({ hour: Number(e.target.value) })}
            aria-label="Hour the clean runs"
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>{hourLabel(h)}</option>
            ))}
          </Select>
          <Select
            className="w-44"
            value={schedule.mode}
            onChange={(e) => update({ mode: e.target.value as 'light' | 'full' })}
            aria-label="How deep the clean looks"
          >
            <option value="light">Light — the usual checks</option>
            <option value="full">Full — also duplicates and conflicts</option>
          </Select>
          <Input
            className="w-48"
            placeholder="whole space"
            value={schedule.targetPath ?? ''}
            onChange={(e) => update({ targetPath: e.target.value || null }, { debounceMs: 600 })}
            onBlur={flush}
            aria-label="Folder to clean"
          />
        </div>
        <p className="mt-3 text-xs text-text-muted">
          {schedule.enabled && schedule.nextRunAt
            ? `Next ${timeAgo(schedule.nextRunAt)}.`
            : 'Nothing is scheduled.'}
          {schedule.lastRunAt && ` Last ran ${timeAgo(schedule.lastRunAt)}.`}
        </p>
        {notice && <p className="mt-2 text-xs text-red-600">{notice}</p>}
      </SettingsSection>

      <SettingsSection
        title="What it may write"
        description="Only these mechanical fixes, and only on notes the person it runs as could edit by hand. Duplicates, contradictions and orphans are never applied — they come back as a worklist."
      >
        <div className="mb-4">
          <Toggle
            checked={schedule.applyFixes}
            onChange={(applyFixes) => update({ applyFixes })}
            label="Apply fixes (off = analyse and report only)"
          />
        </div>
        <div className="space-y-2">
          {CLEAN_FIX_KINDS.map((fix) => (
            <label key={fix.kind} className="flex items-start gap-3 text-[13px]">
              <input
                type="checkbox"
                className="mt-1 accent-brand-green"
                disabled={!schedule.applyFixes}
                checked={kinds.includes(fix.kind)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...new Set([...kinds, fix.kind])]
                    : kinds.filter((k) => k !== fix.kind);
                  update({ fixKinds: next });
                }}
              />
              <span>
                <span className="text-text-primary">{fix.label}</span>
                <span className="block text-xs text-text-muted">{fix.detail}</span>
              </span>
            </label>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Embedding"
        description="Whether this space's notes get vectors for semantic search — each note whole, and each section of it as a chunk — and whether a clean re-embeds what it changed in the same pass. Off stops the nightly sweep and search's semantic half alike."
      >
        <div className="space-y-3">
          <Toggle
            checked={schedule.embedEnabled}
            onChange={(embedEnabled) => update({ embedEnabled })}
            label={schedule.embedEnabled ? 'Embedding on' : 'Embedding off — search is keyword and links only'}
          />
          <Toggle
            checked={schedule.embedAfterClean}
            onChange={(embedAfterClean) => update({ embedAfterClean })}
            label="Embed after each clean"
          />
          <p className="text-xs text-text-muted">
            {!schedule.embedKeyed
              ? 'The deployment has no embedding key, so nothing is embedded whatever these say.'
              : embedAfterCleanStatus(schedule, true).embed
                ? 'A pass re-embeds the notes it changed and anything else that is stale, up to 400 notes; the rest waits for the nightly sweep.'
                : 'A pass leaves embedding to the nightly sweep.'}
            {reach && schedule.embedEnabled && schedule.embedKeyed && (
              <span className="tabular-nums">
                {' '}
                Now: {reach.embeddedNotes} of {reach.totalNotes} notes embedded whole, {reach.chunkedNotes} chunked.
              </span>
            )}
          </p>
        </div>
      </SettingsSection>

      <SettingsSection
        title="What it can reach"
        description="A clean has no standing of its own. It acts as one admin, through the same permission model as a person clicking through the app."
      >
        <div className="space-y-2 text-[13px] text-text-muted">
          <p>
            Runs as{' '}
            <span className="text-text-primary">{schedule.runAs?.name ?? 'nobody yet — turn it on to run as yourself'}</span>
            {schedule.runAs && !schedule.runAs.isAdmin && (
              <span className="text-red-600"> — no longer an admin, so nothing will run. Turn it on again to take it over.</span>
            )}
          </p>
          {reach && (
            <>
              <p className="tabular-nums">
                Sees <span className="text-text-primary">{reach.visibleNotes}</span> of {reach.totalNotes} notes
                {reach.visibleNotes < reach.totalNotes && ' — the rest sit behind restricted folders they hold no grant for.'}
              </p>
              <p>
                {reach.lockedFolders.length
                  ? `Never writes ${reach.lockedFolders.length} folder${reach.lockedFolders.length === 1 ? '' : 's'} frozen for AI: ${reach.lockedFolders.join(', ')}.`
                  : 'No folder is frozen for AI.'}
              </p>
              <p>
                {reach.restrictedFolders.length
                  ? `Restricted folders in this space: ${reach.restrictedFolders.join(', ')}.`
                  : 'No folder is restricted.'}
              </p>
              <p>
                {reach.subspaces > 0
                  ? `The ${reach.subspaces} public sub-space${reach.subspaces === 1 ? '' : 's'} read into spaces/ are never cleaned from here — each is cleaned in the space that owns its notes.`
                  : 'Cleaning stays in this space. A sub-space is cleaned in the space that owns its notes.'}
              </p>
            </>
          )}
        </div>
      </SettingsSection>

      <SettingsSection title="History" description="Every pass, scheduled or by hand. Open one for what it wrote and what it left.">
        {runs.length === 0 ? (
          <p className="text-[13px] text-text-muted">Nothing has run yet.</p>
        ) : (
          <div>{runs.map((run) => <RunLine key={run.id} run={run} />)}</div>
        )}
      </SettingsSection>
    </div>
  );
}
