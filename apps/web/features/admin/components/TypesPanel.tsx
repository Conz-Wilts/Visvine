'use client';

// Console → Types: every kind of thing this space records, and the aliases each
// kind can wear.
//
// Person is the one type whose aliases mean something beyond a label — they are
// the permission model (holders, ownership, context grants) — so they are handed
// out and pointed at content on Members, not here. This page still shows them,
// read-only, because a Person type you can't see the shape of isn't much of a
// description; it just doesn't edit them, so no name is ever edited twice.

import { useState, useEffect } from 'react';
import { useCommunity } from '@/features/shared/contexts/CommunityContext';
import { DEFAULT_NODE_TYPES, aliasesForType } from '@/lib/types';
import type { CommunityAlias, Community, NodeTypeConfig } from '@/lib/types';
import { isNodeTypeEnabled } from '@/lib/featureAccess';
import { Alert, Chip, ColorPicker, chipClass } from '@/components/ui';
import { useConsoleSave } from '@/features/admin/components/console/ConsoleSaveContext';
import { usePeopleSection } from '@/features/admin/components/people/PeopleDataContext';

// The type whose aliases are the permission model. Everything else's aliases are
// plain directory labels, stored on the community and edited in place.
const PERMISSION_TYPE = 'person';

// ─── Alias Chip ───────────────────────────────────────────────────────────────
// The same rounded square the alias wears on a directory card, a note header and
// a member row — this is where you pick its colour, so it has to be the shape
// you'll meet it in (components/ui/Chip.tsx).

function AliasChip({ alias, onColorChange, onRemove, disabled }: {
  alias: CommunityAlias;
  onColorChange: (c: string) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [localColor, setLocalColor] = useState(alias.color);

  const commit = (c: string) => { setLocalColor(c); setShowPicker(false); onColorChange(c); };

  return (
    <div className="relative inline-flex items-center gap-1">
      <Chip
        size="lg"
        color={localColor}
        disabled={disabled}
        title="Click to change colour"
        onClick={() => setShowPicker(p => !p)}
        onRemove={onRemove}
        removeLabel={`Remove "${alias.name}"`}
      >
        {alias.name}
      </Chip>
      {showPicker && (
        <div className="absolute left-0 top-9 z-40">
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

// ─── Person aliases: read-only ────────────────────────────────────────────────

/**
 * What a Person can be, without being the place you change it. The chips are the
 * live permission snapshot rather than the community record, so they include the
 * built-in Owner and stay honest the moment an alias is renamed on Members. The
 * hover title carries the holder count; the row itself is just the vocabulary.
 */
function PersonAliases() {
  const { data } = usePeopleSection();

  if (data === null) return <p className="py-2 text-xs text-text-muted">Loading…</p>;

  const aliases = [...data.aliases].sort(
    (a, b) =>
      Number(b.system) - Number(a.system) ||
      Number(b.owner) - Number(a.owner) ||
      a.name.localeCompare(b.name),
  );

  return (
    <div className="flex flex-wrap gap-2">
      {aliases.map((alias) => (
        <Chip
          key={alias.name}
          size="lg"
          color={alias.color}
          title={`${alias.name} — ${alias.holders.length} ${alias.holders.length === 1 ? 'person' : 'people'}${alias.owner ? ', owns the space' : ''}`}
        >
          {alias.name}
        </Chip>
      ))}
    </div>
  );
}

// ─── Type Section ─────────────────────────────────────────────────────────────

function TypeSection({ typeName, typeColor, aliases, allAliases, isPerson, previewChips, onAddAlias, onRemoveAlias, onUpdateAliasColor, onUpdateTypeColor, saving }: {
  typeName: string;
  typeColor: string;
  aliases: CommunityAlias[];
  allAliases: CommunityAlias[];
  /** Person's aliases are the permission model, so it renders its own list. */
  isPerson?: boolean;
  previewChips: { name: string; color: string }[];
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
      {/* Header. This list IS the page, so the rows are sized like a heading
          each rather than like a settings line — a type is the biggest idea in
          the space, and the chips have to be readable at a glance. */}
      <div className="flex items-center gap-3.5 py-4">
        {/* Expand chevron */}
        <button
          type="button"
          onClick={toggleExpanded}
          className="w-6 h-6 flex items-center justify-center shrink-0 text-text-muted hover:text-text-primary transition-colors"
        >
          <svg
            className="w-4 h-4 transition-transform duration-200"
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
            className="w-5 h-5 rounded shadow-sm transition-transform hover:scale-110"
            style={{ background: typeColor }}
            title="Change type colour"
          />
          {showColorPicker && (
            <div className="absolute left-0 top-7 z-50" onClick={e => e.stopPropagation()}>
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
          className="font-semibold text-base text-text-primary flex-1 text-left"
        >
          {typeName}
        </button>

        {/* Alias preview */}
        {previewChips.length > 0 && (
          <button
            type="button"
            onClick={toggleExpanded}
            className="flex items-center gap-1.5 shrink-0"
          >
            {previewChips.slice(0, 3).map(a => (
              <Chip key={a.name} size="sm" color={a.color}>{a.name}</Chip>
            ))}
            {previewChips.length > 3 && (
              <span className="text-xs text-text-muted">+{previewChips.length - 3}</span>
            )}
          </button>
        )}
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="space-y-3 pb-5 pl-[3.25rem]">
          {isPerson ? (
            <PersonAliases />
          ) : (
            <>
              {aliases.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {aliases.map(alias => (
                    <AliasChip
                      key={`${alias.nodeType}:${alias.name}`}
                      alias={alias}
                      onColorChange={c => onUpdateAliasColor(alias.name, alias.nodeType, c)}
                      onRemove={() => onRemoveAlias(alias.name, alias.nodeType)}
                      disabled={saving}
                    />
                  ))}
                </div>
              )}

              {adding ? (
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
                  className={chipClass({ tone: 'dashed', size: 'lg', className: 'gap-1.5 hover:bg-surface-3 hover:text-text-primary' })}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                  </svg>
                  Add alias
                </button>
              )}
            </>
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

export default function TypesPanel() {
  const { currentCommunity, refreshCommunity } = useCommunity();
  const { data, error: accessError, setError: setAccessError } = usePeopleSection();

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

  // Types and non-Person aliases ride on the community record. Person aliases do
  // NOT go through here: a rename has to carry UserAlias, BrainGrant and Node
  // rows with it, which only /api/aliases does (lib/notes/aliases.ts).
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
    return <div className="p-6 text-sm text-text-muted">Select a space to manage types.</div>;
  }

  return (
    <div className="space-y-4">
      {error && <Alert variant="error" onDismiss={() => setError(null)}>{error}</Alert>}
      {accessError && <Alert variant="error" onDismiss={() => setAccessError(null)}>{accessError}</Alert>}

      {/* The tab bar above already says "Types", so the list starts straight
          away. A type whose tool is switched off isn't offered at all — no point
          curating aliases for something the community can't create. */}
      <div className="divide-y divide-border-subtle">
        {DEFAULT_NODE_TYPES
          .filter(t => isNodeTypeEnabled(currentCommunity.featureConfig ?? null, t.name))
          .map(defaultType => {
          const liveType = types.find(t => t.name === defaultType.name) ?? defaultType;
          const isPerson = liveType.name.toLowerCase() === PERMISSION_TYPE;
          const typeAliases = aliasesForType(aliases, liveType.name);
          return (
            <TypeSection
              key={liveType.name}
              typeName={liveType.name}
              typeColor={liveType.color}
              aliases={typeAliases}
              allAliases={aliases}
              isPerson={isPerson}
              // Person's preview comes from the live permission snapshot, which
              // already grafts in the built-in Owner; every other type's from
              // the community record it saves to.
              previewChips={isPerson ? (data?.aliases ?? []) : typeAliases}
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
