// Community domain: the Community record and its design/feature configuration.

import type { NodeTypeConfig, CommunityAlias, LinkTypeConfig } from './context';

interface CommunityDesignFont {
  name: string;
  url: string;
  format: 'woff2' | 'truetype' | 'opentype';
}

export interface CommunityDesignConfig {
  background?: {
    type: 'solid' | 'image';
    color?: string;       // hex color for solid
    imageUrl?: string;    // GCS URL for uploaded image
  };
  fonts?: {
    main?: CommunityDesignFont;    // titles — replaces ABC Ginto Rounded
    utility?: CommunityDesignFont; // body — replaces Open Sauce One
  };
  // Community-wide tag → base-colour registry (key = lower-cased tag). Set once
  // when a tag is first created; keeps a tag's colour consistent everywhere.
  tagColors?: Record<string, string>;
}

// Which optional community surfaces (directory, channels, events, …) are
// switched on. A feature is enabled unless its key is explicitly `false`, so an
// empty config means "everything on" — see lib/features.tsx#isFeatureEnabled.
export interface CommunityFeatureConfig {
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
  // tab members land on when they enter the community.
  order?: string[];
  // Feature keys tucked into the sidebar's "More" popup instead of the rail.
  // Membership only — display order still comes from `order`. Placement, not
  // enablement: a disabled feature listed here simply doesn't show, and keeps
  // its slot for when it's re-enabled — see lib/featureAccess.ts#moreFeatureKeys.
  more?: string[];
}

export interface Community {
  id: string;
  name: string;
  description: string;
  country?: string;  // ISO 3166-1 alpha-2 code e.g. "NZ", "US"
  location?: string;
  tags: string[];
  memberCount: number;
  dataFile: string; // filename in /data/ecosystems/
  createdAt: string;
  imageUrl?: string;
  nodeTypes?: NodeTypeConfig[]; // Customizable node types for this community
  communityAliases?: CommunityAlias[]; // Aliases with colors, scoped per node type
  linkTypes?: LinkTypeConfig[]; // Customizable relationship (edge) types for this community
  designConfig?: CommunityDesignConfig;
  featureConfig?: CommunityFeatureConfig; // Which optional surfaces are enabled
  visibility?: 'public' | 'private'; // 'public' = discoverable & self-joinable; 'private' = invite/admin-add only
}
