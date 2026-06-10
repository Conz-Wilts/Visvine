'use client';

import React from 'react';
import { MapPin, ExternalLink } from 'lucide-react';
import { findAlias, type NBNode } from '@/lib/types';
import { getTypeColor } from '@/components/dashboard/typeStyles';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import ProfileAvatar from './ProfileAvatar';
import CTARow from './CTARow';
import StatsBar from './StatsBar';
import MutualConnectionsRow, { type MutualConnection } from './MutualConnectionsRow';

type CTAState = 'idle' | 'pending' | 'connected' | 'owner' | 'loading';

interface ProfileHeroProps {
  node: NBNode;
  mode: 'sidebar' | 'fullpage';
  ctaState?: CTAState;
  connectionCount?: number;
  communityCount?: number;
  mutualConnections?: MutualConnection[];
  onConnect?: () => void;
  onMessage?: () => void;
  onRequestIntro?: () => void;
  onEditProfile?: () => void;
  onConnectionsClick?: () => void;
  onCommunitiesClick?: () => void;
}

const AVATAR_SIZE = {
  sidebar: 'md' as const,
  fullpage: 'lg' as const,
};

export default function ProfileHero({
  node,
  mode,
  ctaState = 'idle',
  connectionCount = 0,
  communityCount = 1,
  mutualConnections = [],
  onConnect,
  onMessage,
  onRequestIntro,
  onEditProfile,
  onConnectionsClick,
  onCommunitiesClick,
}: ProfileHeroProps) {
  const avatarSize = AVATAR_SIZE[mode];
  const { currentCommunity } = useCommunity();
  // Alias colour wins over the base type colour, same as the directory cards.
  const aliasConfig = findAlias(currentCommunity?.communityAliases, node.alias, node.type);
  const typeColor = aliasConfig?.color ?? getTypeColor(node.type, currentCommunity?.nodeTypes);

  return (
    <div className="w-full px-6 pt-6 pb-2">
      {/* Avatar + identity + CTAs row */}
      <div className="flex items-start gap-6">
        {/* Avatar */}
        <ProfileAvatar
          name={node.name}
          nodeType={node.type}
          accentColor={typeColor}
          imageUrl={node.image_url ?? undefined}
          size={avatarSize}
          isOwner={ctaState === 'owner'}
        />

        {/* Identity block — fills remaining space */}
        <div className="flex-1 min-w-0 pt-1 space-y-1">
          {/* Type badge + active indicator */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border" style={{ backgroundColor: `${typeColor}20`, color: typeColor, borderColor: `${typeColor}40` }}>
              {node.alias ?? node.type}
            </span>
            {node.type === 'People' && (
              <span className="flex items-center gap-1 text-xs text-emerald-600">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                Active
              </span>
            )}
          </div>

          {/* Name */}
          <h1 className={`font-bold text-brand-black leading-tight ${mode === 'fullpage' ? 'text-2xl' : 'text-xl'}`}>
            {node.name}
          </h1>

          {/* Role / subtitle */}
          {node.subtitle && (
            <p className="text-base text-brand-grey leading-snug">{node.subtitle}</p>
          )}

          {/* Location + website */}
          <div className="flex items-center gap-4 flex-wrap pt-0.5">
            {node.location && (
              <span className="flex items-center gap-1 text-sm text-brand-grey">
                <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                {node.location}
              </span>
            )}
            {node.url && (
              <a
                href={node.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-brand-dark-green hover:underline"
              >
                <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                {(() => {
                  try { return new URL(node.url).hostname.replace('www.', ''); }
                  catch { return node.url; }
                })()}
              </a>
            )}
          </div>

          {/* CTAs */}
          <div className="pt-3">
            <CTARow
              state={ctaState}
              nodeName={node.name}
              onConnect={onConnect}
              onMessage={onMessage}
              onRequestIntro={onRequestIntro}
              onEditProfile={onEditProfile}
            />
          </div>

          {/* Stats bar */}
          <div className="pt-3">
            <StatsBar
              connectionCount={connectionCount}
              communityCount={communityCount}
              memberSince={node.createdAt}
              onConnectionsClick={onConnectionsClick}
              onCommunitiesClick={onCommunitiesClick}
            />
          </div>

          {/* Mutual connections */}
          {mutualConnections.length > 0 && (
            <div className="pt-2">
              <MutualConnectionsRow mutualConnections={mutualConnections} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
