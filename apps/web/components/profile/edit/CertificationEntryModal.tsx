'use client';

import React, { useState, useEffect } from 'react';
import EditModal from './EditModal';
import type { Certification } from '@/lib/profileTypes';

type FormData = {
  name: string;
  issuingOrg: string;
  issueDate: string;
  expiryDate: string;
  credentialId: string;
  credentialUrl: string;
};

const EMPTY: FormData = { name: '', issuingOrg: '', issueDate: '', expiryDate: '', credentialId: '', credentialUrl: '' };

interface Props {
  open: boolean;
  onClose: () => void;
  entry?: Certification | null;
  onSave: (data: Omit<Certification, 'id' | 'personId' | 'sortOrder' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export default function CertificationEntryModal({ open, onClose, entry, onSave, onDelete }: Props) {
  const [form, setForm] = useState<FormData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(entry ? {
        name: entry.name,
        issuingOrg: entry.issuingOrg,
        issueDate: entry.issueDate ?? '',
        expiryDate: entry.expiryDate ?? '',
        credentialId: entry.credentialId ?? '',
        credentialUrl: entry.credentialUrl ?? '',
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
        name: form.name.trim(),
        issuingOrg: form.issuingOrg.trim(),
        issueDate: form.issueDate || null,
        expiryDate: form.expiryDate || null,
        credentialId: form.credentialId.trim() || null,
        credentialUrl: form.credentialUrl.trim() || null,
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
    <EditModal title={entry ? 'Edit certification' : 'Add certification'} open={open} onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-brand-grey mb-1">Name *</label>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} required
            placeholder="e.g. AWS Solutions Architect"
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30" />
        </div>
        <div>
          <label className="block text-xs font-medium text-brand-grey mb-1">Issuing organisation *</label>
          <input value={form.issuingOrg} onChange={(e) => set('issuingOrg', e.target.value)} required
            placeholder="e.g. Amazon Web Services"
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-brand-grey mb-1">Issue date</label>
            <input type="month" value={form.issueDate} onChange={(e) => set('issueDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30" />
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-grey mb-1">Expiry date</label>
            <input type="month" value={form.expiryDate} onChange={(e) => set('expiryDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-brand-grey mb-1">Credential ID</label>
          <input value={form.credentialId} onChange={(e) => set('credentialId', e.target.value)}
            placeholder="Optional"
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30" />
        </div>
        <div>
          <label className="block text-xs font-medium text-brand-grey mb-1">Credential URL</label>
          <input type="url" value={form.credentialUrl} onChange={(e) => set('credentialUrl', e.target.value)}
            placeholder="https://"
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30" />
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
