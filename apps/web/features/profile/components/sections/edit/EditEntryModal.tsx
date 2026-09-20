'use client';

/**
 * One row of a section. The fields asked for are the ones the section's kind
 * draws (`fieldsFor`), so a link is not asked for its years — plus the space a
 * row may point at, which every kind may carry.
 */

import React, { useEffect, useState } from 'react';
import EditModal from '../../edit/EditModal';
import ModalFooter from '../../edit/ModalFooter';
import SpaceField from '../SpaceField';
import { fieldsFor, type EntryField } from '@/lib/profile/shared/sections';
import type { ProfileSectionEntryView } from '@/lib/profile/sections';

interface Props {
  open: boolean;
  kind: string;
  sectionTitle: string;
  /** Null adds a row; one edits it. */
  entry: ProfileSectionEntryView | null;
  onClose: () => void;
  onSave: (values: Record<string, string | null> & { id?: string }) => Promise<void>;
}

const FIELD = 'w-full px-3 py-2 border border-border-subtle rounded-xl text-sm bg-surface-1 text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30';

const LABELS: Record<EntryField, string> = {
  title: 'Title',
  subtitle: 'With',
  description: 'Notes',
  url: 'Link',
  startYear: 'From',
  endYear: 'To',
};

const PLACEHOLDERS: Partial<Record<EntryField, string>> = {
  startYear: '2021',
  endYear: '2024',
  url: 'https://',
};

type Values = Record<string, string>;

export default function EditEntryModal({ open, kind, sectionTitle, entry, onClose, onSave }: Props) {
  const fields = fieldsFor(kind);
  const [values, setValues] = useState<Values>({});
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const next: Values = {};
    for (const field of fields) next[field] = (entry?.[field] as string | null) ?? '';
    setValues(next);
    setSpaceId(entry?.space?.id ?? null);
  }, [open, entry, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const patch: Record<string, string | null> = { spaceId };
      for (const field of fields) patch[field] = values[field]?.trim() || null;
      await onSave({ ...(entry ? { id: entry.id } : {}), ...patch });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const set = (field: string, value: string) => setValues((prev) => ({ ...prev, [field]: value }));
  const years: EntryField[] = fields.filter((f) => f === 'startYear' || f === 'endYear');
  const plain: EntryField[] = fields.filter((f) => !years.includes(f));

  return (
    <EditModal title={entry ? `Edit ${sectionTitle.toLowerCase()}` : `Add to ${sectionTitle.toLowerCase()}`}
               open={open} onClose={onClose} size="sm">
      <form onSubmit={submit} className="p-6 space-y-4">
        {plain.map((field) => (
          <div key={field}>
            <label className="block text-xs font-medium text-brand-grey mb-1">{LABELS[field]}</label>
            {field === 'description' ? (
              <textarea value={values[field] ?? ''} onChange={(e) => set(field, e.target.value)}
                        rows={3} maxLength={2000} className={`${FIELD} resize-y`} />
            ) : (
              <input value={values[field] ?? ''} onChange={(e) => set(field, e.target.value)}
                     maxLength={field === 'url' ? 2000 : 200} placeholder={PLACEHOLDERS[field]}
                     className={FIELD} autoFocus={field === fields[0]} />
            )}
          </div>
        ))}

        {years.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {years.map((field) => (
              <div key={field}>
                <label className="block text-xs font-medium text-brand-grey mb-1">{LABELS[field]}</label>
                <input value={values[field] ?? ''} onChange={(e) => set(field, e.target.value)}
                       inputMode="numeric" pattern="\d{4}" placeholder={PLACEHOLDERS[field]} className={FIELD} />
              </div>
            ))}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-brand-grey mb-1">Space</label>
          <SpaceField value={spaceId} onChange={(id, name) => {
            setSpaceId(id);
            // A picked space names the row when it has no name of its own.
            if (id && !values.title?.trim() && fields.includes('title')) set('title', name);
          }} />
        </div>

        <ModalFooter onCancel={onClose} saving={saving} />
      </form>
    </EditModal>
  );
}
