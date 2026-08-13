'use client';

import { useEffect, useRef } from 'react';
import { useCommunity } from './CommunityContext';
import type { CommunityDesignConfig } from '@/lib/types';

// Titles default to the body face, not the Visvine brand font: ABC Ginto
// Rounded is the wordmark, reserved for marketing surfaces. A community that
// uploads its own `main` font repaints .font-title and nothing else.
const DEFAULT_MAIN_FONT = "'Open Sauce One', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const DEFAULT_UTILITY_FONT = "'Open Sauce One', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

const STYLE_ID = 'community-design-fonts';

export function CommunityDesignProvider({ children }: { children: React.ReactNode }) {
  const { currentCommunity } = useCommunity();
  const prevCommunityId = useRef<string | null>(null);

  const designConfig = (currentCommunity?.designConfig as CommunityDesignConfig) ?? null;

  // Apply font overrides
  useEffect(() => {
    const root = document.documentElement;

    // Clean up previous
    const existingStyle = document.getElementById(STYLE_ID);
    if (existingStyle) existingStyle.remove();

    const fonts = designConfig?.fonts;

    if (fonts?.main || fonts?.utility) {
      const rules: string[] = [];

      if (fonts.main) {
        rules.push(`
          @font-face {
            font-family: '${fonts.main.name}';
            src: url('${fonts.main.url}') format('${fonts.main.format}');
            font-weight: 100 950;
            font-style: normal;
            font-display: swap;
          }
        `);
        root.style.setProperty('--font-main', `'${fonts.main.name}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`);
      } else {
        root.style.setProperty('--font-main', DEFAULT_MAIN_FONT);
      }

      if (fonts.utility) {
        rules.push(`
          @font-face {
            font-family: '${fonts.utility.name}';
            src: url('${fonts.utility.url}') format('${fonts.utility.format}');
            font-weight: 100 950;
            font-style: normal;
            font-display: swap;
          }
        `);
        root.style.setProperty('--font-utility', `'${fonts.utility.name}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`);
      } else {
        root.style.setProperty('--font-utility', DEFAULT_UTILITY_FONT);
      }

      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = rules.join('\n');
      document.head.appendChild(style);
    } else {
      root.style.setProperty('--font-main', DEFAULT_MAIN_FONT);
      root.style.setProperty('--font-utility', DEFAULT_UTILITY_FONT);
    }

    prevCommunityId.current = currentCommunity?.id ?? null;

    return () => {
      const el = document.getElementById(STYLE_ID);
      if (el) el.remove();
      root.style.setProperty('--font-main', DEFAULT_MAIN_FONT);
      root.style.setProperty('--font-utility', DEFAULT_UTILITY_FONT);
    };
  }, [currentCommunity?.id, designConfig]);

  return <>{children}</>;
}
