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
   *  /api/profile — connection first, legacy Person-id second). */
  connected?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A career/experience entry. Stored as `metadata.experience: ExperienceEntry[]`
 * on the Person row — no dedicated table, the profile PATCH already round-trips
 * metadata.
 */
export interface ExperienceEntry {
  id: string;
  title: string;
  org: string;
  /** 'YYYY-MM' */
  start: string;
  /** 'YYYY-MM', or null/undefined while `current` */
  end?: string | null;
  current?: boolean;
  location?: string | null;
  description?: string | null;
}

/** Parse metadata.experience defensively (metadata is untyped JSON). */
export function getExperience(profile: FullProfile): ExperienceEntry[] {
  const raw = profile.metadata?.experience;
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is ExperienceEntry =>
    !!e && typeof e === 'object' &&
    typeof (e as ExperienceEntry).title === 'string' &&
    typeof (e as ExperienceEntry).org === 'string' &&
    typeof (e as ExperienceEntry).start === 'string'
  );
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM' → 'Mar 2024' (returns the input when unparseable). */
export function formatYearMonth(ym?: string | null): string {
  if (!ym) return '';
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  const month = MONTHS_SHORT[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : m[1];
}

/** Inclusive duration between two 'YYYY-MM' stamps → '2 yr 4 mo'. */
export function formatDuration(start: string, end?: string | null): string {
  const parse = (ym: string) => {
    const m = /^(\d{4})-(\d{2})$/.exec(ym);
    return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
  };
  const s = parse(start);
  const now = new Date();
  const e = end ? parse(end) : now.getFullYear() * 12 + now.getMonth();
  if (s === null || e === null || e < s) return '';
  const total = e - s + 1;
  const yr = Math.floor(total / 12);
  const mo = total % 12;
  const bits = [yr > 0 && `${yr} yr`, mo > 0 && `${mo} mo`].filter(Boolean);
  return bits.join(' ') || '1 mo';
}

/** Newest-first: current roles first, then by start descending. */
export function sortExperience(entries: ExperienceEntry[]): ExperienceEntry[] {
  return [...entries].sort((a, b) => {
    const aCur = a.current && !a.end ? 1 : 0;
    const bCur = b.current && !b.end ? 1 : 0;
    if (aCur !== bCur) return bCur - aCur;
    return b.start.localeCompare(a.start);
  });
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
    experience: { label: 'Experience', complete: getExperience(profile).length > 0 },
    skills: { label: 'Skills', complete: profile.tags.length > 0 },
    contact: { label: 'Contact info', complete: !!(profile.website || profile.linkedinUrl || profile.phone) },
  };

  const completed = Object.values(sections).filter((s) => s.complete).length;
  const score = Math.round((completed / Object.keys(sections).length) * 100);
  return { score, sections };
}
