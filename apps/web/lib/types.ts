// Node type is now dynamic per community
export type NodeType = string;

// Shape options for node rendering
export type NodeShape = 'rectangle' | 'hexagon' | 'circle';

// Configuration for a node type
export interface NodeTypeConfig {
  name: string; // e.g., "Person", "Organization"
  color: string; // Hex color e.g., "#2563eb"
  shape: NodeShape; // Shape to render
  icon?: string; // Optional emoji or icon
}

export interface NBNode {
  id: string;
  type: NodeType;
  name: string;
  subtitle?: string | null;
  location?: string | null;
  url?: string | null;
  tags?: string[];
  image_url?: string | null;
  metadata?: Record<string, unknown>;
  alias?: string | null;
  community_id?: string | null;
  createdAt?: string;
  // Force graph will add these during simulation
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  // Anti-bouncing system
  lastFix?: Record<string, number>;
}

export type RelationshipType =
  | 'works_at'
  | 'founded'
  | 'invested_in'
  | 'attended'
  | 'member_of'
  | 'sponsors'
  | 'partner_with';

export interface NBLink {
  source: string | NBNode; // node id or node object
  target: string | NBNode; // node id or node object
  relationship: RelationshipType | (string & {});
  since?: string; // ISO date
  metadata?: Record<string, unknown>;
  community_id?: string;
}

export interface GraphData {
  nodes: NBNode[];
  links: NBLink[];
}

export interface DiagnosticResult {
  name: string;
  pass: boolean;
  details?: string;
}

export interface DiagnosticReport {
  results: DiagnosticResult[];
  allPass: boolean;
  failExamples: unknown[];
}

export interface CommunityDesignFont {
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
  designConfig?: CommunityDesignConfig;
}

// A named alias with a display color, scoped to a specific node type within a community
export interface CommunityAlias {
  name: string;    // e.g. "Founder"
  color: string;   // Hex color e.g. "#16a34a"
  nodeType: string; // e.g. "Person", "Organization"
}

export interface CommunitiesRegistry {
  communities: Community[];
}

export interface UserCommunityPreferences {
  joinedCommunities: string[];
  currentCommunity: string | null;
}

// Event types
export type EventVisibility = 'public' | 'community' | 'private';
export type RSVPStatus = 'invited' | 'registered' | 'waitlisted' | 'cancelled' | 'checked_in' | 'no_show';
export type FormFieldType = 'text' | 'textarea' | 'email' | 'select' | 'checkbox' | 'url' | 'linkedin' | 'company';

export interface FormField {
  id: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[];
}

export interface NBEvent {
  id: `event:${string}`;
  communityId: string;
  title: string;
  description?: string;
  startAt: string;
  endAt?: string;
  timezone?: string;
  location?: {
    label: string;
    address?: string;
    lat?: number;
    lon?: number;
  };
  hosts: string[];
  organizerEmail?: string;
  capacity?: number;
  visibility: EventVisibility;
  form: {
    enabled: boolean;
    slug: string;
    schema: FormField[];
    domainAllowlist?: string[];
    requireApproval?: boolean;
  };
  analytics: {
    views: number;
    rsvpCount: number;
    checkinCount: number;
    createdAt: string;
    updatedAt: string;
  };
  metadata?: Record<string, unknown>;
}

export interface NBAttendee {
  id: `attendee:${string}`;
  eventId: NBEvent['id'];
  personId: `person:${string}`;
  email?: string;
  linkedinUrl?: string;
  companyName?: string;
  roleTitle?: string;
  answers?: Record<string, string | boolean>;
  status: RSVPStatus;
  createdAt: string;
  updatedAt: string;
  checkinAt?: string;
}

export interface EventsData {
  events: NBEvent[];
  attendees: NBAttendee[];
}

// Resource types
export type ResourceFileType = 'pdf' | 'xlsx' | 'csv' | 'docx' | 'image';
export type ResourceChangeStatus = 'pending' | 'approved' | 'rejected';

export interface Resource {
  id: string;
  communityId: string;
  name: string;
  fileType: ResourceFileType;
  fileUrl: string;
  fileSize?: number;
  uploadedBy?: string;
  createdAt: string;
  metadata: {
    originalFilename?: string;
    sheetNames?: string[];
  };
}

export interface ResourceComment {
  id: string;
  resourceId: string;
  cellRef?: string;
  author: string;
  content: string;
  createdAt: string;
}

export interface ResourceChange {
  id: string;
  resourceId: string;
  cellRef: string;
  originalValue?: string;
  proposedValue: string;
  reason?: string;
  proposedBy: string;
  status: ResourceChangeStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

// Semantic search types
export interface ParsedQuery {
  filters: {
    name?: string;
    type?: NodeType;
    location?: string;
    tags?: string[];
  };
  semantic_terms: string[];
}

export interface SemanticSearchResult extends NBNode {
  similarity: number;
  explanation: string;
}

export interface DirectoryItem {
  id: string
  name: string
  type: NodeType
  alias?: string | null
  subtitle?: string | null
  location?: string | null
  url?: string | null
  bio?: string
  tags?: string[]
  image_url?: string | null
  company_name?: string
  company_image_url?: string
  website?: string
  linkedinUrl?: string
  twitterUrl?: string
  phone?: string
  pronouns?: string
  openToWork?: boolean
  explanation?: string
  similarity?: number
}

// Canonical node types and their default colours/shapes. A community can override
// these via `nodeTypes`, but every type listed here resolves to a non-grey colour
// even before a community config has loaded. This is what prevents the
// "everything is grey on first paint" race condition.
export const DEFAULT_NODE_TYPES: NodeTypeConfig[] = [
  { name: 'Community',    color: '#10b981', shape: 'hexagon'   },
  { name: 'Person',       color: '#2563eb', shape: 'rectangle' },
  { name: 'Organization', color: '#9333ea', shape: 'rectangle' },
  { name: 'Event',        color: '#ef4444', shape: 'rectangle' },
  { name: 'Group',        color: '#0ea5e9', shape: 'rectangle' },
  { name: 'Resource',     color: '#f59e0b', shape: 'rectangle' },
];

// (NODE_COLORS removed — all type→colour resolution goes through the
// case-insensitive getNodeTypeConfig/getTypeColor canonical helpers.)

/**
 * Get node type configuration for a specific type within a community
 */
export function getNodeTypeConfig(
  type: string,
  communityNodeTypes?: NodeTypeConfig[]
): NodeTypeConfig {
  const normalized = type.toLowerCase();

  // Check community-specific overrides first (case-insensitive)
  if (communityNodeTypes) {
    const config = communityNodeTypes.find(t => t.name.toLowerCase() === normalized);
    if (config) return config;
  }

  // Always fall back to DEFAULT_NODE_TYPES before giving up
  const defaultConfig = DEFAULT_NODE_TYPES.find(t => t.name.toLowerCase() === normalized);
  if (defaultConfig) return defaultConfig;

  // Truly unknown type — capitalize for display
  return { name: type.charAt(0).toUpperCase() + type.slice(1), color: '#6b7280', shape: 'rectangle' };
}

/**
 * Get all available node types for a community
 */
export function getNodeTypes(communityNodeTypes?: NodeTypeConfig[]): string[] {
  const nodeTypes = communityNodeTypes || DEFAULT_NODE_TYPES;
  return nodeTypes.map((t) => t.name);
}
