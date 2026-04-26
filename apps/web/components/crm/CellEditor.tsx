'use client';

import React, { useEffect, useRef, useState } from 'react';

interface CellEditorProps {
  value: string;
  type: string;
  options?: string[] | null;
  onSave: (value: string) => Promise<void>;
  onCancel: () => void;
}

export default function CellEditor({ value: initialValue, type, options, onSave, onCancel }: CellEditorProps) {
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
        className="w-full px-2 py-1 text-sm bg-surface-1 border border-brand-green rounded focus:outline-none"
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
        className="w-full px-2 py-1 text-sm bg-surface-1 border border-brand-green rounded focus:outline-none"
      />
    );
  }

  return (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
      type={type === 'url' ? 'url' : 'text'}
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={handleSave} onKeyDown={handleKey} disabled={saving}
      className="w-full px-2 py-1 text-sm bg-surface-1 border border-brand-green rounded focus:outline-none min-w-[120px]"
    />
  );
}
