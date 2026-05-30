'use client';

import React, { useState, useMemo } from 'react';
import { getTypeColor } from '@/components/dashboard/typeStyles';
import type { ProfileConnection } from '@/hooks/useNodeProfile';
import { getInitials } from '@/lib/avatarUtils';

interface ConnectionsGridProps {
  connections: ProfileConnection[];
  nodeType: string;
}

const PAGE_SIZE = 24;

function formatRelationship(rel: string): string {
  return rel.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default function ConnectionsGrid({ connections, nodeType: _nodeType }: ConnectionsGridProps) {
  const [filterRel, setFilterRel] = useState<string>('all');
  const [page, setPage] = useState(1);

  const relationshipTypes = useMemo(() => {
    const types = new Set(connections.map((c) => c.relationship));
    return Array.from(types);
  }, [connections]);

  const filtered = useMemo(
    () => (filterRel === 'all' ? connections : connections.filter((c) => c.relationship === filterRel)),
    [connections, filterRel]
  );

  const paginated = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = paginated.length < filtered.length;

  if (connections.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-3">🔗</div>
        <p className="text-sm text-brand-grey">No connections yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      {relationshipTypes.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => { setFilterRel('all'); setPage(1); }}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filterRel === 'all'
                ? 'bg-brand-green text-brand-black'
                : 'bg-surface-3 text-brand-grey hover:bg-surface-3'
            }`}
          >
            All ({connections.length})
          </button>
          {relationshipTypes.map((rel) => (
            <button
              key={rel}
              onClick={() => { setFilterRel(rel); setPage(1); }}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filterRel === rel
                  ? 'bg-brand-green text-brand-black'
                  : 'bg-surface-3 text-brand-grey hover:bg-surface-3'
              }`}
            >
              {formatRelationship(rel)}
            </button>
          ))}
        </div>
      )}

      {/* Grouped by relationship type */}
      {filterRel === 'all' ? (
        <div className="space-y-6">
          {relationshipTypes.map((rel) => {
            const group = connections.filter((c) => c.relationship === rel);
            return (
              <div key={rel}>
                <h4 className="text-xs font-medium text-brand-grey uppercase tracking-wide mb-3">
                  {formatRelationship(rel)} ({group.length})
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {group.slice(0, PAGE_SIZE).map((conn) => (
                    <ConnectionCard key={conn.id} conn={conn} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {paginated.map((conn) => (
              <ConnectionCard key={conn.id} conn={conn} />
            ))}
          </div>
          {hasMore && (
            <button
              onClick={() => setPage((p) => p + 1)}
              className="w-full py-2 text-sm font-medium text-brand-dark-green hover:bg-brand-light-bg rounded-xl transition-colors"
            >
              Load more ({filtered.length - paginated.length} remaining)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ConnectionCard({ conn }: { conn: ProfileConnection }) {
  const typeColor = getTypeColor(conn.type);

  return (
    <div className="flex flex-col items-center gap-2 p-3 bg-surface-2 rounded-xl border border-border-subtle hover:border-border-default hover:shadow-soft hover:scale-[1.01] transition-all duration-150 cursor-pointer">
      {conn.image_url ? (
        <img src={conn.image_url} alt={conn.name} className="w-16 h-16 rounded-full object-cover" />
      ) : (
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-base font-semibold text-white"
          style={{ backgroundColor: typeColor }}
          aria-hidden="true"
        >
          {getInitials(conn.name)}
        </div>
      )}
      <div className="text-center w-full">
        <p className="text-xs font-semibold text-brand-black line-clamp-1">{conn.name}</p>
        {conn.subtitle && (
          <p className="text-xs text-brand-grey line-clamp-1 mt-0.5">{conn.subtitle}</p>
        )}
        <span
          className="inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium border"
          style={{ backgroundColor: `${typeColor}20`, color: typeColor, borderColor: `${typeColor}40` }}
        >
          {conn.type}
        </span>
      </div>
    </div>
  );
}
