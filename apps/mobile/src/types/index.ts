// Mobile-specific types extending shared packages

export interface User {
  id: string;
  name: string;
  email: string;
  image: string | null;
  nodeId?: string;
  isSuperAdmin?: boolean;
}

export interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

// Event types (mirrors web for now, can diverge)
export interface Event {
  id: string;
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
  capacity?: number;
  visibility: 'public' | 'community' | 'private';
  analytics: {
    views: number;
    rsvpCount: number;
    checkinCount: number;
  };
}

// Conversation types
export interface ConversationParticipant {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: 'owner' | 'admin' | 'member';
  lastReadAt: string | null;
}

export interface Message {
  id: string;
  text: string;
  attachmentUrl: string | null;
  createdAt: string;
  sender: {
    id: string;
    name: string;
    image: string | null;
  };
  isOwn: boolean;
}

export interface Conversation {
  id: string;
  type: 'DM' | 'GROUP';
  name: string;
  avatarUrl: string | null;
  participants: ConversationParticipant[];
  lastMessage: Message | null;
  unreadCount: number;
  updatedAt: string;
}

// Directory member — maps to Node row from /api/data/nodes
export interface DirectoryMember {
  id: string;
  name: string;
  type: string;
  // Node fields
  subtitle?: string;   // role/title for person nodes
  image_url?: string;
  location?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  community_id?: string;
  // Legacy/profile fields (available via /api/profile)
  title?: string;
  company?: string;
  email?: string;
}

// API error
export interface ApiError {
  error: string;
  status?: number;
}

// ── Full profile types (mirror web /lib/profileTypes) ─────────────────────────

export interface WorkExperience {
  id: string;
  personId: string;
  title: string;
  company: string;
  location?: string | null;
  startDate: string;
  endDate?: string | null;
  current: boolean;
  description?: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Education {
  id: string;
  personId: string;
  school: string;
  degree?: string | null;
  fieldOfStudy?: string | null;
  startYear?: number | null;
  endYear?: number | null;
  description?: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Certification {
  id: string;
  personId: string;
  name: string;
  issuingOrg: string;
  issueDate?: string | null;
  expiryDate?: string | null;
  credentialId?: string | null;
  credentialUrl?: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type LanguageProficiency =
  | 'elementary'
  | 'limited_working'
  | 'professional'
  | 'full_professional'
  | 'native';

export interface ProfileLanguage {
  id: string;
  personId: string;
  language: string;
  proficiency: LanguageProficiency;
  sortOrder: number;
  createdAt: string;
}

export const PROFICIENCY_LABELS: Record<LanguageProficiency, string> = {
  elementary: 'Elementary',
  limited_working: 'Limited Working',
  professional: 'Professional',
  full_professional: 'Full Professional',
  native: 'Native / Bilingual',
};

export interface FullProfile {
  id: string;
  communityId?: string | null;
  name: string;
  subtitle?: string | null;
  bio?: string | null;
  location?: string | null;
  website?: string | null;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
  phone?: string | null;
  pronouns?: string | null;
  openToWork: boolean;
  email?: string | null;
  imageUrl?: string | null;
  tags: string[];
  metadata?: Record<string, unknown> | null;
  userId?: string | null;
  createdAt: string;
  updatedAt: string;
  workExperience: WorkExperience[];
  education: Education[];
  certifications: Certification[];
  languages: ProfileLanguage[];
}