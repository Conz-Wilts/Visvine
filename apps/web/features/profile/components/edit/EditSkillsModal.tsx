'use client';

import React, { useState, useEffect, useRef } from 'react';
import EditModal from './EditModal';
import ModalFooter from './ModalFooter';
import { X } from 'lucide-react';
import type { FullProfile } from '@/lib/types/profile';

interface Props {
  open: boolean;
  onClose: () => void;
  tags: string[];
  onSave: (patch: Partial<FullProfile>) => Promise<void>;
}

export default function EditSkillsModal({ open, onClose, tags, onSave }: Props) {
  const [items, setItems] = useState<string[]>(tags);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setItems(tags); setInput(''); } }, [open, tags]);

  const addTag = () => {
    const v = input.trim();
    if (v && !items.includes(v)) setItems((prev) => [...prev, v]);
    setInput('');
    inputRef.current?.focus();
  };

  const removeTag = (tag: string) => setItems((prev) => prev.filter((t) => t !== tag));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); addTag(); }
    if (e.key === 'Backspace' && !input && items.length) setItems((prev) => prev.slice(0, -1));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) addTag();
    setSaving(true);
    try {
      await onSave({ tags: items });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditModal title="Edit skills" open={open} onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <p className="text-xs text-brand-grey">Type a skill and press Enter to add it.</p>
        <div className="min-h-[80px] flex flex-wrap gap-2 p-3 border border-gray-200 rounded-xl focus-within:ring-2 focus-within:ring-brand-dark-green/30">
          {items.map((tag) => (
            <span key={tag} className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-brand-dark-green bg-brand-light-bg rounded-full">
              {tag}
              <button type="button" onClick={() => removeTag(tag)} className="text-brand-grey hover:text-red-500 transition-colors">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => { if (input.trim()) addTag(); }}
            placeholder={items.length === 0 ? 'e.g. TypeScript, Product Strategy…' : ''}
            className="flex-1 min-w-[140px] text-sm outline-none bg-transparent"
          />
        </div>
        <ModalFooter onCancel={onClose} saving={saving} />
      </form>
    </EditModal>
  );
}
