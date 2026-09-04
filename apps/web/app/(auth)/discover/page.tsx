'use client';

import React, { useState, useMemo } from 'react';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { Space, selfJoinAliases } from '@/lib/types';
import { spaceMark } from '@/lib/spaces/subspaces';
import { Button, EmptyState, Modal, SearchInput } from '@/components/ui';

function formatMemberCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}

function SpaceCard({
  space,
  mark,
  parentName,
  joined,
  onJoin,
}: {
  space: Space;
  /** The mark it wears — a sub-space wears its parent's (spaceMark). */
  mark: { name: string; imageUrl?: string };
  /** The space this one is a sub-space of, when the viewer can see it. */
  parentName: string | null;
  joined: boolean;
  onJoin: (c: Space) => void;
}) {
  // The same shape as the directory's NodeCard: a bare square, then the name
  // and one line of facts underneath. Join is a word in the accent, not a bar.
  const facts = [parentName ? `in ${parentName}` : null, `${formatMemberCount(space.memberCount)} members`, space.location]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="group flex w-full flex-col">
      <div className="aspect-square w-full overflow-hidden rounded-lg">
        <SpaceAvatar
          name={mark.name}
          imageUrl={mark.imageUrl}
          className="h-full w-full !rounded-none transition-transform duration-300 group-hover:scale-[1.03]"
        />
      </div>

      <div className="flex items-start justify-between gap-3 pt-2.5">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold leading-tight text-text-primary">{space.name}</h3>
          <p className="mt-1 truncate text-[13px] text-text-muted">{facts}</p>
          <p className="mt-1 line-clamp-2 text-[13px] leading-[1.35] text-text-secondary">
            {space.description || 'An emerging space waiting to be discovered.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onJoin(space)}
          disabled={joined}
          className={`shrink-0 pt-0.5 text-[13px] font-semibold transition-colors ${
            joined ? 'text-text-muted cursor-default' : 'text-brand-dark-green hover:underline'
          }`}
        >
          {joined ? 'Joined' : 'Join'}
        </button>
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  const { spaces, joinSpace, joinedSpaces } = useSpace();
  const [pendingSpace, setPendingSpace] = useState<Space | null>(null);
  const [selectedAlias, setSelectedAlias] = useState('');
  const [joining, setJoining] = useState(false);
  const [search, setSearch] = useState('');

  const isJoined = (id: string) => joinedSpaces.some(c => c.id === id);
  // A public sub-space of a private space is listed on its own: the parent's
  // name is shown only when the parent is in the viewer's own list.
  const nameOf = (id: string | null | undefined) => (id ? (spaces.find(c => c.id === id)?.name ?? null) : null);

  const handleJoin = (space: Space) => {
    // Only Person-scoped aliases are selectable when joining (a user is a person),
    // so skip the picker entirely when none exist.
    const aliases = selfJoinAliases(space.aliases);
    if (aliases.length > 0) {
      setPendingSpace(space);
      setSelectedAlias('');
    } else {
      doJoin(space.id, undefined);
    }
  };

  const doJoin = async (spaceId: string, alias: string | undefined) => {
    setJoining(true);
    try {
      await joinSpace(spaceId, alias);
    } finally {
      setJoining(false);
      setPendingSpace(null);
      setSelectedAlias('');
    }
  };

  const filteredSpaces = useMemo(() => {
    let result = spaces;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.description ?? '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [spaces, search]);

  // A user joins as a person, so only offer Person-scoped aliases (e.g. "Founder").
  // Org-scoped aliases like "Portfolio Company" must never be selectable here, and
  // neither may an admin alias — you never make yourself an admin by joining.
  const aliases = selfJoinAliases(pendingSpace?.aliases);

  return (
    <div className="w-full">
      <div className="w-full px-4 sm:px-6 lg:px-8 pb-10">

        {/* Search — the page starts with the field, not a title */}
        <div className="pt-2">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search spaces by name, description, or tags…"
            className="max-w-md"
          />
        </div>

        {filteredSpaces.length === 0 ? (
          <EmptyState title="No spaces found" description="No spaces match that search." />
        ) : (
          <div className="grid gap-x-6 gap-y-8 pt-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            {filteredSpaces.map((space) => (
              <SpaceCard
                key={space.id}
                space={space}
                mark={spaceMark(space, spaces)}
                parentName={nameOf(space.parentId)}
                joined={isJoined(space.id)}
                onJoin={handleJoin}
              />
            ))}
          </div>
        )}
      </div>

      {/* Alias selection modal */}
      {pendingSpace && (
        <Modal
          onClose={() => { setPendingSpace(null); setSelectedAlias(''); }}
          size="sm"
          ariaLabel="Choose your role"
        >
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <SpaceAvatar name={pendingSpace.name} imageUrl={pendingSpace.imageUrl} size="md" />
              <div>
                <h2 className="text-lg font-semibold text-text-primary">How do you identify?</h2>
                <p className="text-xs text-text-muted">{pendingSpace.name}</p>
              </div>
            </div>
            <p className="text-sm text-text-secondary mb-6">
              Choose your role so others in the space know who you are.
            </p>

            {/* One row per role: a colour dot and the word. The chosen one is
                bolder and tinted; nothing is outlined. */}
            <ul className="mb-6 -mx-2">
              {aliases.map((alias) => {
                const chosen = selectedAlias === alias.name;
                return (
                  <li key={alias.name}>
                    <button
                      onClick={() => setSelectedAlias(alias.name)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                        chosen ? 'bg-surface-3 font-semibold text-text-primary' : 'text-text-secondary hover:bg-surface-2'
                      }`}
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: alias.color }} />
                      {alias.name}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="flex justify-end gap-2">
              <Button variant="neutral" onClick={() => { setPendingSpace(null); setSelectedAlias(''); }}>
                Cancel
              </Button>
              <Button variant="brand" onClick={() => doJoin(pendingSpace.id, selectedAlias || undefined)} disabled={joining}>
                {joining ? 'Joining…' : 'Join'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
