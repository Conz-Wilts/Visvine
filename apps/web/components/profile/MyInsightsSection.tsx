'use client';

import React, { useState, useCallback } from 'react';
import { Lock, Plus, Share2, Check, Pencil, X } from 'lucide-react';
import { useCrmColumns, prvKey, type PrivateColumn } from '@/hooks/useCrmColumns';

interface MyInsightsSectionProps {
  nodeId: string;
  communityId?: string | null;
}

/** Heading shared by both states — keeps the private "only you" treatment but
 *  matches the floating-card section-header style (font-ginto, lock chip). */
function InsightsHeader() {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span className="w-7 h-7 rounded-lg grid place-items-center flex-none bg-blue-500/10 text-blue-500">
        <Lock className="w-4 h-4" />
      </span>
      <h3 className="text-[15px] font-bold font-ginto text-text-primary">My Insights</h3>
      <span className="text-[11px] font-medium text-text-muted bg-surface-3 px-2 py-0.5 rounded-full">Only visible to you</span>
    </div>
  );
}

export default function MyInsightsSection({ nodeId, communityId }: MyInsightsSectionProps) {
  const {
    isAuthenticated,
    privateColumns,
    valueMap,
    savePrivateValue,
    addPrivateColumn,
    shareValueWithCommunity,
  } = useCrmColumns({ communityId, nodeIds: nodeId ? [nodeId] : [] });

  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [addingField, setAddingField] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [saving, setSaving] = useState(false);
  const [shared, setShared] = useState<Set<string>>(new Set());

  const getValue = (col: PrivateColumn) =>
    (valueMap.values[nodeId]?.[prvKey(col.id)] as string) || '';

  const handleSave = useCallback(async (columnId: string, value: string) => {
    setSaving(true);
    try {
      await savePrivateValue(nodeId, columnId, value);
    } finally {
      setSaving(false);
      setEditingField(null);
    }
  }, [nodeId, savePrivateValue]);

  const handleAddField = useCallback(async () => {
    if (!newFieldName.trim()) return;
    setSaving(true);
    try {
      await addPrivateColumn(newFieldName.trim(), 'text');
      setNewFieldName('');
      setAddingField(false);
    } finally {
      setSaving(false);
    }
  }, [newFieldName, addPrivateColumn]);

  const handleShare = useCallback(async (col: PrivateColumn) => {
    if (!communityId) return;
    const value = getValue(col);
    if (!value) return;
    try {
      await shareValueWithCommunity(nodeId, col.columnKey, col.columnName, col.columnType, value, communityId);
      setShared(prev => new Set([...prev, col.id]));
    } catch {
      // silently fail — could show toast later
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, nodeId, shareValueWithCommunity, valueMap]);

  if (!isAuthenticated) return null;

  // A faintly tinted surface + lock header signals "private" while still living
  // in the standard rounded-2xl shadow-soft floating-card system.
  const cardClass = 'bg-surface-2/50 border border-border-subtle rounded-2xl shadow-soft px-5 py-4';

  const hasAnyData = privateColumns.some(col => !!getValue(col));
  if (privateColumns.length === 0 && !hasAnyData) {
    return (
      <div className={cardClass}>
        <InsightsHeader />
        <p className="text-sm text-text-muted mb-4">Add private notes and fields about this person that only you can see.</p>
        <button
          onClick={() => setAddingField(true)}
          className="flex items-center gap-1.5 text-sm font-medium text-blue-500 hover:text-blue-600 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add a field
        </button>
        {addingField && (
          <div className="mt-3 flex items-center gap-2">
            <input
              autoFocus
              value={newFieldName}
              onChange={e => setNewFieldName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddField(); if (e.key === 'Escape') setAddingField(false); }}
              placeholder="Field name (e.g. Notes, Met at...)"
              className="flex-1 px-3 py-1.5 text-sm bg-surface-1 border border-border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400/20 focus:border-blue-400 text-text-primary"
            />
            <button onClick={handleAddField} disabled={saving || !newFieldName.trim()} className="px-3 py-1.5 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">Add</button>
            <button onClick={() => setAddingField(false)} className="p-1.5 text-text-muted hover:text-text-primary"><X className="w-4 h-4" /></button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cardClass}>
      <InsightsHeader />

      <div className="space-y-3">
        {privateColumns.map(col => {
          const value = getValue(col);
          const isEditing = editingField === col.id;

          return (
            <div key={col.id} className="group flex items-start gap-3">
              <div className="w-28 flex-shrink-0 pt-1">
                <span className="text-xs font-medium text-text-muted uppercase tracking-wide">{col.columnName}</span>
              </div>
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSave(col.id, editValue); if (e.key === 'Escape') setEditingField(null); }}
                      disabled={saving}
                      className="flex-1 px-2 py-1 text-sm bg-surface-1 border border-blue-400 rounded focus:outline-none text-text-primary"
                    />
                    <button onClick={() => handleSave(col.id, editValue)} disabled={saving} className="p-1 text-blue-500 hover:text-blue-600">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => setEditingField(null)} className="p-1 text-text-muted hover:text-text-primary">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm cursor-text rounded px-1 -mx-1 hover:bg-surface-3 transition-colors ${value ? 'text-text-primary' : 'text-text-muted italic'}`}
                      onClick={() => { setEditingField(col.id); setEditValue(value); }}
                    >
                      {value || 'Click to add'}
                    </span>
                    {value && (
                      <button
                        onClick={() => { setEditingField(col.id); setEditValue(value); }}
                        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 p-0.5 text-text-muted hover:text-text-primary transition-all"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                    {value && communityId && (
                      shared.has(col.id) ? (
                        <span className="text-xs text-emerald-500 flex items-center gap-1"><Check className="w-3 h-3" /> Shared</span>
                      ) : (
                        <button
                          onClick={() => handleShare(col)}
                          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 p-0.5 text-purple-400 hover:text-purple-600 transition-all"
                          title="Share with community"
                        >
                          <Share2 className="w-3 h-3" />
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add field */}
      <div className="mt-4 pt-3 border-t border-border-subtle">
        {addingField ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={newFieldName}
              onChange={e => setNewFieldName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddField(); if (e.key === 'Escape') setAddingField(false); }}
              placeholder="Field name"
              className="flex-1 px-3 py-1.5 text-sm bg-surface-1 border border-border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400/20 focus:border-blue-400 text-text-primary"
            />
            <button onClick={handleAddField} disabled={saving || !newFieldName.trim()} className="px-3 py-1.5 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">Add</button>
            <button onClick={() => setAddingField(false)} className="p-1.5 text-text-muted hover:text-text-primary"><X className="w-4 h-4" /></button>
          </div>
        ) : (
          <button
            onClick={() => setAddingField(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-blue-500 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add field
          </button>
        )}
      </div>
    </div>
  );
}
