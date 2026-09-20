'use client';

/** Naming a section and choosing what it holds. A text section is written here. */

import React, { useEffect, useState } from 'react';
import EditModal from '../../edit/EditModal';
import ModalFooter from '../../edit/ModalFooter';
import { MAX_TITLE, SECTION_KINDS, hasBody, type SectionKind } from '@/lib/profile/shared/sections';
import type { ProfileSectionView } from '@/lib/profile/sections';

interface Props {
  open: boolean;
  /** Null adds a section; one edits it. */
  section: ProfileSectionView | null;
  onClose: () => void;
  onSave: (patch: { id?: string; title: string; kind: SectionKind; body?: string | null }) => Promise<void>;
  onDelete?: () => Promise<void>;
}

const FIELD = 'w-full px-3 py-2 border border-border-subtle rounded-xl text-sm bg-surface-1 text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30';

export default function EditSectionModal({ open, section, onClose, onSave, onDelete }: Props) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<SectionKind>('list');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(section?.title ?? '');
    setKind((section?.kind as SectionKind) ?? 'list');
    setBody(section?.body ?? '');
  }, [open, section]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave({
        ...(section ? { id: section.id } : {}),
        title: title.trim(),
        kind,
        ...(hasBody(kind) ? { body: body.trim() || null } : {}),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditModal title={section ? 'Edit section' : 'Add section'} open={open} onClose={onClose} size="sm">
      <form onSubmit={submit} className="p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-brand-grey mb-1">Name</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={MAX_TITLE}
                 placeholder="Education" className={FIELD} autoFocus />
        </div>

        <div>
          <label className="block text-xs font-medium text-brand-grey mb-1">Holds</label>
          <div className="flex flex-wrap gap-2">
            {SECTION_KINDS.map((row) => (
              <button key={row.kind} type="button" onClick={() => setKind(row.kind)}
                      aria-pressed={kind === row.kind}
                      className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                        kind === row.kind
                          ? 'bg-brand-green text-white'
                          : 'bg-surface-2 text-text-secondary hover:bg-surface-3'
                      }`}>
                {row.label}
              </button>
            ))}
          </div>
        </div>

        {hasBody(kind) && (
          <div>
            <label className="block text-xs font-medium text-brand-grey mb-1">Text</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} maxLength={20000}
                      className={`${FIELD} resize-y`} />
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2">
          {onDelete ? (
            <button type="button" onClick={() => void onDelete().then(onClose)}
                    className="text-xs text-red-600 hover:text-red-800">
              Delete
            </button>
          ) : <span />}
          <ModalFooter onCancel={onClose} saving={saving} />
        </div>
      </form>
    </EditModal>
  );
}
