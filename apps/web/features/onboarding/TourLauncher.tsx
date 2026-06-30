'use client';

// Runs the one-time post-onboarding feature tour. The onboarding wizard sets a
// `nb_onboarding_tour` flag in localStorage on completion; once the user lands on
// an authenticated page whose nav targets exist, we spotlight them with driver.js
// and clear the flag so it never runs again. Steps whose target is missing (a
// feature switched off) are skipped, so the tour always stays coherent.

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

const TOUR_FLAG = 'nb_onboarding_tour';

interface TourStep {
  selector: string;
  title: string;
  description: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

const TOUR_STEPS: TourStep[] = [
  {
    selector: '[data-tour="nav-directory"]',
    title: 'Your directory',
    description:
      'Everyone and everything in your space — explored as a searchable graph and table.',
    side: 'right',
    align: 'start',
  },
  {
    // The notes feature's registry key is "notes" (its nav label is "Context"),
    // so the Sidebar renders data-tour="nav-notes".
    selector: '[data-tour="nav-notes"]',
    title: 'Context — your personal brain',
    description:
      'Capture private notes and context here. Link people and ideas with [[ ]], and only you can see your personal notes.',
    side: 'right',
    align: 'start',
  },
  {
    selector: '[data-tour="create"]',
    title: 'Create anything',
    description: 'Add people, notes, events and more — all from one button.',
    side: 'right',
    align: 'start',
  },
  {
    selector: '[data-tour="community-switcher"]',
    title: 'Switch spaces',
    description:
      'Jump between your personal space and any communities you join from here.',
    side: 'bottom',
    align: 'start',
  },
];

/** Build + run the tour from whichever target elements are currently on the page. */
export function startTour(): void {
  if (typeof document === 'undefined') return;
  const steps = TOUR_STEPS.filter((s) => document.querySelector(s.selector)).map((s) => ({
    element: s.selector,
    popover: { title: s.title, description: s.description, side: s.side, align: s.align },
  }));
  if (steps.length === 0) return;

  const d = driver({
    showProgress: true,
    overlayColor: 'rgba(17, 24, 39, 0.6)',
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Got it',
    steps,
  });
  d.drive();
}

// Module-level guard so the tour runs at most once per app session, surviving
// React Strict Mode's dev double-invocation (which mounts → cleans up → remounts
// the effect) and any re-renders. Without this, the first run would consume the
// flag + schedule the tour, the cleanup would cancel it, and the second run would
// see an empty flag and bail — so the tour would silently never appear.
let tourStarted = false;

export default function TourLauncher() {
  // Re-check on navigation so the tour fires once the user reaches a page that
  // actually has the nav targets (e.g. /directory after onboarding).
  const pathname = usePathname();

  useEffect(() => {
    if (tourStarted) return;
    let flag: string | null = null;
    try {
      flag = localStorage.getItem(TOUR_FLAG);
    } catch {
      return;
    }
    if (flag !== '1') return;

    // Poll briefly for the nav targets (they may render a beat after navigation),
    // then start exactly once. The flag is only consumed when the tour actually
    // starts, so a cancelled attempt (Strict Mode cleanup) is safely retried.
    let cancelled = false;
    let tries = 0;
    const attempt = () => {
      if (cancelled || tourStarted) return;
      if (document.querySelector('[data-tour="nav-directory"]')) {
        tourStarted = true;
        try {
          localStorage.removeItem(TOUR_FLAG);
        } catch {}
        startTour();
      } else if (tries++ < 40) {
        window.setTimeout(attempt, 150);
      }
    };
    // Let the sidebar entrance animation settle before the first attempt.
    const t = window.setTimeout(attempt, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [pathname]);

  return null;
}
