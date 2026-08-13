// Space domain: the Space record and its design/feature configuration.

import type { NodeTypeConfig, SpaceAlias, LinkTypeConfig } from './context';

interface SpaceDesignFont {
  name: string;
  url: string;
  format: 'woff2' | 'truetype' | 'opentype';
}

export interface SpaceDesignConfig {
  background?: {
    type: 'solid' | 'image';
    color?: string;       // hex color for solid
    imageUrl?: string;    // GCS URL for uploaded image
  };
  fonts?: {
    main?: SpaceDesignFont;    // titles (.font-title) — defaults to Open Sauce One
    utility?: SpaceDesignFont; // body — replaces Open Sauce One
  };
  // Space-wide tag → base-colour registry (key = lower-cased tag). Set once
  // when a tag is first created; keeps a tag's colour consistent everywhere.
  tagColors?: Record<string, string>;
}

// Which optional space surfaces (directory, channels, events, …) are
// switched on. A feature is enabled unless its key is explicitly `false`, so an
// empty config means "everything on" — see features/shared/lib/features.tsx#isFeatureEnabled.
export interface SpaceFeatureConfig {
  enabled?: Record<string, boolean>;
  // Legacy directory-only form of `adminOnly`, kept in sync by
  // sanitizeFeatureConfig because a raw SQL guard in the node-search route reads
  // this column directly. Prefer `adminOnly`.
  directoryPrivate?: boolean; // true = directory is admins-only (hidden from members)
  // Feature keys only admins can see or open — members get neither the sidebar
  // row nor the page. See lib/featureAccess.ts#adminOnlyFeatureKeys.
  adminOnly?: string[];
  // Feature keys in display order. Unlisted keys fall in after, in registry
  // order, so an absent `order` reproduces the registry's own order — see
  // lib/featureAccess.ts#sortFeatureKeys. The first visible entry is also the
  // tab members land on when they enter the space.
  order?: string[];
  // Feature keys tucked into the sidebar's "More" popup instead of the rail.
  // Membership only — display order still comes from `order`. Placement, not
  // enablement: a disabled feature listed here simply doesn't show, and keeps
  // its slot for when it's re-enabled — see lib/featureAccess.ts#moreFeatureKeys.
  more?: string[];
}

export interface Space {
  id: string;
  name: string;
  description: string;
  country?: string;  // ISO 3166-1 alpha-2 code e.g. "NZ", "US"
  location?: string;
  tags: string[];
  memberCount: number;
  createdAt: string;
  imageUrl?: string;
  nodeTypes?: NodeTypeConfig[]; // Customizable node types for this space
  aliases?: SpaceAlias[]; // Aliases with colors, scoped per node type
  linkTypes?: LinkTypeConfig[]; // Customizable relationship (edge) types for this space
  designConfig?: SpaceDesignConfig;
  featureConfig?: SpaceFeatureConfig; // Which optional surfaces are enabled
  visibility?: 'public' | 'private'; // 'public' = discoverable & self-joinable; 'private' = invite/admin-add only
}
