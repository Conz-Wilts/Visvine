'use client';

// The profile's "Details" rows — the same per-type fields the note-first create
// surface asks for, rendered read-only here.
//
// This used to be a `switch (node.type)` over 'People' | 'Startup' |
// 'Organization' | 'Event', which could never match: both POST and PUT on
// /api/data/nodes store `type.toLowerCase()`, so every case was unreachable and
// this section rendered nothing for every node in the database. It also read
// `meta.startAt` where lib/eventRepo.ts writes `meta.start_at`.
//
// Driving it off lib/create/typeFields.ts fixes both, and means a field added to
// the create surface shows up here without a second edit.

import React from 'react';
import type { NBNode } from '@/lib/types';
import { fieldsForType, readFields, type TypeFieldDef } from '@/lib/create/typeFields';

interface Props {
  node: NBNode;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs font-medium text-brand-grey uppercase tracking-wide whitespace-nowrap">{label}</span>
      <span className="text-sm text-brand-black text-right">{value}</span>
    </div>
  );
}

function formatValue(field: TypeFieldDef, value: string): string {
  if (field.kind === 'date') {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
  }
  return value;
}

export default function NodeTypeDetailsSection({ node }: Props) {
  const values = readFields(node);
  // The image row is the profile hero's job, not a details line.
  const rows = fieldsForType(node.type).filter((f) => f.kind !== 'image' && values[f.key]);
  if (rows.length === 0) return null;

  return (
    <div>
      {rows.map((field) => (
        <DetailRow key={field.key} label={field.label} value={formatValue(field, values[field.key])} />
      ))}
    </div>
  );
}
