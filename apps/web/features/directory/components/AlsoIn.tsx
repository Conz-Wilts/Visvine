'use client';

// The same person's records elsewhere in the family, one muted line over the
// entity's context note: each name opens that space's own record, in that space. Only spaces
// the viewer belongs to are named (lib/directory/shared/samePerson.ts), so
// the line is absent for most people and most viewers.
import SpaceLink from '@/features/shared/components/SpaceLink';
import { spaceUrlPrefix } from '@/lib/spaces/shared/spaceUrl';
import type { NBNode } from '@/lib/types';

export default function AlsoIn({ node, className }: { node: NBNode | null; className?: string }) {
  const records = node?.same_person;
  if (!records || records.length === 0) return null;
  return (
    <p className={`text-[13px] text-text-muted${className ? ` ${className}` : ''}`}>
      Also in{' '}
      {records.map((r, i) => (
        <span key={r.node_id}>
          {i > 0 && ' · '}
          <SpaceLink
            href={`${spaceUrlPrefix({ id: r.space.id, parentId: r.space.parent_id })}/directory/${encodeURIComponent(r.node_id)}`}
            className="text-text-secondary hover:text-text-primary hover:underline"
          >
            {r.space.name}
          </SpaceLink>
        </span>
      ))}
    </p>
  );
}
