'use client';

// The form a type grows (or renames) a tracked field through. It lives in
// whichever menu opened it — the Columns menu, the header's "+", a column's
// own menu — so it owns nothing but its draft; the save is the caller's.
//
// Editing reuses the same form with the field's current values; the kind is
// fixed then, because a stored value only means what it meant when typed.

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input } from '@/components/ui';
import Select from '@/components/ui/Select';
import { TRACKED_FIELD_KINDS } from '@/lib/directory/table';
import type { TrackedFieldKind } from '@/lib/types';

/** The admin's field operations, bound to the current type by the view. */
export interface FieldOps {
  saving: boolean;
  error: string | null;
  clearError: () => void;
  add: (input: { label: string; kind: TrackedFieldKind; options?: string[] }) => Promise<boolean>;
  update: (key: string, patch: { label?: string; options?: string[] }) => Promise<boolean>;
  remove: (key: string) => Promise<boolean>;
}

export default function AddFieldForm({
  typeName,
  saving,
  error,
  initial,
  onSubmit,
  onCancel,
}: {
  typeName: string;
  saving: boolean;
  error: string | null;
  /** Present when editing an existing field: its values, and a fixed kind. */
  initial?: { label: string; kind: TrackedFieldKind; options?: string[] };
  onSubmit: (input: { label: string; kind: TrackedFieldKind; options?: string[] }) => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [kind, setKind] = useState<TrackedFieldKind>(initial?.kind ?? 'text');
  const [options, setOptions] = useState(initial?.options?.join(', ') ?? '');
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    labelRef.current?.focus();
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void onSubmit({
      label,
      kind,
      ...(kind === 'select' ? { options: options.split(/[,\n]/) } : {}),
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 py-1">
      <p className="text-[12px] text-fg-muted">
        {initial
          ? 'A new name shows everywhere the field does; values keep their key.'
          : `A new column for every ${typeName}, kept on each record and in its note.`}
      </p>
      <Input
        ref={labelRef}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Field name, e.g. Deal stage"
        maxLength={40}
        className="h-9 px-3 py-0 text-sm"
        aria-label="Field name"
      />
      {initial ? null : (
        <Select value={kind} onChange={(e) => setKind(e.target.value as TrackedFieldKind)} aria-label="Field kind">
          {TRACKED_FIELD_KINDS.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </Select>
      )}
      {kind === 'select' && (
        <Input
          value={options}
          onChange={(e) => setOptions(e.target.value)}
          placeholder="Options, comma separated"
          className="h-9 px-3 py-0 text-sm"
          aria-label="Options"
        />
      )}
      {error && <Alert variant="error" inline>{error}</Alert>}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="submit" variant="brand" loading={saving} disabled={!label.trim()}>
          {initial ? 'Save' : 'Add'}
        </Button>
      </div>
    </form>
  );
}
