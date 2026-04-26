'use client';

import React, { useState, useEffect } from 'react';
import EditModal from './EditModal';
import type { Education } from '@/lib/profileTypes';

type FormData = {
  school: string;
  degree: string;
  fieldOfStudy: string;
  startYear: string;
  endYear: string;
  description: string;
};

const EMPTY: FormData = { school: '', degree: '', fieldOfStudy: '', startYear: '', endYear: '', description: '' };

interface Props {
  open: boolean;
  onClose: () => void;
  entry?: Education | null;
  onSave: (data: Omit<Education, 'id' | 'personId' | 'sortOrder' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export default function EducationEntryModal({ open, onClose, entry, onSave, onDelete }: Props) {
  const [form, setForm] = useState<FormData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(entry ? {
        school: entry.school,
        degree: entry.degree ?? '',
        fieldOfStudy: entry.fieldOfStudy ?? '',
        startYear: entry.startYear?.toString() ?? '',
        endYear: entry.endYear?.toString() ?? '',
        description: entry.description ?? '',
      } : EMPTY);
    }
  }, [open, entry]);

  const set = (field: keyof FormData, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        school: form.school.trim(),
        degree: form.degree.trim() || null,
        fieldOfStudy: form.fieldOfStudy.trim() || null,
        startYear: form.startYear ? parseInt(form.startYear) : null,
        endYear: form.endYear ? parseInt(form.endYear) : null,
        description: form.description.trim() || null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    try { await onDelete(); onClose(); } finally { setDeleting(false); }
  };

  const years = Array.from({ length: 60 }, (_, i) => new Date().getFullYear() + 5 - i);

  return (
    <EditModal title={entry ? 'Edit education' : 'Add education'} open={open} onClose={onClose} size="lg">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-brand-grey mb-1">School *</label>
          <input value={form.school} onChange={(e) => set('school', e.target.value)} required
            placeholder="e.g. MIT"
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-brand-grey mb-1">Degree</label>
            <input value={form.degree} onChange={(e) => set('degree', e.target.value)}
              placeholder="e.g. Bachelor of Science"
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30" />
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-grey mb-1">Field of study</label>
            <input value={form.fieldOfStudy} onChange={(e) => set('fieldOfStudy', e.target.value)}
              placeholder="e.g. Computer Science"
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30" />
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-grey mb-1">Start year</label>
            <select value={form.startYear} onChange={(e) => set('startYear', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30 bg-white">
              <option value="">—</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-grey mb-1">End year</label>
            <select value={form.endYear} onChange={(e) => set('endYear', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30 bg-white">
              <option value="">—</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-brand-grey mb-1">Description</label>
          <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3}
            placeholder="Activities, honours, thesis…"
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30 resize-y" />
        </div>
        <div className="flex items-center justify-between pt-2">
          {entry && onDelete ? (
            <button type="button" onClick={handleDelete} disabled={deleting}
              className="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-xl hover:bg-red-50 transition-colors disabled:opacity-50">
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          ) : <div />}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-brand-grey border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-brand-black rounded-xl hover:opacity-80 transition-opacity disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </EditModal>
  );
}
