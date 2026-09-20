'use client';

import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { CameraIcon, LoaderCircleIcon } from '@/features/shared/icons';
import EditModal from './EditModal';
import ModalFooter from './ModalFooter';
import { uploadImage, validateImageFile } from '@/lib/imageUpload';
import PersonSilhouette from '@/components/ui/PersonSilhouette';
import type { FullProfile } from '@/lib/types/profile';

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
  const [imageUrl, setImageUrl] = useState(profile.imageUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(profile.name);
      setSubtitle(profile.subtitle ?? '');
      setLocation(profile.location ?? '');
      setImageUrl(profile.imageUrl ?? null);
      setUploadError(null);
    }
  }, [open, profile]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const invalid = validateImageFile(file);
    if (invalid) { setUploadError(invalid); return; }
    setUploadError(null);
    setUploading(true);
    try {
      const url = await uploadImage('person', profile.id, file);
      setImageUrl(url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        subtitle: subtitle.trim() || null,
        location: location.trim() || null,
        ...(imageUrl !== (profile.imageUrl ?? null) && { imageUrl }),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditModal title="Intro" open={open} onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        {/* Photo */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="relative group w-20 h-20 flex-none rounded-2xl overflow-hidden ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-dark-green/40"
            aria-label="Change profile photo"
          >
            {imageUrl ? (
              <Image src={imageUrl} alt={name} width={80} height={80} className="w-full h-full object-cover" />
            ) : (
              <PersonSilhouette />
            )}
            <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 group-hover:opacity-100 transition-opacity">
              {uploading ? <LoaderCircleIcon className="w-5 h-5 animate-spin" /> : <CameraIcon className="w-5 h-5" />}
            </span>
          </button>
          {uploadError && <p className="min-w-0 text-xs text-red-500">{uploadError}</p>}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
        </div>

        <div>
          <label className="block text-xs font-medium text-brand-grey mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full px-3 py-2 border border-border-subtle rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-brand-grey mb-1">Headline</label>
          <input
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="Founder at Acme"
            maxLength={220}
            className="w-full px-3 py-2 border border-border-subtle rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-brand-grey mb-1">Location</label>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City, Country"
            className="w-full px-3 py-2 border border-border-subtle rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30"
          />
        </div>
        <ModalFooter onCancel={onClose} saving={saving} />
      </form>
    </EditModal>
  );
}
