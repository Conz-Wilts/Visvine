'use client';

import React, { useState } from 'react';
import { matchCountryInLocation, countryCodeToFlag } from '@/lib/countries';

/**
 * Small country flag derived from a free-text location ("Auckland, New
 * Zealand" → 🇳🇿). Renders an SVG flag image because Windows has no flag
 * emoji glyphs; falls back to the emoji (and finally to nothing) if the
 * image can't load. Renders null when no country is detectable.
 */
export default function CountryFlag({ location, className = '' }: { location?: string | null; className?: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const country = matchCountryInLocation(location);
  if (!country) return null;

  if (imgFailed) {
    return <span aria-hidden className={className}>{countryCodeToFlag(country.code)}</span>;
  }
  return (
    <img
      src={`https://flagcdn.com/${country.code.toLowerCase()}.svg`}
      alt={country.name}
      title={country.name}
      loading="lazy"
      onError={() => setImgFailed(true)}
      className={`inline-block w-[19px] h-[14px] rounded-[3px] object-cover ring-1 ring-black/10 ${className}`}
    />
  );
}
