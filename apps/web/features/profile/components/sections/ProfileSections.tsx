'use client';

/**
 * The sections a member builds their own profile from: each one named by them,
 * holding what its kind says it holds. Nothing here is a fixed section — the
 * platform supplies the shapes, the person supplies the profile.
 *
 * A section with nothing in it is hidden from everyone but its owner, who needs
 * to see it to fill it.
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { evictRequestCache, swrFetch } from '@/features/shared/lib/requestCache';
import { GripVerticalIcon, PlusIcon } from '@/features/shared/icons';
import { SectionCard, AboutText } from '../profileCards';
import SectionRow from './SectionRows';
import { useReorder } from './useReorder';
import EditSectionModal from './edit/EditSectionModal';
import EditEntryModal from './edit/EditEntryModal';
import { MAX_SECTIONS, hasBody, kindOf } from '@/lib/profile/shared/sections';
import type { ProfileSectionEntryView, ProfileSectionView } from '@/lib/profile/sections';

interface Props {
  nodeId: string;
  isOwner: boolean;
  scrollMargin?: string;
  accent: string;
}

type EntryTarget = { section: ProfileSectionView; entry: ProfileSectionEntryView | null };

export default function ProfileSections({ nodeId, isOwner, scrollMargin, accent }: Props) {
  const [sections, setSections] = useState<ProfileSectionView[]>([]);
  const [editingSection, setEditingSection] = useState<ProfileSectionView | 'new' | null>(null);
  const [editingEntry, setEditingEntry] = useState<EntryTarget | null>(null);
  const url = `/api/profile/${encodeURIComponent(nodeId)}/sections`;

  useEffect(() => {
    let cancelled = false;
    setSections([]);
    swrFetch(url, () => fetchJson<{ sections?: ProfileSectionView[] }>(url), (data) => {
      if (!cancelled) setSections(data.sections ?? []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [url]);

  /** Every write answers with the whole list, so the page never guesses. */
  const write = useCallback(async (
    path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown,
  ) => {
    evictRequestCache(url);
    const data = method === 'DELETE' && body === undefined
      ? await fetchJson<{ sections: ProfileSectionView[] }>(path, { method })
      : await fetchJsonBody<{ sections: ProfileSectionView[] }>(path, method, body ?? {});
    setSections(data.sections);
  }, [url]);

  const saveSection = useCallback(async (patch: { id?: string; title: string; kind: string; body?: string | null }) => {
    await write(url, patch.id ? 'PATCH' : 'POST', patch);
  }, [url, write]);

  const deleteSection = useCallback(async (id: string) => {
    await write(`${url}?id=${encodeURIComponent(id)}`, 'DELETE');
  }, [url, write]);

  const entriesUrl = (sectionId: string) => `${url}/${encodeURIComponent(sectionId)}/entries`;

  const saveEntry = useCallback(async (sectionId: string, values: Record<string, unknown> & { id?: string }) => {
    await write(entriesUrl(sectionId), values.id ? 'PATCH' : 'POST', values);
  }, [write]); // eslint-disable-line react-hooks/exhaustive-deps

  const deleteEntry = useCallback(async (sectionId: string, id: string) => {
    await write(`${entriesUrl(sectionId)}?id=${encodeURIComponent(id)}`, 'DELETE');
  }, [write]); // eslint-disable-line react-hooks/exhaustive-deps

  const reorderSections = useCallback((order: string[]) => {
    void write(url, 'PATCH', { order });
  }, [url, write]);

  const sectionOrder = useReorder(sections.map((s) => s.id), reorderSections);
  const drawn = sectionOrder.order
    .map((id) => sections.find((s) => s.id === id))
    .filter((s): s is ProfileSectionView => !!s);
  const visible = isOwner ? drawn : drawn.filter((s) => (hasBody(s.kind) ? !!s.body : s.entries.length > 0));

  if (visible.length === 0 && !isOwner) return null;

  return (
    <>
      <div {...sectionOrder.listProps} className="flex flex-col gap-5">
        {visible.map((section) => (
          <div key={section.id} {...sectionOrder.rowProps(section.id)}
               className={sectionOrder.dragging === section.id ? 'opacity-70' : undefined}>
            <SectionCard
              id={`section-${section.id}`} title={section.title} size="lg" card
              scrollMargin={scrollMargin} isOwner={isOwner}
              onEdit={() => setEditingSection(section)}
              onAdd={hasBody(section.kind) ? undefined : () => setEditingEntry({ section, entry: null })}
              action={isOwner && visible.length > 1 ? (
                <button type="button" {...sectionOrder.gripProps(section.id)}
                        className="p-1.5 rounded-lg text-fg-muted hover:bg-surface-subtle hover:text-fg cursor-grab touch-none">
                  <GripVerticalIcon className="w-4 h-4" />
                </button>
              ) : undefined}
            >
              <SectionContents section={section} isOwner={isOwner} accent={accent}
                               onEditEntry={(entry) => setEditingEntry({ section, entry })}
                               onRemoveEntry={(entry) => void deleteEntry(section.id, entry.id)}
                               onReorder={(order) => void write(entriesUrl(section.id), 'PATCH', { order })} />
            </SectionCard>
          </div>
        ))}
      </div>

      {isOwner && sections.length < MAX_SECTIONS && (
        <button type="button" onClick={() => setEditingSection('new')}
                className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-line-subtle px-5 py-4 text-sm font-semibold text-fg-secondary hover:bg-surface-subtle hover:text-fg transition-colors">
          <PlusIcon className="w-4 h-4" /> Add section
        </button>
      )}

      {editingSection && (
        <EditSectionModal
          open section={editingSection === 'new' ? null : editingSection}
          onClose={() => setEditingSection(null)} onSave={saveSection}
          onDelete={editingSection === 'new' ? undefined : () => deleteSection(editingSection.id)}
        />
      )}
      {editingEntry && (
        <EditEntryModal
          open kind={editingEntry.section.kind} sectionTitle={editingEntry.section.title}
          entry={editingEntry.entry} onClose={() => setEditingEntry(null)}
          onSave={(values) => saveEntry(editingEntry.section.id, values)}
        />
      )}
    </>
  );
}

/** What one section shows: its prose, or its rows. */
function SectionContents({ section, isOwner, accent, onEditEntry, onRemoveEntry, onReorder }: {
  section: ProfileSectionView;
  isOwner: boolean;
  accent: string;
  onEditEntry: (entry: ProfileSectionEntryView | null) => void;
  onRemoveEntry: (entry: ProfileSectionEntryView) => void;
  onReorder: (order: string[]) => void;
}) {
  const rows = useReorder<HTMLUListElement>(section.entries.map((e) => e.id), onReorder);

  if (hasBody(section.kind)) {
    return section.body
      ? <AboutText text={section.body} accent={accent} />
      : <p className="text-base text-fg-muted">Nothing here yet.</p>;
  }

  if (section.entries.length === 0) {
    return <p className="text-base text-fg-muted">Nothing here yet.</p>;
  }

  const ordered = rows.order
    .map((id) => section.entries.find((e) => e.id === id))
    .filter((e): e is ProfileSectionEntryView => !!e);

  return (
    <ul {...rows.listProps} className="divide-y divide-line-subtle">
      {ordered.map((entry) => (
        <SectionRow key={entry.id} {...rows.rowProps(entry.id)} entry={entry} kind={kindOf(section.kind).kind}
                    isOwner={isOwner} dragging={rows.dragging === entry.id}
                    gripProps={rows.gripProps(entry.id)}
                    onEdit={() => onEditEntry(entry)} onRemove={() => onRemoveEntry(entry)} />
      ))}
    </ul>
  );
}
