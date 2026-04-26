'use client';

import React, { useState, useEffect } from 'react';
import EditModal from './EditModal';
import type { WorkExperience } from '@/lib/profileTypes';

type FormData = {
  title: string;
  company: string;
  location: string;
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
};

const EMPTY: FormData = { title: '', company: '', location: '', startDate: '', endDate: '', current: false, description: '' };

interface Props {
  open: boolean;
  onClose: () => void;
  entry?: WorkExperience | null;
  onSave: (data: Omit<WorkExperience, 'id' | 'personId' | 'sortOrder' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export default function ExperienceEntryModal({ open, onClose, entry, onSave, onDelete }: Props) {
  const [form, setForm] = useState<FormData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(entry ? {
        title: entry.title,
        company: entry.company,
        location: entry.location ?? '',
        startDate: entry.startDate,
        endDate: entry.endDate ?? '',
        current: entry.current,
        description: entry.description ?? '',
      } : EMPTY);
    }
  }, [open, entry]);

  const set = (field: keyof FormData, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        title: form.title.trim(),
        company: form.company.trim(),
        location: form.location.trim() || null,
        startDate: form.startDate,
        endDate: form.current ? null : (form.endDate || null),
        current: form.current,
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

  return (
    <EditModal title={entry ? 'Edit experience' : 'Add experience'} open={open} onClose={onClose} size="lg">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-brand-grey mb-1">Title *</label>
            <input value={form.title} onChange={(e) => set('title', e.target.value)} required
              placeholder="e.g. Software Engineer"
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-brand-grey mb-1">Company *</label>
            <input value={form.company} onChange={(e) => set('company', e.target.value)} required
              placeholder="e.g. Acme Corp"
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30" />
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-grey mb-1">Location</label>
            <input value={form.location} onChange={(e) => set('location', e.target.value)}
              placeholder="e.g. San Francisco, CA"
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30" />
          </div>
          <div />
          <div>
            <label className="block text-xs font-medium text-brand-grey mb-1">Start date *</label>
            <input type="month" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} required
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30" />
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-grey mb-1">End date</label>
            <input type="month" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} disabled={form.current}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30 disabled:opacity-40" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer sm:col-span-2">
            <input type="checkbox" checked={form.current} onChange={(e) => set('current', e.target.checked)} className="w-4 h-4 accent-brand-dark-green" />
            <span className="text-sm text-brand-black">I currently work here</span>
          </label>
        </div>
        <div>
          <label className="block text-xs font-medium text-brand-grey mb-1">Description</label>
          <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={4}
            placeholder="Describe your responsibilities and accomplishments…"
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
