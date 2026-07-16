'use client';

import { inputBaseClass } from '@/components/ui';
import type { BoardMember } from '../lib/types';

interface AssigneePickerProps {
  members: BoardMember[];
  value: string | null;
  onChange: (userId: string | null) => void;
}

/**
 * Assignee select over the board's active-member list. A previously-assigned
 * user missing from the list (left the community / deleted) still shows as a
 * selectable "Unknown member" entry so opening the modal doesn't silently
 * clear them.
 */
export default function AssigneePicker({ members, value, onChange }: AssigneePickerProps) {
  const known = value ? members.some((m) => m.userId === value) : true;
  return (
    <select
      className={inputBaseClass}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">Unassigned</option>
      {!known && value && <option value={value}>Unknown member</option>}
      {members.map((m) => (
        <option key={m.userId} value={m.userId}>
          {m.name}
        </option>
      ))}
    </select>
  );
}
