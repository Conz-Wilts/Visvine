// Extended profile types — LinkedIn-equivalent schema

export interface WorkExperience {
  id: string;
  personId: string;
  title: string;
  company: string;
  location?: string | null;
  startDate: string; // "YYYY-MM" or "YYYY"
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

export interface ProfileLanguage {
  id: string;
  personId: string;
  language: string;
  proficiency: LanguageProficiency;
  sortOrder: number;
  createdAt: string;
}

export type LanguageProficiency =
  | 'elementary'
  | 'limited_working'
  | 'professional'
  | 'full_professional'
  | 'native';

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

// Compute a 0–100 completion score for a profile
export function computeProfileCompletion(profile: FullProfile): {
  score: number;
  sections: Record<string, { complete: boolean; label: string }>;
} {
  const sections = {
    photo: { label: 'Profile photo', complete: !!profile.imageUrl },
    headline: { label: 'Headline', complete: !!profile.subtitle },
    about: { label: 'About / Bio', complete: !!profile.bio },
    location: { label: 'Location', complete: !!profile.location },
    experience: { label: 'Work experience', complete: profile.workExperience.length > 0 },
    education: { label: 'Education', complete: profile.education.length > 0 },
    skills: { label: 'Skills', complete: profile.tags.length > 0 },
    contact: { label: 'Contact info', complete: !!(profile.website || profile.linkedinUrl || profile.phone) },
  };

  const completed = Object.values(sections).filter((s) => s.complete).length;
  const score = Math.round((completed / Object.keys(sections).length) * 100);
  return { score, sections };
}

export function formatDateRange(startDate: string, endDate?: string | null, current?: boolean): string {
  const fmt = (d: string) => {
    const [year, month] = d.split('-');
    if (!month) return year;
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };
  const start = fmt(startDate);
  const end = current ? 'Present' : endDate ? fmt(endDate) : 'Present';
  return `${start} – ${end}`;
}
