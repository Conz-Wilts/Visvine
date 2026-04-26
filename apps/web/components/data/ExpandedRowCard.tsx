'use client';

import React, { useState, useRef } from 'react';
import { Save, X, Camera, Loader2 } from 'lucide-react';
import ComboboxMultiSelect from './ComboboxMultiSelect';
import ImageCropper from './ImageCropper';
import { validateImageFile } from '@/lib/imageUpload';

export type FieldType = 'text' | 'select' | 'tags' | 'readonly' | 'date' | 'image';

export interface ColumnConfig {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  required?: boolean;
  placeholder?: string;
  isCustom?: boolean;
  width?: number;
  sortable?: boolean;
  filterable?: boolean;
  creatable?: boolean;
  imageShape?: 'square' | 'circle';
}

interface ExpandedRowCardProps<T> {
  row: T;
  columns: ColumnConfig[];
  onSave: (updatedRow: T) => Promise<void>;
  onCancel: () => void;
  onImageUpload?: (row: T, columnKey: string, file: File) => Promise<string>;
  isNew?: boolean;
}

export default function ExpandedRowCard<T extends Record<string, unknown>>({
  row,
  columns,
  onSave,
  onCancel,
  onImageUpload,
  isNew = false,
}: ExpandedRowCardProps<T>) {
  const [editedRow, setEditedRow] = useState<T>({ ...row });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState<string | null>(null);
  const [cropperState, setCropperState] = useState<{
    isOpen: boolean;
    file: File | null;
    columnKey: string;
    imageShape: 'square' | 'circle';
  } | null>(null);
  const imageInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const getValue = (col: ColumnConfig): unknown => {
    if (col.key.startsWith('metadata.')) {
      const metadataKey = col.key.split('.')[1];
      return (editedRow.metadata as Record<string, unknown>)?.[metadataKey];
    }
    return editedRow[col.key];
  };

  const setValue = (col: ColumnConfig, value: unknown) => {
    if (col.key.startsWith('metadata.')) {
      const metadataKey = col.key.split('.')[1];
      setEditedRow({
        ...editedRow,
        metadata: {
          ...(editedRow.metadata as Record<string, unknown> || {}),
          [metadataKey]: value,
        },
      });
    } else {
      setEditedRow({ ...editedRow, [col.key]: value });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(editedRow);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // Open cropper when image is selected
  const handleImageSelect = (col: ColumnConfig, file: File) => {
    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setCropperState({
      isOpen: true,
      file,
      columnKey: col.key,
      imageShape: col.imageShape ?? 'square',
    });
    setError(null);
  };

  // Handle cropped image upload
  const handleCroppedImageUpload = async (blob: Blob) => {
    if (!onImageUpload || !cropperState) return;

    const col = columns.find(c => c.key === cropperState.columnKey);
    if (!col) {
      setCropperState(null);
      return;
    }

    setUploadingImage(col.key);
    try {
      // Convert blob to file for the upload handler
      const file = new File([blob], cropperState.file?.name || 'image.jpg', {
        type: blob.type,
      });
      const url = await onImageUpload(editedRow, col.key, file);
      setValue(col, url);
      setCropperState(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload image');
    } finally {
      setUploadingImage(null);
    }
  };

  // Cancel cropper
  const handleCropperCancel = () => {
    setCropperState(null);
  };

  const renderField = (col: ColumnConfig) => {
    const value = getValue(col);

    if (col.type === 'readonly') {
      return (
        <div className="px-4 py-3 bg-gray-50 rounded-lg text-sm text-gray-600">
          {String(value || col.placeholder || 'Auto-generated')}
        </div>
      );
    }

    if (col.type === 'image') {
      const imageUrl = value as string | undefined;
      const isUploading = uploadingImage === col.key;

      return (
        <div className="flex items-center gap-4">
          {imageUrl && (
            <img
              src={imageUrl}
              alt={col.label}
              className={`object-cover border border-gray-200 ${col.imageShape === 'circle' ? 'w-20 h-20 rounded-full' : 'w-28 h-20 rounded-lg'}`}
            />
          )}
          <input
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,image/tiff,image/bmp,image/heic,image/heif,image/svg+xml"
            className="hidden"
            ref={(el) => { imageInputRefs.current[col.key] = el; }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImageSelect(col, file);
              e.target.value = '';
            }}
            disabled={isUploading || isNew}
          />
          <button
            type="button"
            onClick={() => imageInputRefs.current[col.key]?.click()}
            disabled={isUploading || isNew}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed
              transition-colors text-sm
              ${isUploading || isNew
                ? 'border-gray-200 text-gray-400 cursor-not-allowed'
                : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50 cursor-pointer'
              }
            `}
          >
            {isUploading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Camera className="w-4 h-4" />
            )}
            {isNew ? 'Save first to upload' : 'Upload Image'}
          </button>
        </div>
      );
    }

    if (col.type === 'select') {
      return (
        <select
          value={String(value || '')}
          onChange={(e) => setValue(col, e.target.value)}
          className="
            w-full px-4 py-3 text-sm
            border border-gray-300 rounded-lg
            focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500
          "
        >
          <option value="">Select {col.label}...</option>
          {col.options?.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );
    }

    if (col.type === 'tags') {
      return (
        <ComboboxMultiSelect
          value={Array.isArray(value) ? value as string[] : []}
          options={col.options || []}
          onChange={(newValue) => setValue(col, newValue)}
          placeholder={col.placeholder || `Select ${col.label}...`}
          creatable={col.creatable !== false}
        />
      );
    }

    if (col.type === 'date') {
      return (
        <input
          type="date"
          value={String(value || '')}
          onChange={(e) => setValue(col, e.target.value)}
          className="
            w-full px-4 py-3 text-sm
            border border-gray-300 rounded-lg
            focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500
          "
        />
      );
    }

    // Default: text input
    return (
      <input
        type="text"
        value={String(value || '')}
        onChange={(e) => setValue(col, e.target.value)}
        placeholder={col.placeholder}
        className="
          w-full px-4 py-3 text-sm
          border border-gray-300 rounded-lg
          focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500
        "
      />
    );
  };

  return (
    <tr>
      <td colSpan={columns.length + 2} className="p-0">
        <div className="bg-blue-50/50 border-y border-blue-100 p-6">
          {/* Error message */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Form grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {columns.map((col) => (
              <div key={col.key} className={col.type === 'image' ? 'md:col-span-2 lg:col-span-3' : ''}>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {col.label}
                  {col.required && <span className="text-red-500 ml-1">*</span>}
                </label>
                {renderField(col)}
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-blue-100">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="
                inline-flex items-center gap-2 px-4 py-2
                text-gray-700 text-sm font-medium rounded-lg
                hover:bg-gray-100 transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed
              "
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="
                inline-flex items-center gap-2 px-4 py-2
                bg-blue-600 text-white text-sm font-medium rounded-lg
                hover:bg-blue-700 transition-colors
                disabled:bg-blue-400 disabled:cursor-not-allowed
              "
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {isNew ? 'Create' : 'Save Changes'}
            </button>
          </div>
        </div>

        {/* Image Cropper Modal */}
        {cropperState?.isOpen && cropperState.file && (
          <ImageCropper
            imageFile={cropperState.file}
            onCrop={handleCroppedImageUpload}
            onCancel={handleCropperCancel}
            isUploading={uploadingImage === cropperState.columnKey}
            shape={cropperState.imageShape}
            outputWidth={cropperState.imageShape === 'circle' ? 300 : 400}
            outputHeight={300}
            previewName={(editedRow.name as string) || undefined}
          />
        )}
      </td>
    </tr>
  );
}
