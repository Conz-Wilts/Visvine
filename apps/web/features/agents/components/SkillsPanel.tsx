'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from '@/features/shared/components/SpaceLink';
import { Alert, Button, Skeleton } from '@/components/ui';
import { fetchJson } from '@/lib/fetchJson';

/**
 * What the agent has been taught, and what is waiting to be approved.
 *
 * Teaching is a demonstration: an admin takes control of the machine, does the
 * task once, gives control back, and presses Learn. The agent writes the skill
 * itself from what it saw — never from what was typed — and it lands pending,
 * because approving a skill is agreeing that its procedure is something this
 * space's agent may act on.
 */

interface Skill {
  slug: string;
  title: string;
  description: string;
  status: 'draft' | 'pending' | 'approved' | 'retired';
  path: string;
  taughtBy: string | null;
  keywords: string[];
  unmet: { hosts: string[]; actions: string[] };
}

const STATUS_LABEL: Record<Skill['status'], string> = {
  draft: 'Draft',
  pending: 'Waiting for you',
  approved: 'In use',
  retired: 'Retired',
};

export default function SkillsPanel({
  spaceId,
  agentName,
  isAdmin,
}: {
  spaceId: string;
  agentName: string;
  isAdmin: boolean;
}) {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const base = `/api/spaces/${spaceId}/agents/${encodeURIComponent(agentName)}/skills`;

  const reload = useCallback(async () => {
    try {
      const next = await fetchJson<{ skills: Skill[] }>(base);
      setSkills(next.skills);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the skills');
    }
  }, [base]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const learn = async () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await fetchJson<{ title: string }>(`/api/spaces/${spaceId}/vm/teach`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent: agentName }),
      });
      setNotice(`Wrote "${result.title}" from the last demonstration. Read it, then approve it.`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not learn from that demonstration');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (slug: string, status: Skill['status']) => {
    setBusy(true);
    try {
      await fetchJson(base, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, status }),
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change that skill');
    } finally {
      setBusy(false);
    }
  };

  if (!skills) return <Skeleton className="h-24 w-full rounded-lg" />;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-[13px] font-semibold text-text-primary">Skills</p>
        {isAdmin && (
          <Button variant="ghost" size="sm" onClick={learn} disabled={busy}>
            Learn from the last demonstration
          </Button>
        )}
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <p className="text-[13px] text-text-secondary">{notice}</p>}

      {skills.length === 0 ? (
        <p className="text-[13px] text-text-tertiary">
          Nothing taught yet. Take control of the machine, do a task once, give control back, then press Learn.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle">
          {skills.map((skill) => (
            <li key={skill.slug} className="flex flex-col gap-1 py-2.5">
              <div className="flex items-center gap-3">
                <Link
                  href={`/context/${encodeURIComponent(skill.path)}`}
                  className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary hover:underline"
                >
                  {skill.title}
                </Link>
                <span className="shrink-0 text-[12px] text-text-muted">{STATUS_LABEL[skill.status]}</span>
                {isAdmin && skill.status !== 'approved' && (
                  <Button variant="brand" size="sm" onClick={() => setStatus(skill.slug, 'approved')} disabled={busy}>
                    Approve
                  </Button>
                )}
                {isAdmin && skill.status === 'approved' && (
                  <Button variant="ghost" size="sm" onClick={() => setStatus(skill.slug, 'retired')} disabled={busy}>
                    Retire
                  </Button>
                )}
              </div>
              {skill.description && <p className="text-[13px] text-text-secondary">{skill.description}</p>}
              {(skill.unmet.hosts.length > 0 || skill.unmet.actions.length > 0) && (
                // What the skill expects but the space does not permit. It could
                // not take it anyway — every step goes through the same gates —
                // but approving one that needs it is agreeing to add it.
                <p className="text-[12px] text-amber-700">
                  Expects reach this space does not have:{' '}
                  {[...skill.unmet.hosts, ...skill.unmet.actions].join(', ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
