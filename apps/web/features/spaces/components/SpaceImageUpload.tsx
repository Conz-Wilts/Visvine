'use client';

import React, { useRef, useState } from 'react';
import { validateImageFile, uploadImage, deleteImage } from '@/lib/imageUpload';
import type { Space } from '@/lib/types';
import { fetchJsonBody } from '@/lib/fetchJson';
import SpaceAvatar from './SpaceAvatar';

interface SpaceImageUploadProps {
  space: Space;
  onUploadComplete: (newImageUrl: string) => void;
  size?: 'lg' | 'xl';
}

export default function SpaceImageUpload({
  space,
  onUploadComplete,
  size = 'xl',
}: SpaceImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasExisting = !!space.imageUrl;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setPendingFile(file);
    setPreview(URL.createObjectURL(file));

    // Reset input so same file can be re-selected after discard
    if (inputRef.current) inputRef.current.value = '';
  }

  function handleDiscard() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setPendingFile(null);
    setError(null);
  }

  async function handleSave() {
    if (!pendingFile) return;
    setUploading(true);
    setError(null);

    try {
      if (hasExisting) {
        await deleteImage('space', space.id);
      }

      const url = await uploadImage('space', space.id, pendingFile);

      // Persist imageUrl to the space record
      await fetchJsonBody('/api/data/communities', 'PUT', { space: { ...space, imageUrl: url } });

      if (preview) URL.revokeObjectURL(preview);
      setPreview(null);
      setPendingFile(null);
      onUploadComplete(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Preview state */}
      {preview ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-text-primary">Preview</p>

          {/* Preview frame */}
          <div className="flex items-center gap-4">
            <div className="relative rounded-full overflow-hidden ring-2 ring-border-default"
              style={{ width: size === 'xl' ? 64 : 48, height: size === 'xl' ? 64 : 48 }}>
              <img
                src={preview}
                alt="Preview"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs text-text-muted">Looks good?</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={uploading}
                  onClick={handleSave}
                  className="px-3 py-1.5 text-xs font-medium bg-brand-green text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1.5"
                >
                  {uploading && (
                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  {uploading ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  disabled={uploading}
                  onClick={handleDiscard}
                  className="px-3 py-1.5 text-xs font-medium border border-border-default text-text-primary rounded-lg hover:bg-surface-2 transition-colors disabled:opacity-50"
                >
                  Discard
                </button>
              </div>
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      ) : (
        /* Normal state */
        <div className="flex items-center gap-4">
          <div
            className="relative group cursor-pointer"
            onClick={() => inputRef.current?.click()}
          >
            <SpaceAvatar name={space.name} imageUrl={space.imageUrl} size={size} />
            {space.imageUrl && (
              <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-sm font-medium text-text-primary hover:underline transition-colors text-left"
            >
              {hasExisting ? 'Change image' : 'Upload image'}
            </button>
            <p className="text-xs text-text-muted">JPEG, PNG, WebP, HEIC up to 10MB</p>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
