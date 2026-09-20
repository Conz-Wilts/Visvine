export interface FullProfile {
  id: string;
  spaceId?: string | null;
  name: string;
  subtitle?: string | null;
  bio?: string | null;
  location?: string | null;
  website?: string | null;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
  phone?: string | null;
  pronouns?: string | null;
  email?: string | null;
  imageUrl?: string | null;
  tags: string[];
  metadata?: Record<string, unknown> | null;
  userId?: string | null;
  /** True when this profile id resolves to a registered member (see
   *  /api/profile — the node's connection first, then the member's own ids). */
  connected?: boolean;
  createdAt: string;
  updatedAt: string;
}
