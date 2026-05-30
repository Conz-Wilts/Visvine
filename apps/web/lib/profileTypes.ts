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
}

export function computeProfileCompletion(profile: FullProfile): {
  score: number;
  sections: Record<string, { complete: boolean; label: string }>;
} {
  const sections = {
    photo: { label: 'Profile photo', complete: !!profile.imageUrl },
    headline: { label: 'Headline', complete: !!profile.subtitle },
    about: { label: 'About / Bio', complete: !!profile.bio },
    location: { label: 'Location', complete: !!profile.location },
    skills: { label: 'Skills', complete: profile.tags.length > 0 },
    contact: { label: 'Contact info', complete: !!(profile.website || profile.linkedinUrl || profile.phone) },
  };

  const completed = Object.values(sections).filter((s) => s.complete).length;
  const score = Math.round((completed / Object.keys(sections).length) * 100);
  return { score, sections };
}
