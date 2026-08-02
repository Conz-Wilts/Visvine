'use client';

import React from 'react';
import { matchCountryInLocation } from '@/lib/countries';
import CountryFlagIcon from '@/components/ui/CountryFlagIcon';

/**
 * Small country flag derived from a free-text location ("Auckland, New
 * Zealand" → 🇳🇿). Renders null when no country is detectable; the drawing
 * itself is CountryFlagIcon's job.
 */
export default function CountryFlag({ location, className = '' }: { location?: string | null; className?: string }) {
  const country = matchCountryInLocation(location);
  if (!country) return null;
  return <CountryFlagIcon code={country.code} className={className || 'w-[19px] h-[14px]'} />;
}
