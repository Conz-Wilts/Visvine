'use client';

/**
 * Picking the space a row points at. The list is the spaces you are in, so a
 * profile can only ever name one you actually belong to — the same rule the
 * route keeps. Picking one fills the row's title when it is still empty.
 */

import { useMemo, useState } from 'react';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { SearchIcon, XIcon } from '@/features/shared/icons';

interface Props {
  value: string | null;
  onChange: (spaceId: string | null, name: string) => void;
}

export default function SpaceField({ value, onChange }: Props) {
  const { joinedSpaces } = useSpace();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const picked = useMemo(() => joinedSpaces.find((s) => s.id === value) ?? null, [joinedSpaces, value]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q ? joinedSpaces.filter((s) => s.name.toLowerCase().includes(q)) : joinedSpaces;
    return rows.slice(0, 8);
  }, [joinedSpaces, query]);

  if (picked) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line-subtle px-3 py-2">
        <SpaceAvatar name={picked.name} imageUrl={picked.imageUrl} size="sm" />
        <span className="min-w-0 flex-1 truncate text-sm text-fg">{picked.name}</span>
        <button type="button" onClick={() => onChange(null, '')} aria-label="Remove space"
                className="p-1 rounded-lg text-fg-muted hover:bg-surface-subtle hover:text-fg">
          <XIcon className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-line-subtle px-3 py-2">
        <SearchIcon className="w-4 h-4 flex-none text-fg-muted" />
        <input value={query} onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
               onFocus={() => setOpen(true)} placeholder="Search your spaces"
               className="min-w-0 flex-1 bg-transparent text-sm text-fg focus:outline-none" />
      </div>
      {open && matches.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-auto rounded-xl border border-line-subtle bg-surface py-1 shadow-strip">
          {matches.map((space) => (
            <li key={space.id}>
              <button type="button"
                      onClick={() => { onChange(space.id, space.name); setOpen(false); setQuery(''); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-subtle">
                <SpaceAvatar name={space.name} imageUrl={space.imageUrl} size="sm" />
                <span className="min-w-0 truncate text-sm text-fg">{space.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
