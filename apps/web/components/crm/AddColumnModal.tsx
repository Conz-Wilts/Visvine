'use client';

import React, { useState } from 'react';
import { Lock, Globe, X, Plus, Trash2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';

export type CrmColumnType = 'text' | 'date' | 'select' | 'tags' | 'url';

export type ColumnSource = 'private' | 'community_request';

interface AddColumnModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddPrivate: (name: string, type: CrmColumnType, options?: string[]) => Promise<unknown>;
  onRequestCommunity: (name: string, type: CrmColumnType, description: string, options?: string[]) => Promise<void>;
  isAuthenticated: boolean;
  /** Pre-fill the column name (e.g. when upgrading from a private column) */
  defaultName?: string;
  /** Pre-fill the column type */
  defaultType?: CrmColumnType;
}

const COLUMN_TYPES: { value: CrmColumnType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Single Select' },
  { value: 'tags', label: 'Multi-select Tags' },
  { value: 'url', label: 'URL' },
];

export default function AddColumnModal({
  isOpen,
  onClose,
  onAddPrivate,
  onRequestCommunity,
  isAuthenticated,
  defaultName,
  defaultType,
}: AddColumnModalProps) {
  const [source, setSource] = useState<ColumnSource>('private');
  const [name, setName] = useState(defaultName || '');
  const [type, setType] = useState<CrmColumnType>(defaultType || 'text');
  const [description, setDescription] = useState('');
  const [options, setOptions] = useState<string[]>(['']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When modal opens with pre-fill values, reset fields
  React.useEffect(() => {
    if (isOpen) {
      setName(defaultName || '');
      setType(defaultType || 'text');
      // If pre-filling, start on community request tab since that's the upgrade flow
      if (defaultName) setSource('community_request');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const needsOptions = type === 'select' || type === 'tags';

  const filteredOptions = options.filter((o) => o.trim().length > 0);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Column name is required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (source === 'private') {
        await onAddPrivate(name.trim(), type, needsOptions ? filteredOptions : undefined);
      } else {
        await onRequestCommunity(
          name.trim(),
          type,
          description.trim(),
          needsOptions ? filteredOptions : undefined
        );
      }
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setName('');
    setType('text');
    setDescription('');
    setOptions(['']);
    setSource('private');
    setError(null);
    onClose();
  };

  const addOption = () => setOptions([...options, '']);
  const removeOption = (i: number) => setOptions(options.filter((_, idx) => idx !== i));
  const updateOption = (i: number, val: string) => {
    const next = [...options];
    next[i] = val;
    setOptions(next);
  };

  return (
    <Modal
      open={isOpen}
      onClose={handleClose}
      closeOnEscape={false}
      overlayClassName="items-center justify-center bg-black/50"
      maxWidth="max-w-lg"
      panelClassName="relative bg-white rounded-xl shadow-xl mx-4"
    >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Add Column</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Add context visible only to you, or propose it for everyone.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {!isAuthenticated && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              Sign in to save columns. Right now columns will be lost on page refresh.
            </div>
          )}

          {/* Source toggle */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSource('private')}
              className={`
                flex flex-col items-start gap-1.5 p-4 rounded-xl border-2 text-left transition-all
                ${source === 'private'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }
              `}
            >
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-lg ${source === 'private' ? 'bg-blue-100' : 'bg-gray-100'}`}>
                  <Lock className={`w-4 h-4 ${source === 'private' ? 'text-blue-600' : 'text-gray-500'}`} />
                </div>
                <span className={`font-medium text-sm ${source === 'private' ? 'text-blue-700' : 'text-gray-700'}`}>
                  Private
                </span>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">
                Only visible to you. Your personal context.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setSource('community_request')}
              className={`
                flex flex-col items-start gap-1.5 p-4 rounded-xl border-2 text-left transition-all
                ${source === 'community_request'
                  ? 'border-purple-500 bg-purple-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }
              `}
            >
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-lg ${source === 'community_request' ? 'bg-purple-100' : 'bg-gray-100'}`}>
                  <Globe className={`w-4 h-4 ${source === 'community_request' ? 'text-purple-600' : 'text-gray-500'}`} />
                </div>
                <span className={`font-medium text-sm ${source === 'community_request' ? 'text-purple-700' : 'text-gray-700'}`}>
                  Request for All
                </span>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">
                Propose to admins for the whole community.
              </p>
            </button>
          </div>

          {/* Column name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Column Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Last Contacted, Deal Stage, Notes"
              className="w-full px-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
              autoFocus
            />
          </div>

          {/* Column type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Column Type</label>
            <div className="grid grid-cols-3 gap-2">
              {COLUMN_TYPES.map((ct) => (
                <button
                  key={ct.value}
                  type="button"
                  onClick={() => setType(ct.value)}
                  className={`
                    px-3 py-2 rounded-lg border text-sm font-medium transition-all
                    ${type === ct.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    }
                  `}
                >
                  {ct.label}
                </button>
              ))}
            </div>
          </div>

          {/* Options (for select / tags) */}
          {needsOptions && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Options <span className="text-gray-400 text-xs font-normal">(optional — add choices)</span>
              </label>
              <div className="space-y-2">
                {options.map((opt, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      type="text"
                      value={opt}
                      onChange={(e) => updateOption(i, e.target.value)}
                      placeholder={`Option ${i + 1}`}
                      className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                    />
                    {options.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeOption(i)}
                        className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addOption}
                  className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  <Plus className="w-4 h-4" />
                  Add option
                </button>
              </div>
            </div>
          )}

          {/* Description (community request only) */}
          {source === 'community_request' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Why is this useful?{' '}
                <span className="text-gray-400 text-xs font-normal">(optional, helps admins decide)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Our team tracks deal stages for investors — this would help everyone stay aligned"
                rows={3}
                className="w-full px-4 py-2.5 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
              />
            </div>
          )}

          {/* Pending info banner */}
          {source === 'community_request' && (
            <div className="flex items-start gap-3 p-3 bg-purple-50 border border-purple-100 rounded-lg text-sm text-purple-700">
              <Globe className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Your request will appear in the table as pending until a community admin approves it.
              </span>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 pb-6">
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !name.trim()}
            className={`
              px-5 py-2 text-sm font-medium rounded-lg transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed
              ${source === 'community_request'
                ? 'bg-purple-600 hover:bg-purple-700 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
              }
            `}
          >
            {saving ? 'Saving…' : source === 'private' ? 'Add Private Column' : 'Submit Request'}
          </button>
        </div>
    </Modal>
  );
}
