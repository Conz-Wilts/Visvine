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

export default function EditContactModal({ open, onClose, profile, onSave }: Props) {
  const [email, setEmail] = useState(profile.email ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [website, setWebsite] = useState(profile.website ?? '');
  const [linkedinUrl, setLinkedinUrl] = useState(profile.linkedinUrl ?? '');
  const [twitterUrl, setTwitterUrl] = useState(profile.twitterUrl ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail(profile.email ?? '');
      setPhone(profile.phone ?? '');
      setWebsite(profile.website ?? '');
      setLinkedinUrl(profile.linkedinUrl ?? '');
      setTwitterUrl(profile.twitterUrl ?? '');
    }
  }, [open, profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        email: email.trim() || null,
        phone: phone.trim() || null,
        website: website.trim() || null,
        linkedinUrl: linkedinUrl.trim() || null,
        twitterUrl: twitterUrl.trim() || null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditModal title="Edit contact info" open={open} onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        {[
          { label: 'Email', value: email, set: setEmail, type: 'email', placeholder: 'your@email.com' },
          { label: 'Phone', value: phone, set: setPhone, type: 'tel', placeholder: '+1 555 000 0000' },
          { label: 'Website', value: website, set: setWebsite, type: 'url', placeholder: 'https://yoursite.com' },
          { label: 'LinkedIn URL', value: linkedinUrl, set: setLinkedinUrl, type: 'url', placeholder: 'https://linkedin.com/in/you' },
          { label: 'Twitter / X URL', value: twitterUrl, set: setTwitterUrl, type: 'url', placeholder: 'https://x.com/you' },
        ].map(({ label, value, set, type, placeholder }) => (
          <div key={label}>
            <label className="block text-xs font-medium text-brand-grey mb-1">{label}</label>
            <input
              type={type}
              value={value}
              onChange={(e) => set(e.target.value)}
              placeholder={placeholder}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30"
            />
          </div>
        ))}
        <ModalFooter onCancel={onClose} saving={saving} />
      </form>
    </EditModal>
  );
}
