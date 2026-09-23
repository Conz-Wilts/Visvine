'use client';

import { useState } from 'react';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { Button, Modal } from '@visvine/ui';
import { selfJoinAliases, type Space } from '@/lib/types';

/** "How do you identify?" — the role picker a space asks on the way in. */
export default function JoinRoleDialog({
  space,
  joining,
  onConfirm,
  onCancel,
}: {
  space: Space;
  joining: boolean;
  onConfirm: (alias?: string) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState('');
  const aliases = selfJoinAliases(space.aliases);

  return (
    <Modal onClose={onCancel} maxWidth="max-w-sm" ariaLabel="Choose your role">
      <div className="p-6">
        <div className="mb-4 flex items-center gap-3">
          <SpaceAvatar name={space.name} imageUrl={space.imageUrl} size="md" />
          <h2 className="text-base font-semibold text-fg">Join {space.name} as</h2>
        </div>

        {/* One row per role: a colour dot and the word. The chosen one is
            bolder and tinted; nothing is outlined. */}
        <ul className="-mx-2 mb-6">
          {aliases.map((alias) => {
            const chosen = selected === alias.name;
            return (
              <li key={alias.name}>
                <button
                  type="button"
                  onClick={() => setSelected(alias.name)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                    chosen ? 'bg-surface-muted font-semibold text-fg' : 'text-fg-secondary hover:bg-surface-subtle'
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
          <Button variant="neutral" onClick={onCancel}>Cancel</Button>
          <Button variant="brand" onClick={() => onConfirm(selected || undefined)} disabled={joining}>
            {joining ? 'Joining…' : 'Join'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
