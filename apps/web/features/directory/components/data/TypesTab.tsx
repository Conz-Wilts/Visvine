'use client';

import { useState, useEffect } from 'react';
import { useCommunity } from '@/features/shared/contexts/CommunityContext';
import { DEFAULT_NODE_TYPES, aliasesForType, personAliases } from '@/lib/types';
import type { CommunityAlias, Community, NodeTypeConfig } from '@/lib/types';
import { isNodeTypeEnabled } from '@/lib/featureAccess';
import { Alert, ColorPicker } from '@/components/ui';
import { useConsoleSave } from '@/features/admin/components/console/ConsoleSaveContext';

// The Person type is the one exception on this page: its aliases are the
// permission model (holders, ownership, context grants), so they are created and
// edited on Console → Aliases and only shown here, read-only, so the vocabulary
// still reads as one list. Every other type's aliases are plain directory labels
// and are edited in place.
const PERMISSION_TYPE = 'person';

// ─── Alias Pill ───────────────────────────────────────────────────────────────

function AliasPill({ alias, readOnly, onColorChange, onRemove, disabled }: {
  alias: CommunityAlias;
  /** Person aliases are shown but not edited here — see PERMISSION_TYPE. */
  readOnly?: boolean;
  onColorChange: (c: string) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [localColor, setLocalColor] = useState(alias.color);

  const commit = (c: string) => { setLocalColor(c); setShowPicker(false); onColorChange(c); };

  // The built-in Owner alias is fixed the way the system link types are: it
  // decides who manages the community (lib/auth.ts#isAdmin), so it keeps its
  // gold and cannot be recoloured or removed here.
  if (alias.system || readOnly) {
    return (
      <span
        title={
          alias.system
            ? 'Built in — holders own the space. Give it out in Console → Aliases.'
            : `${alias.name} — edit it in Console → Aliases`
        }
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-white"
        style={{ background: alias.color }}
      >
        {alias.name}
      </span>
    );
  }

  return (
    <div className="relative inline-flex items-center gap-1 group">
      <button
        type="button"
        onClick={() => setShowPicker(p => !p)}
        title="Click to change colour"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-white hover:opacity-80 transition-opacity"
        style={{ background: localColor }}
      >
        {alias.name}
      </button>
      <button
        onClick={onRemove}
        disabled={disabled}
        className="w-4 h-4 rounded-full flex items-center justify-center text-text-muted opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all -ml-0.5"
        title={`Remove "${alias.name}"`}
      >
        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      {showPicker && (
        <div className="absolute left-0 top-8 z-40">
          <ColorPicker color={localColor} onChange={c => setLocalColor(c)} onClose={() => commit(localColor)} />
        </div>
      )}
    </div>
  );
}

// ─── Add Alias Row ────────────────────────────────────────────────────────────

function AddAliasRow({ nodeType, defaultColor, existing, onAdd, onCancel, disabled }: {
  nodeType: string;
  defaultColor: string;
  existing: CommunityAlias[];
  onAdd: (a: CommunityAlias) => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(defaultColor);
  const [showPicker, setShowPicker] = useState(false);

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (existing.some(a => a.name.toLowerCase() === trimmed.toLowerCase() && a.nodeType === nodeType)) return;
    onAdd({ name: trimmed, color, nodeType });
    setName('');
    setColor(defaultColor);
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowPicker(p => !p)}
          className="w-7 h-7 rounded-lg border-2 border-border-default shrink-0 transition-transform hover:scale-110"
          style={{ background: color }}
          title="Pick colour"
        />
        {showPicker && (
          <ColorPicker color={color} onChange={setColor} onClose={() => setShowPicker(false)} />
        )}
      </div>
      <input
        autoFocus
        className="flex-1 px-3 py-1.5 rounded-lg border border-border-default bg-surface-1 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-green/40 focus:border-brand-green transition-all"
        placeholder="Alias name"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setShowPicker(false); onCancel(); } }}
        maxLength={40}
      />
      <button
        onClick={handleAdd}
        disabled={!name.trim() || disabled}
        className="px-3 py-1.5 rounded-lg bg-brand-green text-white text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0"
      >
        Add
      </button>
      <button
        onClick={onCancel}
        className="px-2 py-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-3 text-sm transition-colors shrink-0"
      >
        Cancel
      </button>
    </div>
  );
}

// ─── Type Section ─────────────────────────────────────────────────────────────

function TypeSection({ typeName, typeColor, aliases, allAliases, aliasesReadOnly, onAddAlias, onRemoveAlias, onUpdateAliasColor, onUpdateTypeColor, saving }: {
  typeName: string;
  typeColor: string;
  aliases: CommunityAlias[];
  allAliases: CommunityAlias[];
  /** True for Person: its aliases are the permission model, edited on Aliases. */
  aliasesReadOnly?: boolean;
  onAddAlias: (a: CommunityAlias) => void;
  onRemoveAlias: (name: string, nodeType: string) => void;
  onUpdateAliasColor: (name: string, nodeType: string, color: string) => void;
  onUpdateTypeColor: (color: string) => void;
  saving: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);

  const handleAdd = (alias: CommunityAlias) => {
    onAddAlias(alias);
    setAdding(false);
  };

  const toggleExpanded = () => {
    setExpanded(p => !p);
    setAdding(false);
    setShowColorPicker(false);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 py-3">
        {/* Expand chevron */}
        <button
          type="button"
          onClick={toggleExpanded}
          className="w-5 h-5 flex items-center justify-center shrink-0 text-text-muted hover:text-text-primary transition-colors"
        >
          <svg
            className="w-3.5 h-3.5 transition-transform duration-200"
            style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Clickable color square — picker opens from here */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setShowColorPicker(p => !p); }}
            className="w-4 h-4 rounded-sm shadow-sm transition-transform hover:scale-110"
            style={{ background: typeColor }}
            title="Change type colour"
          />
          {showColorPicker && (
            <div className="absolute left-0 top-6 z-50" onClick={e => e.stopPropagation()}>
              <ColorPicker
                color={typeColor}
                onChange={onUpdateTypeColor}
                onClose={() => setShowColorPicker(false)}
              />
            </div>
          )}
        </div>

        {/* Name — clicking expands */}
        <button
          type="button"
          onClick={toggleExpanded}
          className="font-semibold text-sm text-text-primary flex-1 text-left"
        >
          {typeName}
        </button>

        {/* Alias preview */}
        {aliases.length > 0 && (
          <button
            type="button"
            onClick={toggleExpanded}
            className="flex items-center gap-1.5 shrink-0"
          >
            {aliases.slice(0, 3).map(a => (
              <span
                key={a.name}
                className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-white"
                style={{ background: a.color }}
              >
                {a.name}
              </span>
            ))}
            {aliases.length > 3 && (
              <span className="text-xs text-text-muted">+{aliases.length - 3}</span>
            )}
          </button>
        )}
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="space-y-3 pb-4 pl-8">
          {/* Existing aliases */}
          {aliases.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {aliases.map(alias => (
                <AliasPill
                  key={`${alias.nodeType}:${alias.name}`}
                  alias={alias}
                  readOnly={aliasesReadOnly}
                  onColorChange={c => onUpdateAliasColor(alias.name, alias.nodeType, c)}
                  onRemove={() => onRemoveAlias(alias.name, alias.nodeType)}
                  disabled={saving}
                />
              ))}
            </div>
          )}

          {/* Add alias toggle / form — Person's list is owned by Console → Aliases */}
          {aliasesReadOnly ? (
            <p className="text-xs text-text-muted">
              These decide what a person can do here, so they live in{' '}
              <span className="font-medium text-text-secondary">Console → Aliases</span>, alongside
              who holds each one and what it reaches.
            </p>
          ) : adding ? (
            <AddAliasRow
              nodeType={typeName}
              defaultColor={typeColor}
              existing={allAliases}
              onAdd={handleAdd}
              onCancel={() => setAdding(false)}
              disabled={saving}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-dashed border-border-default text-xs font-medium text-text-muted hover:text-text-primary hover:border-border-default hover:bg-surface-3 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              Add alias
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
// (The former "Link types" editor card was removed: links are derived from
// context-note mentions now, so relationship vocabulary isn't admin-curated —
// rendering falls back to DEFAULT_LINK_TYPES / getLinkTypeConfig.)

export default function TypesTab({ communityId: _ }: { communityId: string }) {
  const { currentCommunity, refreshCommunity } = useCommunity();

  const [types, setTypes] = useState<NodeTypeConfig[]>(
    currentCommunity?.nodeTypes ?? DEFAULT_NODE_TYPES
  );
  const [aliases, setAliases] = useState<CommunityAlias[]>(
    (currentCommunity?.communityAliases as CommunityAlias[]) ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { report } = useConsoleSave();

  useEffect(() => {
    if (currentCommunity?.nodeTypes) setTypes(currentCommunity.nodeTypes);
    if (currentCommunity?.communityAliases) setAliases(currentCommunity.communityAliases as CommunityAlias[]);
  }, [currentCommunity]);

  const saveCommunity = async (nextTypes: NodeTypeConfig[], nextAliases: CommunityAlias[]) => {
    if (!currentCommunity) return;
    setSaving(true);
    setError(null);
    report('saving');
    try {
      const res = await fetch('/api/data/communities', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          community: { ...currentCommunity, nodeTypes: nextTypes, communityAliases: nextAliases } satisfies Community,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save');
      await refreshCommunity();
      report('saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error saving');
      report('error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddAlias = (alias: CommunityAlias) => saveCommunity(types, [...aliases, alias]);
  const handleRemoveAlias = (name: string, nodeType: string) =>
    saveCommunity(types, aliases.filter(a => !(a.name === name && a.nodeType === nodeType)));
  const handleUpdateAliasColor = (name: string, nodeType: string, color: string) =>
    saveCommunity(types, aliases.map(a => a.name === name && a.nodeType === nodeType ? { ...a, color } : a));
  const handleUpdateTypeColor = (typeName: string, color: string) =>
    saveCommunity(types.map(t => t.name === typeName ? { ...t, color } : t), aliases);

  if (!currentCommunity) {
    return <div className="p-6 text-sm text-text-muted">Select a space to manage aliases.</div>;
  }

  return (
    <div className="space-y-4">
      {error && <Alert variant="error" onDismiss={() => setError(null)}>{error}</Alert>}

      {/* The tab bar above already says "Types", so the list starts straight
          away. A type whose tool is switched off isn't offered at all — no point
          curating aliases for something the community can't create. */}
      <div className="divide-y divide-border-subtle">
        {DEFAULT_NODE_TYPES
          .filter(t => isNodeTypeEnabled(currentCommunity.featureConfig ?? null, t.name))
          .map(defaultType => {
          const liveType = types.find(t => t.name === defaultType.name) ?? defaultType;
          const isPerson = liveType.name.toLowerCase() === PERMISSION_TYPE;
          return (
            <TypeSection
              key={liveType.name}
              typeName={liveType.name}
              typeColor={liveType.color}
              aliases={isPerson ? personAliases(aliases) : aliasesForType(aliases, liveType.name)}
              allAliases={aliases}
              aliasesReadOnly={isPerson}
              onAddAlias={handleAddAlias}
              onRemoveAlias={handleRemoveAlias}
              onUpdateAliasColor={handleUpdateAliasColor}
              onUpdateTypeColor={color => handleUpdateTypeColor(liveType.name, color)}
              saving={saving}
            />
          );
        })}
      </div>
    </div>
  );
}
