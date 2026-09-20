'use client';

/**
 * Education — the schools a member lists, drawn the way a position is drawn:
 * the mark, the school, the degree, the years. The rows are database rows
 * (`profile_education`), so they sort and edit one at a time.
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { evictRequestCache, swrFetch } from '@/features/shared/lib/requestCache';
import { BookOpenIcon, PencilIcon, Trash2Icon } from '@/features/shared/icons';
import { SectionCard } from './profileCards';
import EditEducationModal from './edit/EditEducationModal';
import type { EducationEntry } from '@/app/api/profile/[personId]/education/route';

export type { EducationEntry };

interface Props {
  nodeId: string;
  isOwner: boolean;
  scrollMargin?: string;
  accent?: string;
}

export default function EducationSection({ nodeId, isOwner, scrollMargin, accent }: Props) {
  const [entries, setEntries] = useState<EducationEntry[]>([]);
  const [editing, setEditing] = useState<EducationEntry | 'new' | null>(null);
  const url = `/api/profile/${encodeURIComponent(nodeId)}/education`;

  useEffect(() => {
    let cancelled = false;
    setEntries([]);
    swrFetch(url, () => fetchJson<{ education?: EducationEntry[] }>(url), (data) => {
      if (!cancelled) setEntries(data.education ?? []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [url]);

  const save = useCallback(async (entry: Partial<EducationEntry>) => {
    evictRequestCache(url);
    const { education } = entry.id
      ? await fetchJsonBody<{ education: EducationEntry[] }>(url, 'PATCH', entry)
      : await fetchJsonBody<{ education: EducationEntry[] }>(url, 'POST', entry);
    setEntries(education);
  }, [url]);

  const remove = useCallback(async (id: string) => {
    evictRequestCache(url);
    const { education } = await fetchJson<{ education: EducationEntry[] }>(
      `${url}?id=${encodeURIComponent(id)}`, { method: 'DELETE' },
    );
    setEntries(education);
  }, [url]);

  // A section with nothing in it is hidden — unless it is yours to fill.
  if (entries.length === 0 && !isOwner) return null;

  return (
    <>
      <SectionCard id="education" title="Education" size="lg" card scrollMargin={scrollMargin}
                   isOwner={isOwner} onAdd={() => setEditing('new')}>
        {entries.length === 0 ? (
          <p className="text-base text-text-muted">No schools yet.</p>
        ) : (
          <ul>
            {entries.map((entry) => (
              <li key={entry.id} className="group flex gap-3 pb-5 last:pb-0">
                <span className="flex-none w-12 h-12 rounded-lg bg-surface-2 flex items-center justify-center text-text-muted">
                  {entry.imageUrl
                    ? <img src={entry.imageUrl} alt="" className="w-12 h-12 rounded-lg object-cover" />
                    : <BookOpenIcon className="w-5 h-5" />}
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="text-[15px] font-bold font-open-sauce text-text-primary">{entry.school}</div>
                  {(entry.degree || entry.field) && (
                    <div className="text-sm text-text-secondary">
                      {[entry.degree, entry.field].filter(Boolean).join(', ')}
                    </div>
                  )}
                  {(entry.startYear || entry.endYear) && (
                    <div className="text-sm text-text-muted">
                      {[entry.startYear, entry.endYear ?? 'Present'].filter(Boolean).join(' – ')}
                    </div>
                  )}
                  {entry.description && (
                    <p className="mt-2 text-sm text-text-secondary leading-relaxed max-w-[72ch]">{entry.description}</p>
                  )}
                </div>
                {isOwner && (
                  <div className="flex-none flex items-start gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button type="button" onClick={() => setEditing(entry)} aria-label={`Edit ${entry.school}`}
                            className="p-1.5 rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary">
                      <PencilIcon className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => void remove(entry.id)} aria-label={`Remove ${entry.school}`}
                            className="p-1.5 rounded-lg text-text-muted hover:bg-surface-2 hover:text-red-600">
                      <Trash2Icon className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {editing && (
        <EditEducationModal open entry={editing === 'new' ? null : editing} accent={accent}
                            onClose={() => setEditing(null)} onSave={save} />
      )}
    </>
  );
}
