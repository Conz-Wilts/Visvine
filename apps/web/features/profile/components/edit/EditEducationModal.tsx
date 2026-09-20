'use client';

import React, { useEffect, useState } from 'react';
import EditModal from './EditModal';
import ModalFooter from './ModalFooter';
import type { EducationEntry } from '@/app/api/profile/[personId]/education/route';

interface Props {
  open: boolean;
  /** Null adds a school; an entry edits that one. */
  entry: EducationEntry | null;
  onClose: () => void;
  onSave: (entry: Partial<EducationEntry>) => Promise<void>;
  accent?: string;
}

const FIELD = 'w-full px-3 py-2 border border-border-subtle rounded-xl text-sm bg-surface-1 text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30';

export default function EditEducationModal({ open, entry, onClose, onSave }: Props) {
  const [form, setForm] = useState({ school: '', degree: '', field: '', startYear: '', endYear: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm({
      school: entry?.school ?? '',
      degree: entry?.degree ?? '',
      field: entry?.field ?? '',
      startYear: entry?.startYear ?? '',
      endYear: entry?.endYear ?? '',
      description: entry?.description ?? '',
    });
  }, [open, entry]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trim = (v: string) => v.trim() || null;
    if (!form.school.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        ...(entry ? { id: entry.id } : {}),
        school: form.school.trim(),
        degree: trim(form.degree),
        field: trim(form.field),
        startYear: trim(form.startYear),
        endYear: trim(form.endYear),
        description: trim(form.description),
      });
      onClose();
    } catch {
      setError('Couldn’t save. Check the years are four digits.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditModal title={entry ? 'Edit school' : 'Add school'} open={open} onClose={onClose} size="sm">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-brand-grey mb-1">School</label>
          <input value={form.school} onChange={set('school')} required maxLength={200}
                 placeholder="The University of Auckland" className={FIELD} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-brand-grey mb-1">Degree</label>
            <input value={form.degree} onChange={set('degree')} maxLength={200}
                   placeholder="BSc" className={FIELD} />
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-grey mb-1">Field</label>
            <input value={form.field} onChange={set('field')} maxLength={200}
                   placeholder="Computer Science" className={FIELD} />
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-grey mb-1">From</label>
            <input value={form.startYear} onChange={set('startYear')} inputMode="numeric"
                   pattern="\d{4}" placeholder="2021" className={FIELD} />
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-grey mb-1">To</label>
            <input value={form.endYear} onChange={set('endYear')} inputMode="numeric"
                   pattern="\d{4}" placeholder="2024" className={FIELD} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-brand-grey mb-1">Notes</label>
          <textarea value={form.description} onChange={set('description')} rows={3} maxLength={2000}
                    className={`${FIELD} resize-y`} />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <ModalFooter onCancel={onClose} saving={saving} />
      </form>
    </EditModal>
  );
}
