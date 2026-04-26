'use client';

import React, { useState, useEffect } from 'react';
import EditModal from './EditModal';
import type { FullProfile } from '@/lib/profileTypes';

interface Props {
  open: boolean;
  onClose: () => void;
  profile: FullProfile;
  onSave: (patch: Partial<FullProfile>) => Promise<void>;
}

export default function EditBasicInfoModal({ open, onClose, profile, onSave }: Props) {
  const [name, setName] = useState(profile.name);
  const [subtitle, setSubtitle] = useState(profile.subtitle ?? '');
  const [location, setLocation] = useState(profile.location ?? '');
  const [pronouns, setPronouns] = useState(profile.pronouns ?? '');
  const [openToWork, setOpenToWork] = useState(profile.openToWork);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(profile.name);
      setSubtitle(profile.subtitle ?? '');
      setLocation(profile.location ?? '');
      setPronouns(profile.pronouns ?? '');
      setOpenToWork(profile.openToWork);
    }
  }, [open, profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        subtitle: subtitle.trim() || null,
        location: location.trim() || null,
        pronouns: pronouns.trim() || null,
        openToWork,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditModal title="Edit intro" open={open} onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-brand-grey mb-1">Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-brand-grey mb-1">Headline</label>
          <input
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="e.g. Founder & CEO at Acme Corp"
            maxLength={220}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30"
          />
          <p className="text-xs text-brand-grey mt-1">{subtitle.length}/220</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-brand-grey mb-1">Location</label>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City, Country"
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-brand-grey mb-1">Pronouns</label>
          <input
            value={pronouns}
            onChange={(e) => setPronouns(e.target.value)}
            placeholder="e.g. they/them"
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30"
          />
        </div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={openToWork}
            onChange={(e) => setOpenToWork(e.target.checked)}
            className="w-4 h-4 accent-brand-dark-green"
          />
          <span className="text-sm text-brand-black">Open to work</span>
        </label>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-brand-grey border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-brand-black rounded-xl hover:opacity-80 transition-opacity disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </EditModal>
  );
}
