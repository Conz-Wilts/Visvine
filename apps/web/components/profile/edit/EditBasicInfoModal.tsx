'use client';

import React, { useState, useEffect } from 'react';
import EditModal from './EditModal';
import ModalFooter from './ModalFooter';
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(profile.name);
      setSubtitle(profile.subtitle ?? '');
      setLocation(profile.location ?? '');
      setPronouns(profile.pronouns ?? '');
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
        <ModalFooter onCancel={onClose} saving={saving} />
      </form>
    </EditModal>
  );
}
