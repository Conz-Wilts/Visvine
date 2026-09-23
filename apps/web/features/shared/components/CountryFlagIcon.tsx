'use client';

import React, { useState } from 'react';
import { countryCodeToFlag, getCountry } from '@/lib/countries';

/**
 * Flag for an ISO country code, drawn as an SVG image because Windows ships no
 * flag emoji glyphs — the regional-indicator pair renders as the bare letters
 * ("NZ") there instead of a flag. Falls back to the emoji if the image can't
 * load, which is the right answer on platforms that do have the glyphs.
 *
 * `CountryFlag` (components/profile) is the free-text sibling of this: it
 * matches a country out of a location string, then renders this.
 */
export default function CountryFlagIcon({
  code,
  className = '',
}: {
  code: string;
  /** Sizing/spacing for the flag box; defaults to the inline 19×14 chip. */
  className?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const country = getCountry(code);
  if (!country) return null;

  if (imgFailed) {
    return <span aria-hidden className={className}>{countryCodeToFlag(country.code)}</span>;
  }
  return (
    <img
      src={`https://flagcdn.com/${country.code.toLowerCase()}.svg`}
      alt=""
      title={country.name}
      loading="lazy"
      onError={() => setImgFailed(true)}
      className={`inline-block shrink-0 rounded-[3px] object-cover ring-1 ring-black/10 ${className || 'w-[19px] h-[14px]'}`}
    />
  );
}
