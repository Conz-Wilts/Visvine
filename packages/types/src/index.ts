// Core Types
export type Id = string;

// Node Types
export interface BaseNode {
  id: Id;
  type: string;
  name: string;
  description?: string;
  image_url?: string;
  metadata?: Record<string, unknown>;
  community_id: string;
  created_at?: Date | string;
  updated_at?: Date | string;
}

export interface Person extends BaseNode {
  type: 'Person';
  email?: string;
  title?: string;
  company?: string;
  linkedin_url?: string;
  twitter_url?: string;
}

export interface Organization extends BaseNode {
  type: 'Organization' | 'Startup' | 'Investor';
  website?: string;
  industry?: string;
  founded_year?: number;
}

export interface Event extends BaseNode {
  type: 'Event';
  start_date?: Date | string;
  end_date?: Date | string;
  location?: string;
  capacity?: number;
  registration_url?: string;
}

export type Node = Person | Organization | Event | BaseNode;

// Link Types
export interface Link {
  id: Id;
  source_id: Id;
  target_id: Id;
  relationship: string;
  metadata?: Record<string, unknown>;
  community_id: string;
  created_at?: Date | string;
}

// Community Types
export interface NodeType {
  name: string;
  color: string;
  shape: 'rectangle' | 'hexagon' | 'circle';
  icon?: string;
}

export interface Community {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string | null;
  image?: string | null;
  node_types?: NodeType[];
  created_at?: Date | string;
  updated_at?: Date | string;
}

// API Response Types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  status: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
