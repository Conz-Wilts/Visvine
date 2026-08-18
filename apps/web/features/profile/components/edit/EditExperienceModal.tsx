'use client';

import React, { useState, useEffect } from 'react';
import { BriefcaseIcon, PencilIcon, PlusIcon, Trash2Icon } from '@/features/shared/icons';
import EditModal from './EditModal';
import ModalFooter from './ModalFooter';
import {
  type FullProfile, type ExperienceEntry,
  getExperience, sortExperience, formatYearMonth,
} from '@/lib/types/profile';

interface Props {
  open: boolean;
  onClose: () => void;
  profile: FullProfile;
  onSave: (patch: Partial<FullProfile>) => Promise<void>;
}

type Draft = {
  id: string;
  title: string;
  org: string;
  start: string; // YYYY-MM from <input type="month">
  end: string;
  current: boolean;
  location: string;
  description: string;
};

const emptyDraft = (): Draft => ({
  id: `exp_${Math.random().toString(36).slice(2, 10)}`,
  title: '', org: '', start: '', end: '', current: false, location: '', description: '',
});

const toDraft = (e: ExperienceEntry): Draft => ({
  id: e.id,
  title: e.title,
  org: e.org,
  start: e.start,
  end: e.end ?? '',
  current: !!e.current || !e.end,
  location: e.location ?? '',
  description: e.description ?? '',
});

const toEntry = (d: Draft): ExperienceEntry => ({
  id: d.id,
  title: d.title.trim(),
  org: d.org.trim(),
  start: d.start,
  end: d.current ? null : d.end || null,
  current: d.current,
  location: d.location.trim() || null,
  description: d.description.trim() || null,
});

export default function EditExperienceModal({ open, onClose, profile, onSave }: Props) {
  const [entries, setEntries] = useState<ExperienceEntry[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const existing = sortExperience(getExperience(profile));
      setEntries(existing);
      setDraft(existing.length === 0 ? emptyDraft() : null);
    }
  }, [open, profile]);

  const commitDraft = (): ExperienceEntry[] | null => {
    if (!draft) return entries;
    if (!draft.title.trim() || !draft.org.trim() || !draft.start) {
      // An untouched blank form just means "nothing to add".
      if (!draft.title.trim() && !draft.org.trim() && !draft.start) return entries;
      return null;
    }
    const entry = toEntry(draft);
    const rest = entries.filter((e) => e.id !== entry.id);
    return sortExperience([...rest, entry]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = commitDraft();
    if (!next) return; // partially-filled draft — let native validation show
    setSaving(true);
    try {
      // Merge over existing metadata so themeColor & co. survive the write.
      await onSave({ metadata: { ...(profile.metadata ?? {}), experience: next } });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const removeEntry = (id: string) => setEntries((prev) => prev.filter((e) => e.id !== id));
  const editEntry = (entry: ExperienceEntry) => setDraft(toDraft(entry));

  const draftValid = !!draft && !!draft.title.trim() && !!draft.org.trim() && !!draft.start;

  return (
    <EditModal title="Edit experience" open={open} onClose={onClose} size="lg">
      <form onSubmit={handleSubmit} className="p-6 space-y-5">
        {/* Existing entries */}
        {entries.length > 0 && (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div key={entry.id}
                   className={`flex items-start gap-3 p-3 border rounded-xl ${draft?.id === entry.id ? 'border-brand-dark-green/40 bg-brand-light-bg/40' : 'border-gray-200'}`}>
                <span className="w-9 h-9 flex-none rounded-lg bg-gray-100 text-brand-grey flex items-center justify-center">
                  <BriefcaseIcon className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-brand-black truncate">{entry.title}</p>
                  <p className="text-xs text-brand-grey truncate">
                    {entry.org} · {formatYearMonth(entry.start)} – {entry.end ? formatYearMonth(entry.end) : 'Present'}
                  </p>
                </div>
                <div className="flex gap-1 flex-none">
                  <button type="button" onClick={() => editEntry(entry)} aria-label={`Edit ${entry.title}`}
                          className="p-1.5 rounded-lg text-brand-grey hover:bg-gray-100 transition-colors">
                    <PencilIcon className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => removeEntry(entry.id)} aria-label={`Remove ${entry.title}`}
                          className="p-1.5 rounded-lg text-brand-grey hover:text-red-500 hover:bg-red-50 transition-colors">
                    <Trash2Icon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add / edit form */}
        {draft ? (
          <div className="space-y-3 p-4 border border-dashed border-gray-300 rounded-xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-brand-grey mb-1">Role / Title *</label>
                <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                       placeholder="e.g. Product Designer" required={!!(draft.org.trim() || draft.start)}
                       className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-brand-grey mb-1">Company / Organisation *</label>
                <input value={draft.org} onChange={(e) => setDraft({ ...draft, org: e.target.value })}
                       placeholder="e.g. Acme Corp" required={!!(draft.title.trim() || draft.start)}
                       className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-brand-grey mb-1">Start *</label>
                <input type="month" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })}
                       required={!!(draft.title.trim() || draft.org.trim())}
                       className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-brand-grey mb-1">End</label>
                <input type="month" value={draft.end} disabled={draft.current} min={draft.start || undefined}
                       onChange={(e) => setDraft({ ...draft, end: e.target.value })}
                       className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30 disabled:bg-gray-50 disabled:text-brand-grey" />
                <label className="flex items-center gap-2 mt-1.5 text-xs text-brand-grey cursor-pointer select-none">
                  <input type="checkbox" checked={draft.current}
                         onChange={(e) => setDraft({ ...draft, current: e.target.checked, end: e.target.checked ? '' : draft.end })}
                         className="rounded border-gray-300" />
                  I currently work here
                </label>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-grey mb-1">Location</label>
              <input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                     placeholder="e.g. Auckland, New Zealand"
                     className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-grey mb-1">Description</label>
              <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                        rows={2} maxLength={600} placeholder="What did you build or own in this role?"
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30" />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDraft(null)}
                      className="px-3 py-1.5 text-xs font-medium text-brand-grey rounded-lg hover:bg-gray-100 transition-colors">
                Discard
              </button>
              <button type="button" disabled={!draftValid}
                      onClick={() => { const next = commitDraft(); if (next) { setEntries(next); setDraft(null); } }}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-brand-black rounded-lg hover:opacity-80 transition-opacity disabled:opacity-40">
                {entries.some((e) => e.id === draft.id) ? 'Update role' : 'Add role'}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setDraft(emptyDraft())}
                  className="w-full py-3 border-[1.5px] border-dashed border-gray-300 rounded-xl text-sm text-brand-grey hover:text-brand-black hover:border-gray-400 flex items-center justify-center gap-1.5 transition-colors">
            <PlusIcon className="w-4 h-4" /> Add a role
          </button>
        )}

        <ModalFooter onCancel={onClose} saving={saving} />
      </form>
    </EditModal>
  );
}
