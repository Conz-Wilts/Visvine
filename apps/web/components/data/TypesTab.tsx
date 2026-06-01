'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { DEFAULT_NODE_TYPES, aliasesForType } from '@/lib/types';
import type { CommunityAlias, Community, NodeTypeConfig } from '@/lib/types';

// ─── Color helpers ────────────────────────────────────────────────────────────

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ─── Color Picker ─────────────────────────────────────────────────────────────

function ColorPicker({ color, onChange, onClose }: {
  color: string;
  onChange: (c: string) => void;
  onClose: () => void;
}) {
  const safeHex = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#6b7280';
  const [h, s, l] = hexToHsl(safeHex);

  const [hue, setHue] = useState(h);
  const [sat, setSat] = useState(s);
  const [lit, setLit] = useState(l);
  const [hexInput, setHexInput] = useState(safeHex);

  const gradientRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Sync hex input whenever sliders change
  useEffect(() => {
    const next = hslToHex(hue, sat, lit);
    setHexInput(next);
    onChange(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hue, sat, lit]);

  const pickFromGradient = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const el = gradientRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    // x = saturation 0→100, y = lightness 100→0 (top=bright, bottom=dark)
    setSat(Math.round(x * 100));
    setLit(Math.round((1 - y) * 100));
  }, []);

  return (
    <div
      className="bg-surface-1 border border-border-subtle rounded-xl p-3 shadow-xl flex flex-col gap-3 w-52"
      onClick={e => e.stopPropagation()}
    >
      {/* Saturation / lightness gradient box */}
      <div
        ref={gradientRef}
        className="w-full h-32 rounded-lg cursor-crosshair relative select-none"
        style={{
          background: `
            linear-gradient(to bottom, transparent, black),
            linear-gradient(to right, white, hsl(${hue}, 100%, 50%))
          `,
        }}
        onMouseDown={e => { dragging.current = true; pickFromGradient(e); }}
        onMouseMove={e => { if (dragging.current) pickFromGradient(e); }}
        onMouseUp={() => { dragging.current = false; }}
        onMouseLeave={() => { dragging.current = false; }}
      >
        {/* Crosshair */}
        <div
          className="absolute w-3 h-3 rounded-full border-2 border-white shadow -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{
            left: `${sat}%`,
            top: `${100 - lit}%`,
            background: hslToHex(hue, sat, lit),
          }}
        />
      </div>

      {/* Hue rainbow slider */}
      <div className="flex items-center gap-2">
        <div
          className="h-3 rounded-full flex-1"
          style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
        >
          <input
            type="range"
            min={0} max={360}
            value={hue}
            onChange={e => setHue(Number(e.target.value))}
            className="w-full h-3 opacity-0 cursor-pointer"
            style={{ marginTop: '-0.75rem' }}
          />
        </div>
        {/* Current colour preview */}
        <div className="w-6 h-6 rounded-md border border-border-default shrink-0" style={{ background: hslToHex(hue, sat, lit) }} />
      </div>

      {/* Hex input */}
      <div className="flex items-center gap-2 border-t border-border-subtle pt-2">
        <span className="text-xs text-text-muted font-mono">HEX</span>
        <input
          className="flex-1 px-2 py-1 rounded-md border border-border-default bg-surface-2 text-xs font-mono text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-green/40"
          value={hexInput}
          onChange={e => {
            setHexInput(e.target.value);
            if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
              const [nh, ns, nl] = hexToHsl(e.target.value);
              setHue(nh); setSat(ns); setLit(nl);
            }
          }}
          maxLength={7}
          spellCheck={false}
        />
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-text-muted hover:text-text-primary px-1.5 py-1 rounded hover:bg-surface-3 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}

// ─── Alias Pill ───────────────────────────────────────────────────────────────

function AliasPill({ alias, onColorChange, onRemove, disabled }: {
  alias: CommunityAlias;
  onColorChange: (c: string) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [localColor, setLocalColor] = useState(alias.color);

  const commit = (c: string) => { setLocalColor(c); setShowPicker(false); onColorChange(c); };

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
        placeholder="e.g. Founder, Advisor, Mentor…"
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

function TypeSection({ typeName, typeColor, aliases, allAliases, onAddAlias, onRemoveAlias, onUpdateAliasColor, onUpdateTypeColor, saving }: {
  typeName: string;
  typeColor: string;
  aliases: CommunityAlias[];
  allAliases: CommunityAlias[];
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

  return (
    <div className="border border-border-subtle rounded-xl">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-surface-1 rounded-xl" style={{ borderBottomLeftRadius: expanded ? 0 : undefined, borderBottomRightRadius: expanded ? 0 : undefined }}>
        {/* Expand chevron */}
        <button
          type="button"
          onClick={() => { setExpanded(p => !p); setAdding(false); setShowColorPicker(false); }}
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
          onClick={() => { setExpanded(p => !p); setAdding(false); setShowColorPicker(false); }}
          className="font-semibold text-sm text-text-primary flex-1 text-left"
        >
          {typeName}
        </button>

        {/* Alias preview */}
        <button
          type="button"
          onClick={() => { setExpanded(p => !p); setAdding(false); setShowColorPicker(false); }}
          className="flex items-center gap-1.5 shrink-0"
        >
          {aliases.length > 0 ? (
            <>
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
            </>
          ) : (
            <span className="text-xs text-text-muted">No aliases</span>
          )}
        </button>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="px-4 py-3 bg-surface-2 border-t border-border-subtle rounded-b-xl space-y-3">
          {/* Existing aliases */}
          {aliases.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {aliases.map(alias => (
                <AliasPill
                  key={`${alias.nodeType}:${alias.name}`}
                  alias={alias}
                  onColorChange={c => onUpdateAliasColor(alias.name, alias.nodeType, c)}
                  onRemove={() => onRemoveAlias(alias.name, alias.nodeType)}
                  disabled={saving}
                />
              ))}
            </div>
          )}

          {/* Add alias toggle / form */}
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-dashed border-border-default text-xs font-medium text-text-muted hover:text-text-primary hover:border-border-default hover:bg-surface-3 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              Create alias
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

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

  useEffect(() => {
    if (currentCommunity?.nodeTypes) setTypes(currentCommunity.nodeTypes);
    if (currentCommunity?.communityAliases) setAliases(currentCommunity.communityAliases as CommunityAlias[]);
  }, [currentCommunity]);

  const saveCommunity = async (nextTypes: NodeTypeConfig[], nextAliases: CommunityAlias[]) => {
    if (!currentCommunity) return;
    setSaving(true);
    setError(null);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error saving');
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
    return <div className="p-6 text-sm text-text-muted">Select a community to manage aliases.</div>;
  }

  return (
    <div className="p-6 max-w-2xl space-y-4">
      <div>
        <h3 className="text-base font-semibold text-text-primary">Types & Aliases</h3>
        <p className="text-sm text-text-muted mt-0.5">
          Click a type to expand it and add community-specific aliases with custom colours.
        </p>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="space-y-2">
        {DEFAULT_NODE_TYPES.map(defaultType => {
          const liveType = types.find(t => t.name === defaultType.name) ?? defaultType;
          return (
            <TypeSection
              key={liveType.name}
              typeName={liveType.name}
              typeColor={liveType.color}
              aliases={aliasesForType(aliases, liveType.name)}
              allAliases={aliases}
              onAddAlias={handleAddAlias}
              onRemoveAlias={handleRemoveAlias}
              onUpdateAliasColor={handleUpdateAliasColor}
              onUpdateTypeColor={color => handleUpdateTypeColor(liveType.name, color)}
              saving={saving}
            />
          );
        })}
      </div>

      <p className="text-xs text-text-muted pt-1">
        Aliases appear in place of the base type label on node cards and graph tooltips.
      </p>
    </div>
  );
}
