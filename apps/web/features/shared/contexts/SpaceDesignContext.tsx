'use client';

import { useEffect, useRef } from 'react';
import { useSpace } from './SpaceContext';
import type { SpaceDesignConfig } from '@/lib/types';

// Titles default to the body face, not the Visvine brand font: ABC Ginto
// Rounded is the wordmark, reserved for marketing surfaces. A space that
// uploads its own `main` font repaints .font-title and nothing else.
const DEFAULT_MAIN_FONT = "'Open Sauce One', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const DEFAULT_UTILITY_FONT = "'Open Sauce One', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

const STYLE_ID = 'space-design-fonts';

export function SpaceDesignProvider({ children }: { children: React.ReactNode }) {
  const { currentSpace } = useSpace();
  const prevSpaceId = useRef<string | null>(null);

  const designConfig = (currentSpace?.designConfig as SpaceDesignConfig) ?? null;

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

    prevSpaceId.current = currentSpace?.id ?? null;

    return () => {
      const el = document.getElementById(STYLE_ID);
      if (el) el.remove();
      root.style.setProperty('--font-main', DEFAULT_MAIN_FONT);
      root.style.setProperty('--font-utility', DEFAULT_UTILITY_FONT);
    };
  }, [currentSpace?.id, designConfig]);

  return <>{children}</>;
}
