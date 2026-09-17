// The directory card.
//
// Shape and type scale here are not taste — they were set against what
// production directories of the same data shape actually do (measured, not
// eyeballed): YC's startup directory, Luma's discover grid, Meetup's group
// results, Sequoia's people grid, PostHog's team, Airbnb's listing cards. Four
// rules came out of that and this file exists to hold them:
//
// 1. ONE ratio, and for identity media it is 1:1. Every directory whose media is
//    a face or a logo uses a square (Sequoia 494×494 cover, PostHog ~1:1, YC's
//    64px logo, Luma's 48px avatar); 4:3 and 16:9 belong to *content* thumbnails
//    (Airbnb 1.333 uniformly, Dribbble shots 1.333). This grid is identity media,
//    and a square is also the only ratio that matches the profile hero
//    (`w-48 h-48` / 240×240, `rounded-2xl`) — a card that crops a face to 3:2
//    can't agree with the page it opens.
// 2. Faces are covered, logos are contained. The profile pages already split
//    this way (`object-cover` on ProfilePageContent, `object-contain p-4` on
//    OrgPageContent) and the card follows, or org logos get cropped into
//    abstract swatches.
// 3. Hierarchy runs name → tagline → type, and it is carried by size AND weight
//    AND colour, never by size alone. Measured secondary lines: Airbnb 15px/400
//    #6c6c6c under a 15px/500 title, Meetup 13px/400 grey under 20px/600, Luma
//    14px/400 at 36% opacity under 18px/500, YC 14px/200 under 18px/500. Not one
//    of them draws the tagline at the name's weight — the old card did, in the
//    primary text colour, one step smaller, which reads as two competing titles.
// 4. The type chip is the smallest thing on the card. YC 10px, Meetup 11px. It
//    repeats on every card in a filtered grid, so it is the least informative
//    mark and must not be the loudest.
//
// What did NOT change with any of that: an entry with no image wears its type's
// colour as a solid field with a white glyph — the canonical <PersonSilhouette> /
// <TypeSilhouette> look, shared with the profile hero and the org page. A tinted
// (12% wash, coloured glyph) variant was tried here on the theory that forty
// saturated fields in a grid stop reading as avatars; it was rejected. The solid
// field is the product's signature, and the type colour is meant to be legible
// across a whole screen of cards, not whispered.

import React from 'react'
import type { DirectoryItem } from '@/lib/types'
import { getHeaderBgStyle } from './typeStyles'
import { getInitials } from '@/lib/avatarUtils'
import { getNodeTypeConfig, getNodeGlyph, findAlias, nodeTypeLabel } from '@/lib/types'
import type { NodeTypeConfig, SpaceAlias } from '@/lib/types'
import Chip from '@/components/ui/Chip'
import PersonSilhouette from '@/components/ui/PersonSilhouette'
import TypeSilhouette from '@/components/ui/TypeSilhouette'
import { useProfileCache } from '@/features/shared/contexts/ProfileContext'
import { useCardTilt } from '../hooks/useCardTilt'

interface DirectoryCardProps {
  item: DirectoryItem
  onClick?: (item: DirectoryItem) => void
  nodeTypes?: NodeTypeConfig[]
  aliases?: SpaceAlias[]
}

/**
 * Types whose image is a logo or mark rather than a photograph. These are
 * letterboxed on a neutral field; everything else (people, events, resources)
 * is a photograph and fills the square.
 */
const CONTAINED_GLYPHS = new Set(['group', 'connector'])

function NodeCard({ item, onClick, nodeTypes, aliases }: DirectoryCardProps) {
  const tiltRef = useCardTilt()
  const { getCached, version } = useProfileCache()
  const isPerson = item.id?.startsWith('person:')
  void version // subscribe for reactivity when any profile is updated
  const cached = isPerson ? getCached(item.id) : null

  const displayName = cached?.name ?? item.name
  const displaySubtitle = cached?.subtitle ?? item.subtitle
  const displayImageUrl = cached?.imageUrl ?? item.image_url

  const glyph = getNodeGlyph(item.type)
  const baseTypeColor = getNodeTypeConfig(item.type, nodeTypes).color
  const aliasConfig = findAlias(aliases, item.alias, item.type)
  const typeColor = aliasConfig?.color ?? baseTypeColor
  const contained = !isPerson && glyph !== null && CONTAINED_GLYPHS.has(glyph)

  // Glow colours exposed as CSS vars so the hover *shadow* stays pure CSS — only
  // the tilt (which has to know where the pointer is) touches inline style.
  const cardStyle = {
    '--card-glow': `${typeColor}55`,
    '--card-glow-strong': `${typeColor}99`,
  } as React.CSSProperties

  return (
    <div
      ref={tiltRef}
      className="bg-surface-1 rounded-2xl overflow-hidden cursor-pointer group flex flex-col w-full relative z-0 hover:z-10 transition-[box-shadow,transform] duration-200 active:scale-[0.98] [box-shadow:0_6px_16px_rgba(0,0,0,0.08),0_0_12px_2px_var(--card-glow)] hover:[box-shadow:0_16px_32px_rgba(0,0,0,0.16),0_0_20px_4px_var(--card-glow-strong)]"
      style={cardStyle}
      onClick={() => onClick?.(item)}
    >
      {/* Media — 1:1, the same square the profile hero uses */}
      <div className="aspect-square w-full shrink-0 overflow-hidden">
        {displayImageUrl ? (
          <img
            src={displayImageUrl}
            alt={displayName}
            loading="lazy"
            decoding="async"
            className={
              contained
                ? 'w-full h-full object-contain p-6 bg-surface-2'
                : 'w-full h-full object-cover object-center group-hover:scale-[1.03] transition-transform duration-300'
            }
          />
        ) : isPerson ? (
          <PersonSilhouette color={typeColor} />
        ) : glyph ? (
          <TypeSilhouette glyph={glyph} color={typeColor} />
        ) : (
          // Last resort — a type with no glyph of its own wears its monogram on
          // the same painted field, so the empty states stay one look.
          <div
            className="h-full w-full flex items-center justify-center group-hover:brightness-105 transition-all"
            style={getHeaderBgStyle(typeColor)}
          >
            <span className="text-2xl font-bold text-white drop-shadow-sm">
              {getInitials(displayName)}
            </span>
          </div>
        )}
      </div>

      {/* Content — centred on the card's axis, name over tagline over chip */}
      <div className="px-4 pt-4 pb-4 flex flex-col flex-1 min-h-0 items-center text-center">
        <h3 className="font-semibold text-text-primary text-base leading-tight line-clamp-1 w-full">
          {displayName}
        </h3>

        {/* Reserve a compact second line so chips align without leaving a large
            gap below short descriptions. */}
        <p className="mt-2 w-full text-[13px] font-normal leading-[1.35] text-text-secondary line-clamp-2 min-h-[28px]">
          {displaySubtitle ?? ''}
        </p>

        <Chip
          color={typeColor}
          size="md"
          className="mt-6"
        >
          {nodeTypeLabel(item.type, item.alias, aliases, nodeTypes)}
        </Chip>
      </div>
    </div>
  )
}

export default React.memo(NodeCard)
