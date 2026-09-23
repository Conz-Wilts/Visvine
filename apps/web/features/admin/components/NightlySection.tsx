'use client';

// Console → General → Nightly: when the space tidies itself, and whether it
// cleans, embeds, or both. Clean runs first and embed after; embed alone only
// embeds what is new or edited (lib/notes/cleanSchedule.ts). No options past
// the two switches — a clean always applies every safe fix to the whole space.

import { useEffect, useState } from 'react';
import { SettingsSection, Select, Toggle } from '@visvine/ui';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { useConsoleAutosave } from '@/features/admin/components/console/ConsoleSaveContext';
import type { CleanScheduleSettings } from '@/lib/notes/shared/cleanSchedule';

interface Schedule extends CleanScheduleSettings {
  runAs: { name: string; isAdmin: boolean } | null;
  timezone: string | null;
  embedKeyed: boolean;
  denial: string | null;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function hourLabel(h: number): string {
  return `${h % 12 === 0 ? 12 : h % 12}:30${h < 12 ? 'am' : 'pm'}`;
}

export default function NightlySection({ spaceId }: { spaceId: string }) {
  const [schedule, setSchedule] = useState<Schedule | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ schedule: Schedule }>(`/api/spaces/${spaceId}/clean`)
      .then((res) => { if (!cancelled) setSchedule(res.schedule); })
      .catch(() => { /* the section simply stays hidden */ });
    return () => { cancelled = true; };
  }, [spaceId]);

  const { queue } = useConsoleAutosave(async (patch) => {
    const res = await fetchJsonBody<{ schedule: Schedule }>(`/api/spaces/${spaceId}/clean`, 'PUT', patch);
    setSchedule(res.schedule);
  });

  const update = (patch: Partial<CleanScheduleSettings>) => {
    setSchedule((prev) => (prev ? { ...prev, ...patch } : prev));
    queue(patch as Record<string, unknown>);
  };

  // A sub-space or a personal space holds no schedule — nothing to show.
  if (!schedule || schedule.denial) return null;

  return (
    <SettingsSection flush large title="Nightly">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
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
          <span className="text-xs text-fg-muted">{schedule.timezone || 'UTC'}</span>
        </div>
        <div>
          <Toggle
            checked={schedule.enabled}
            onChange={(enabled) => update({ enabled })}
            label="Clean"
          />
          {schedule.enabled && schedule.runAs && !schedule.runAs.isAdmin && (
            <p className="mt-1 text-xs text-danger">
              {schedule.runAs.name} is no longer an admin. Turn it off and on again to run as yourself.
            </p>
          )}
        </div>
        <div>
          <Toggle
            checked={schedule.embedEnabled}
            onChange={(embedEnabled) => update({ embedEnabled })}
            label="Embed new or edited notes"
          />
          {schedule.embedEnabled && !schedule.embedKeyed && (
            <p className="mt-1 text-xs text-fg-muted">No embedding key on this deployment.</p>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
