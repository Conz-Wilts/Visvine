'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Space } from '@/lib/types';
import { Field, inputBaseClass } from '@/components/ui';
import { useConsoleAutosave } from '@/features/admin/components/console/ConsoleSaveContext';
import { fetchJsonBody } from '@/lib/fetchJson';

interface Props {
  space: Space;
  onSaved: (updated: Partial<Space>) => void;
}

function supportedTimeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
}

/**
 * The Agents tab of the Space Console: the space-wide defaults an agent brief
 * must not carry. The brief is member-writable, so anything that changes what
 * every agent does — or where the space's context is sent — is set here by an
 * admin instead. Today that is the timezone. Models and their keys are not
 * here on purpose: a model is a connector (`/connectors`), where every
 * endpoint the space reaches out to, and every key it uses, has one home.
 * Activation ("approval") is per agent, on `/agents`.
 */
export default function AgentSettingsPanel({ space, onSaved }: Props) {
  const [timezone, setTimezone] = useState(space.timezone ?? '');
  const timeZones = supportedTimeZones();

  const { queue } = useConsoleAutosave(async (patch) => {
    const data = await fetchJsonBody<{ space: Partial<Space> }>(`/api/communities/${space.id}/settings`, 'PUT', patch);
    onSaved(data.space);
  });

  return (
    <div className="w-full space-y-8">
      <section>
        <h3 className="mb-1 text-base font-semibold text-text-primary">Schedule</h3>
        <p className="mb-4 text-sm text-text-muted">
          Defaults for every scheduled agent in this space. An agent that names its own timezone keeps it.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Timezone" hint="What an agent's “daily at 07:00” means, unless the agent names its own.">
            <select
              className={inputBaseClass}
              value={timezone}
              onChange={e => {
                setTimezone(e.target.value);
                queue({ timezone: e.target.value || null });
              }}
            >
              <option value="">UTC (default)</option>
              {timeZones.map(z => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-base font-semibold text-text-primary">Models and approval</h3>
        <p className="text-sm text-text-muted">
          Models live in <Link href="/connectors" className="underline">Connectors</Link>: add a{' '}
          <span className="font-mono text-[12px]">Model provider</span> connector per provider (or one with a custom
          endpoint) and set its key there. An agent runs nothing until an admin activates it on{' '}
          <Link href="/agents" className="underline">Agents</Link> — activation is the approval, brief by brief.
        </p>
      </section>
    </div>
  );
}
