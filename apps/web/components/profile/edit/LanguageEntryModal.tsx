'use client';

import React, { useState, useEffect } from 'react';
import EditModal from './EditModal';
import type { ProfileLanguage, LanguageProficiency } from '@/lib/profileTypes';
import { PROFICIENCY_LABELS } from '@/lib/profileTypes';

interface Props {
  open: boolean;
  onClose: () => void;
  entry?: ProfileLanguage | null;
  onSave: (data: { language: string; proficiency: string }) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export default function LanguageEntryModal({ open, onClose, entry, onSave, onDelete }: Props) {
  const [language, setLanguage] = useState(entry?.language ?? '');
  const [proficiency, setProficiency] = useState<LanguageProficiency>(entry?.proficiency as LanguageProficiency ?? 'professional');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) {
      setLanguage(entry?.language ?? '');
      setProficiency((entry?.proficiency as LanguageProficiency) ?? 'professional');
    }
  }, [open, entry]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ language: language.trim(), proficiency });
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
    <EditModal title={entry ? 'Edit language' : 'Add language'} open={open} onClose={onClose} size="sm">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-brand-grey mb-1">Language *</label>
          <input value={language} onChange={(e) => setLanguage(e.target.value)} required
            placeholder="e.g. Spanish"
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30" />
        </div>
        <div>
          <label className="block text-xs font-medium text-brand-grey mb-1">Proficiency</label>
          <select value={proficiency} onChange={(e) => setProficiency(e.target.value as LanguageProficiency)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30 bg-white">
            {(Object.keys(PROFICIENCY_LABELS) as LanguageProficiency[]).map((k) => (
              <option key={k} value={k}>{PROFICIENCY_LABELS[k]}</option>
            ))}
          </select>
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
