'use client';

import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { Modal, ResourceCard, ResourceGrid, ResourceRow, SearchInput } from '@visvine/ui';
import type { ListKind } from '@/lib/resources/shared/listQuery';
import type { ResourceView } from '@/lib/resources/shared/view';
import { useResourceList } from '@/features/resources/hooks/useResourceList';
import { resourceMeta } from '@/features/resources/viewer/meta';

/**
 * Choose resources the space already holds — to share into a message, to
 * make an event's cover. Images are chosen from a picture grid; anything else
 * from the list. Only what the chooser can see is offered.
 */
export default function ResourcePicker({
  spaceId,
  open,
  onClose,
  onPick,
  kind = 'all',
  title = 'Choose from Resources',
  multiple = false,
}: {
  spaceId: string;
  open: boolean;
  onClose: () => void;
  onPick: (picked: ResourceView[]) => void;
  kind?: ListKind;
  title?: string;
  multiple?: boolean;
}) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ResourceView[]>([]);
  const { items } = useResourceList(open ? spaceId : null, { kind, q: query || null });

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (open) setPicked([]);
  }, [open]);

  const choose = (r: ResourceView) => {
    if (!multiple) {
      onPick([r]);
      onClose();
      return;
    }
    setPicked((prev) => (prev.some((p) => p.id === r.id) ? prev.filter((p) => p.id !== r.id) : [...prev, r]));
  };
  const isPicked = (r: ResourceView) => picked.some((p) => p.id === r.id);
  const images = kind === 'image';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        multiple ? (
          <div className="flex items-center justify-end gap-2 border-t border-line-subtle px-6 py-4">
            <button
              type="button"
              disabled={!picked.length}
              onClick={() => {
                onPick(picked);
                onClose();
              }}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Add {picked.length || ''}
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-3 px-6 py-4">
        <SearchInput value={q} onChange={setQ} placeholder={images ? 'Search images' : 'Search resources'} />
        <div className={clsx('max-h-[60vh] overflow-y-auto', !images && 'divide-y divide-line-subtle')}>
          {items === null ? null : images ? (
            <ResourceGrid variant="image">
              {items.map((r) => (
                <ResourceCard
                  key={r.id}
                  name={r.name}
                  kind={r.kind}
                  thumbUrl={r.thumbUrl}
                  variant="image"
                  selected={isPicked(r)}
                  onOpen={() => choose(r)}
                />
              ))}
            </ResourceGrid>
          ) : (
            items.map((r) => (
              <ResourceRow
                key={r.id}
                name={r.name}
                kind={r.kind}
                meta={resourceMeta(r)}
                thumbUrl={r.kind === 'image' || r.source === 'link' ? r.thumbUrl : null}
                selected={isPicked(r)}
                onOpen={() => choose(r)}
              />
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
