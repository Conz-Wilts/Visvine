'use client';

import React, { useEffect, useRef, useState } from 'react';

interface CellEditorProps {
  value: string;
  type: string;
  options?: string[] | null;
  onSave: (value: string) => Promise<void>;
  onCancel: () => void;
  // Override the input styling (e.g. profile cells use a borderless underline
  // instead of the boxed CRM look). Defaults preserve the original appearance.
  className?: string;
  placeholder?: string;
}

const DEFAULT_INPUT_CLASS =
  'px-2 py-1 text-sm bg-surface-1 border border-brand-green rounded focus:outline-none';

// Let the editor grow with its content and float above the neighbouring cells
// instead of being clipped to the (fixed-layout) column width. `field-sizing`
// auto-grows in supporting browsers; `relative z-30` + a shadow lift it over the
// adjacent cells and the hover overlay (z-10) so the full text stays readable.
const OVERFLOW_CLASS = 'relative z-30 shadow-soft';
const OVERFLOW_STYLE = { fieldSizing: 'content', minWidth: '100%', maxWidth: '420px' } as React.CSSProperties;

export default function CellEditor({ value: initialValue, type, options, onSave, onCancel, className, placeholder }: CellEditorProps) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  const handleSave = async () => {
    if (value === initialValue) { onCancel(); return; }
    setSaving(true);
    try { await onSave(value); }
    catch { /* parent handles error */ }
    finally { setSaving(false); }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && type !== 'tags') { e.preventDefault(); handleSave(); }
    if (e.key === 'Escape') onCancel();
  };

  if (type === 'select' && options?.length) {
    return (
      <select
        ref={ref as React.RefObject<HTMLSelectElement>}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={handleSave}
        disabled={saving}
        className={`${className ?? DEFAULT_INPUT_CLASS} ${OVERFLOW_CLASS}`}
        style={OVERFLOW_STYLE}
      >
        <option value="">—</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  if (type === 'date') {
    return (
      <input
        ref={ref as React.RefObject<HTMLInputElement>}
        type="date" value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={handleSave} onKeyDown={handleKey} disabled={saving}
        className={`${className ?? DEFAULT_INPUT_CLASS} ${OVERFLOW_CLASS}`}
        style={OVERFLOW_STYLE}
      />
    );
  }

  return (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
      type={type === 'url' ? 'url' : 'text'}
      value={value}
      placeholder={placeholder}
      // Cross-browser auto-grow fallback for engines without `field-sizing`.
      size={Math.min(Math.max(value.length + 2, 14), 60)}
      onChange={e => setValue(e.target.value)}
      onBlur={handleSave} onKeyDown={handleKey} disabled={saving}
      className={`${className ?? DEFAULT_INPUT_CLASS} ${OVERFLOW_CLASS}`}
      style={OVERFLOW_STYLE}
    />
  );
}
