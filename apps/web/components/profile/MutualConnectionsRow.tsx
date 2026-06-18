'use client';

import React from 'react';
import { getTypeColor } from '@/components/dashboard/typeStyles';
import { getInitials } from '@/lib/avatarUtils';

export interface MutualConnection {
  id: string;
  name: string;
  imageUrl?: string;
  nodeType?: string;
}

interface MutualConnectionsRowProps {
  mutualConnections: MutualConnection[];
}

export default function MutualConnectionsRow({ mutualConnections }: MutualConnectionsRowProps) {
  if (mutualConnections.length === 0) return null;

  const displayed = mutualConnections.slice(0, 3);
  const overflow = mutualConnections.length - 3;
  const firstName = mutualConnections[0].name;
  const othersCount = mutualConnections.length - 1;

  return (
    <div className="flex items-center gap-2 animate-[fadeIn_0.3s_ease-in]">
      {/* Overlapping avatar stack */}
      <div className="flex -space-x-2">
        {displayed.map((conn) => (
          <div
            key={conn.id}
            className="w-8 h-8 rounded-full ring-2 ring-surface-1 overflow-hidden flex-shrink-0 relative"
            title={conn.name}
          >
            {conn.imageUrl ? (
              <img src={conn.imageUrl} alt={conn.name} className="w-full h-full object-cover" />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center text-xs font-semibold text-white"
                style={{ backgroundColor: getTypeColor(conn.nodeType ?? 'People') }}
                aria-hidden="true"
              >
                {getInitials(conn.name)}
              </div>
            )}
          </div>
        ))}
        {overflow > 0 && (
          <div className="w-8 h-8 rounded-lg ring-2 ring-surface-1 bg-surface-3 flex items-center justify-center text-xs font-medium text-text-muted flex-shrink-0">
            +{overflow}
          </div>
        )}
      </div>

      <p className="text-xs text-brand-grey leading-tight">
        You both know{' '}
        <span className="font-semibold text-brand-black">{firstName}</span>
        {othersCount > 0 && (
          <span> and {othersCount} {othersCount === 1 ? 'other' : 'others'}</span>
        )}
      </p>
    </div>
  );
}
