'use client';

import { useState, useRef } from 'react';
import { Camera, Loader2, ArrowLeft, ArrowRight } from 'lucide-react';
import { validateImageFile } from '@/lib/imageUpload';
import type { OnboardingData } from '@/app/onboarding/OnboardingWizard';

interface Props {
  data: OnboardingData;
  personId: string;
  onNext: (data: Partial<OnboardingData>) => void;
  onBack: () => void;
  saving: boolean;
}

export default function PhotoBasicsStep({ data, personId, onNext, onBack, saving }: Props) {
  const [imageUrl, setImageUrl] = useState(data.imageUrl);
  const [subtitle, setSubtitle] = useState(data.subtitle);
  const [location, setLocation] = useState(data.location);
  const [pronouns, setPronouns] = useState(data.pronouns);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const error = validateImageFile(file);
    if (error) { setUploadError(error); return; }

    setUploading(true);
    setUploadError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('entityType', 'person');
      formData.append('entityId', personId);

      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to upload image');
      }

      const { url, baseUrl } = await res.json();
      setImageUrl(url);
      
      const saveRes = await fetch('/api/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: baseUrl }),
      });
      if (!saveRes.ok) {
        const err = await saveRes.json();
        throw new Error(err.error || 'Failed to save image URL');
      }
    } catch (err) {
      console.error('Image upload/save error:', err);
      setUploadError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleNext = () => {
    onNext({ imageUrl, subtitle, location, pronouns });
  };

  return (
    <div className="p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Your profile photo & basics</h2>
      <p className="text-sm text-gray-500 mb-6">Help people recognize you in the community.</p>

      <div className="flex flex-col items-center mb-6">
        <div className="relative group">
          {imageUrl ? (
            <img src={imageUrl} alt="Profile" className="w-28 h-28 rounded-full object-cover" />
          ) : (
            <div className="w-28 h-28 rounded-full bg-gray-100 flex items-center justify-center">
              <Camera className="w-8 h-8 text-gray-400" />
            </div>
          )}
          {/* Desktop hover affordance */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            aria-label={imageUrl ? 'Change photo' : 'Add photo'}
            className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity flex items-center justify-center"
          >
            {uploading ? (
              <Loader2 className="w-6 h-6 text-white animate-spin" />
            ) : (
              <Camera className="w-6 h-6 text-white" />
            )}
          </button>
          {/* Always-visible badge so the control is discoverable (incl. touch) */}
          <span
            aria-hidden="true"
            className="absolute bottom-0 right-0 w-9 h-9 rounded-full bg-brand-green text-white flex items-center justify-center shadow-md ring-2 ring-white pointer-events-none"
          >
            <Camera className="w-4 h-4" />
          </span>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="mt-3 text-sm font-medium text-brand-green hover:underline disabled:opacity-60"
        >
          {uploading ? 'Uploading…' : imageUrl ? 'Change photo' : 'Add a photo'}
        </button>
      </div>
      {uploadError && <p className="text-red-500 text-xs text-center mb-4">{uploadError}</p>}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Headline</label>
          <input
            type="text"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="e.g. Product Designer at Acme"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City, Country"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Pronouns <span className="text-gray-400 font-normal">(optional)</span></label>
          <input
            type="text"
            value={pronouns}
            onChange={(e) => setPronouns(e.target.value)}
            placeholder="e.g. she/her, he/him, they/them"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green"
          />
        </div>
      </div>

      <div className="flex justify-between mt-8">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={handleNext}
          disabled={saving}
          className="bg-brand-green text-white rounded-full px-6 py-2.5 text-sm font-semibold hover:opacity-90 active:translate-y-[1px] transition-all duration-200 shadow-soft flex items-center gap-1 disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Next'} {!saving && <ArrowRight className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
