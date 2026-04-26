'use client';

import { useState, useRef } from 'react';
import { Community, CommunityDesignConfig, CommunityDesignFont } from '@/lib/types';
import Button from '@/components/ui/Button';

interface Props {
  community: Community;
  onSaved: (updated: Partial<Community>) => void;
}

function Tooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex items-center ml-1.5">
      <button
        type="button"
        className="w-4 h-4 rounded-full bg-surface-3 text-text-muted text-[10px] font-bold flex items-center justify-center hover:bg-surface-2 transition"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(v => !v)}
      >
        ?
      </button>
      {show && (
        <div className="absolute left-6 top-1/2 -translate-y-1/2 z-10 w-56 px-3 py-2 text-xs text-text-secondary bg-surface-1 border border-border-default rounded-lg shadow-lg">
          {text}
        </div>
      )}
    </span>
  );
}

function FontUploadSection({
  label,
  tooltip,
  font,
  category,
  communityId,
  onUploaded,
  onReset,
}: {
  label: string;
  tooltip: string;
  font?: CommunityDesignFont;
  category: 'main' | 'utility';
  communityId: string;
  onUploaded: (font: CommunityDesignFont) => void;
  onReset: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['woff2', 'ttf', 'otf'].includes(ext ?? '')) {
      setError('Must be .woff2, .ttf, or .otf');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Font must be under 5MB');
      return;
    }

    setError('');
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('communityId', communityId);
      formData.append('category', category);
      const res = await fetch('/api/upload/font', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }
      const data = await res.json();
      onUploaded({ name: data.name, url: data.url, format: data.format });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <div className="flex items-center mb-2">
        <label className="text-sm font-medium text-text-primary">{label}</label>
        <Tooltip text={tooltip} />
      </div>
      {font ? (
        <div className="flex items-center gap-3 p-3 bg-surface-2 rounded-lg border border-border-subtle">
          <div className="flex-1">
            <p className="text-sm font-medium text-text-primary">{font.name}</p>
            <p className="text-xs text-text-muted">{font.format}</p>
          </div>
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-red-500 hover:text-red-600 font-medium"
          >
            Reset to default
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <p className="text-sm text-text-muted flex-1">
            {category === 'main' ? 'ABC Ginto Rounded (default)' : 'Open Sauce One (default)'}
          </p>
        </div>
      )}
      <div className="mt-2">
        <input
          ref={inputRef}
          type="file"
          accept=".woff2,.ttf,.otf"
          onChange={handleUpload}
          className="text-sm text-text-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-surface-3 file:text-text-primary hover:file:bg-surface-2 file:cursor-pointer file:transition"
          disabled={uploading}
        />
        {uploading && <p className="text-xs text-text-muted mt-1">Uploading...</p>}
        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      </div>
    </div>
  );
}

export default function CommunityDesignPanel({ community, onSaved }: Props) {
  const existing = (community.designConfig ?? {}) as CommunityDesignConfig;

  const [bgType, setBgType] = useState<'solid' | 'image'>(existing.background?.type ?? 'solid');
  const [bgColor, setBgColor] = useState(existing.background?.color ?? '#F5F7F5');
  const [bgImageUrl, setBgImageUrl] = useState(existing.background?.imageUrl ?? '');
  const [mainFont, setMainFont] = useState<CommunityDesignFont | undefined>(existing.fonts?.main);
  const [utilityFont, setUtilityFont] = useState<CommunityDesignFont | undefined>(existing.fonts?.utility);
  const [saving, setSaving] = useState(false);
  const [uploadingBgImage, setUploadingBgImage] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const bgImageInputRef = useRef<HTMLInputElement>(null);

  async function handleBgImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingBgImage(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('entityType', 'community');
      formData.append('entityId', `${community.id}-bg`);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }
      const data = await res.json();
      setBgImageUrl(data.url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to upload background image');
    } finally {
      setUploadingBgImage(false);
      if (bgImageInputRef.current) bgImageInputRef.current.value = '';
    }
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const designConfig: CommunityDesignConfig = {};

      // Background
      if (bgType === 'solid' && bgColor && bgColor !== '#F5F7F5') {
        designConfig.background = { type: 'solid', color: bgColor };
      } else if (bgType === 'image' && bgImageUrl) {
        designConfig.background = { type: 'image', imageUrl: bgImageUrl };
      }

      // Fonts
      if (mainFont || utilityFont) {
        designConfig.fonts = {};
        if (mainFont) designConfig.fonts.main = mainFont;
        if (utilityFont) designConfig.fonts.utility = utilityFont;
      }

      const res = await fetch(`/api/communities/${community.id}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ designConfig }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save');
      }

      setSuccess('Design settings saved');
      onSaved({ designConfig });
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8 max-w-2xl py-2">
      {/* Background Section */}
      <section>
        <h3 className="text-lg font-semibold text-text-primary mb-4">Background</h3>
        <div className="space-y-4">
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="bgType"
                value="solid"
                checked={bgType === 'solid'}
                onChange={() => setBgType('solid')}
                className="accent-brand-green"
              />
              <span className="text-sm text-text-primary">Solid Color</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="bgType"
                value="image"
                checked={bgType === 'image'}
                onChange={() => setBgType('image')}
                className="accent-brand-green"
              />
              <span className="text-sm text-text-primary">Image</span>
            </label>
          </div>

          {bgType === 'solid' && (
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={bgColor}
                onChange={e => setBgColor(e.target.value)}
                className="w-10 h-10 rounded-lg border border-border-default cursor-pointer"
              />
              <input
                type="text"
                value={bgColor}
                onChange={e => setBgColor(e.target.value)}
                placeholder="#F5F7F5"
                className="px-3 py-2 text-sm border border-border-default rounded-lg bg-surface-1 text-text-primary w-28"
              />
              <span className="text-xs text-text-muted">Default: #F5F7F5</span>
            </div>
          )}

          {bgType === 'image' && (
            <div className="space-y-3">
              {bgImageUrl && (
                <div className="relative w-full h-32 rounded-lg overflow-hidden border border-border-default">
                  <img
                    src={bgImageUrl}
                    alt="Background preview"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setBgImageUrl('')}
                    className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/50 text-white text-xs flex items-center justify-center hover:bg-black/70"
                  >
                    x
                  </button>
                </div>
              )}
              <input
                ref={bgImageInputRef}
                type="file"
                accept="image/*"
                onChange={handleBgImageUpload}
                disabled={uploadingBgImage}
                className="text-sm text-text-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-surface-3 file:text-text-primary hover:file:bg-surface-2 file:cursor-pointer file:transition"
              />
              {uploadingBgImage && <p className="text-xs text-text-muted">Uploading...</p>}
            </div>
          )}
        </div>
      </section>

      {/* Fonts Section */}
      <section>
        <h3 className="text-lg font-semibold text-text-primary mb-4">Fonts</h3>
        <div className="space-y-6">
          <FontUploadSection
            label="Main Font (Titles)"
            tooltip="Controls headings, titles, and brand text across your community. Default: ABC Ginto Rounded"
            font={mainFont}
            category="main"
            communityId={community.id}
            onUploaded={setMainFont}
            onReset={() => setMainFont(undefined)}
          />
          <FontUploadSection
            label="Utility Font (Body)"
            tooltip="Controls body text, labels, and UI elements across your community. Default: Open Sauce One"
            font={utilityFont}
            category="utility"
            communityId={community.id}
            onUploaded={setUtilityFont}
            onReset={() => setUtilityFont(undefined)}
          />
        </div>
      </section>

      {/* Save */}
      <div className="flex items-center gap-4 pt-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Design'}
        </Button>
        {success && <span className="text-sm text-green-600">{success}</span>}
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    </div>
  );
}
