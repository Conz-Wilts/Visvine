'use client';

// Runs the one-time post-onboarding guided tour. The onboarding wizard sets a
// `nb_onboarding_tour` flag in localStorage on completion; this launcher then
// walks the new member through the product across several *pages* — the directory,
// their Community Console, and their own profile — spotlighting each surface with
// driver.js and explaining what it's for.
//
// A driver.js tour can't survive a route change, so we run the tour as a series of
// "legs" (one driver instance per page). Progress is persisted in `nb_tour_index`;
// when a leg finishes we bump the index, router.push() to the next page, and the
// launcher (mounted in the auth shell, so present on every page) re-fires and runs
// the next leg. Steps whose target is missing (a switched-off feature, a
// non-admin community) are skipped so the tour always stays coherent.

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth-client';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

const TOUR_FLAG = 'nb_onboarding_tour';
const TOUR_INDEX = 'nb_tour_index';

type Leg = 'directory' | 'console' | 'profile';

interface TourStep {
  leg: Leg;
  selector: string;
  title: string;
  description: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

// Ordered across all legs. The launcher groups consecutive same-leg steps into a
// single driver instance and navigates between legs on the boundary.
const TOUR_STEPS: TourStep[] = [
  // ── Leg 1: the directory (where the user lands after onboarding) ──
  {
    leg: 'directory',
    selector: '[data-tour="nav-directory"]',
    title: 'Your directory',
    description:
      'This is the heart of Visvine: everyone and everything in your community, as a searchable grid of cards.',
    side: 'right',
    align: 'start',
  },
  {
    leg: 'directory',
    selector: '[data-tour="directory-canvas"]',
    title: 'Browse your community',
    description:
      'Browse people and organisations as cards. Search and filter from the bar up top to find anyone fast.',
    side: 'top',
    align: 'center',
  },
  {
    // Context is its own tool now: the /context page hosts the community
    // context plus the notes tree, and every person/organization profile
    // carries a Context tab.
    leg: 'directory',
    selector: '[data-tour="nav-notes"]',
    title: 'Context: your community brain',
    description:
      'Open Context to see the community as an interactive map and capture notes about the people and companies here. Link them with [[ ]] to build up your map — every profile carries its context too.',
    side: 'right',
    align: 'start',
  },
  {
    leg: 'directory',
    selector: '[data-tour="create"]',
    title: 'Add anything',
    description:
      'People, organisations, notes, events and more, all created from this one button.',
    side: 'right',
    align: 'start',
  },
  {
    leg: 'directory',
    selector: '[data-tour="community-switcher"]',
    title: 'This is your community',
    description:
      'Your home base, where all your connections live. Click here anytime to switch between your personal space and any other communities you join.',
    side: 'bottom',
    align: 'start',
  },
  {
    leg: 'directory',
    selector: '[data-tour="community-console"]',
    title: 'Manage your community',
    description:
      'This gear opens your Community Console. Let’s take a quick look. Click Next.',
    side: 'bottom',
    align: 'start',
  },
  // ── Leg 2: the Community Console (/admin) ──
  {
    leg: 'console',
    selector: '[data-tour="console-tabs"]',
    title: 'Your Community Console',
    description:
      'This is where you run your community and manage all your connections: invite and manage members, change the look & feel, and see activity. Next, let’s look at your own profile.',
    side: 'bottom',
    align: 'center',
  },
  // ── Leg 3: the user's own profile (/directory/<nodeId>) ──
  {
    leg: 'profile',
    selector: '[data-tour="profile-hero"]',
    title: 'This is your profile',
    description:
      'This is how you show up to everyone else in your community: your photo, headline, bio and links.',
    side: 'bottom',
    align: 'center',
  },
  {
    leg: 'profile',
    selector: '[data-tour="profile-edit"]',
    title: 'Keep it up to date',
    description:
      'Hit Edit profile anytime to update your photo, headline, bio, skills and contact details. That’s the tour. You’re all set!',
    side: 'left',
    align: 'start',
  },
];

/** Concrete pathname a leg lives on, or null if it can't be reached (e.g. no nodeId). */
function legRoute(leg: Leg, nodeId: string | null): string | null {
  switch (leg) {
    case 'directory':
      return '/directory';
    case 'console':
      return '/admin';
    case 'profile':
      return nodeId ? `/directory/${nodeId}` : null;
  }
}

/** Is the current pathname the right page for this leg? */
function legMatches(leg: Leg, pathname: string): boolean {
  switch (leg) {
    case 'directory':
      return pathname === '/directory';
    case 'console':
      return pathname === '/admin';
    case 'profile':
      // Any individual profile/detail page under /directory/<id>.
      return pathname.startsWith('/directory/');
  }
}

function readIndex(): number {
  try {
    const raw = localStorage.getItem(TOUR_INDEX);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeIndex(i: number): void {
  try {
    localStorage.setItem(TOUR_INDEX, String(i));
  } catch {}
}

function clearTour(): void {
  try {
    localStorage.removeItem(TOUR_FLAG);
    localStorage.removeItem(TOUR_INDEX);
  } catch {}
}

// Module-level guard: the index we've already launched a driver leg for. Survives
// React Strict Mode's dev double-invoke (mount → cleanup → remount) so a leg starts
// exactly once, while still allowing the *next* leg to start after navigation.
let launchedIndex = -1;
// The index we've already pushed a "resume" navigation for. If we route to a leg's
// page but a guard bounces us elsewhere (e.g. a non-admin sent away from /admin),
// this lets us skip the leg instead of looping forever.
let resumeIndex = -1;

export default function TourLauncher() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const nodeId = session?.user?.nodeId ?? null;

  // Keep the latest values available to the async poll without re-subscribing.
  const routerRef = useRef(router);
  routerRef.current = router;
  const nodeIdRef = useRef(nodeId);
  nodeIdRef.current = nodeId;

  useEffect(() => {
    let flag: string | null = null;
    try {
      flag = localStorage.getItem(TOUR_FLAG);
    } catch {
      return;
    }
    if (flag !== '1') return;

    const index = readIndex();
    if (index >= TOUR_STEPS.length) {
      clearTour();
      return;
    }

    const leg = TOUR_STEPS[index].leg;

    // The contiguous run of steps that make up this leg.
    let runEnd = index;
    while (runEnd < TOUR_STEPS.length && TOUR_STEPS[runEnd].leg === leg) runEnd++;
    const legSteps = TOUR_STEPS.slice(index, runEnd);

    // Finish the tour: clear state, optionally send the user home.
    const completeTour = () => {
      clearTour();
      routerRef.current.push('/directory');
    };
    const abortTour = () => clearTour();

    // Move to `target` index, skipping any legs that can't be reached (no route),
    // then either finish or navigate to that leg's page.
    const goToIndex = (target: number) => {
      let i = target;
      while (i < TOUR_STEPS.length) {
        if (legRoute(TOUR_STEPS[i].leg, nodeIdRef.current)) break;
        const skip = TOUR_STEPS[i].leg;
        while (i < TOUR_STEPS.length && TOUR_STEPS[i].leg === skip) i++;
      }
      writeIndex(i);
      if (i >= TOUR_STEPS.length) {
        completeTour();
        return;
      }
      const route = legRoute(TOUR_STEPS[i].leg, nodeIdRef.current);
      if (route) routerRef.current.push(route);
      else completeTour();
    };

    // If we're not on this leg's page yet (e.g. the user reloaded or navigated
    // away mid-tour), send them to the right page and let the effect re-fire.
    if (!legMatches(leg, pathname)) {
      const route = legRoute(leg, nodeIdRef.current);
      if (!route) {
        goToIndex(runEnd); // leg unreachable (no nodeId) → skip it
      } else if (resumeIndex === index) {
        // We already routed here once and didn't land — a guard bounced us
        // (e.g. non-admin from /admin). Skip the leg rather than loop.
        goToIndex(runEnd);
      } else if (route !== pathname) {
        resumeIndex = index;
        routerRef.current.push(route);
      }
      return;
    }

    if (launchedIndex === index) return;
    resumeIndex = -1;

    // Poll for the leg's targets to appear (they may render a beat after navigation),
    // then launch the driver from whichever targets are actually present.
    let cancelled = false;
    let tries = 0;
    let timer: number | undefined;

    const launch = () => {
      const present = legSteps.filter((s) => document.querySelector(s.selector));
      if (present.length === 0) {
        // Nothing to show on this leg (feature off / not admin) → skip to the next.
        goToIndex(runEnd);
        return;
      }

      launchedIndex = index;

      const d = driver({
        showProgress: true,
        overlayColor: 'rgba(17, 24, 39, 0.55)',
        popoverClass: 'visvine-tour',
        nextBtnText: 'Next',
        prevBtnText: 'Back',
        doneBtnText: runEnd >= TOUR_STEPS.length ? 'Finish' : 'Next',
        steps: present.map((s) => ({
          element: s.selector,
          popover: { title: s.title, description: s.description, side: s.side, align: s.align },
        })),
        // Taking over destroy lets us tell "finished this leg" (Done on the last
        // step) from "closed early" (the × on any earlier step). We must destroy
        // manually once this hook is set.
        onDestroyStarted: () => {
          const finishedLeg = !d.hasNextStep();
          d.destroy();
          if (finishedLeg) goToIndex(runEnd);
          else abortTour();
        },
      });
      d.drive();
    };

    const attempt = () => {
      if (cancelled) return;
      if (legSteps.some((s) => document.querySelector(s.selector))) {
        launch();
      } else if (tries++ < 40) {
        timer = window.setTimeout(attempt, 150);
      } else {
        // Targets never showed up — don't strand the tour; skip the leg.
        goToIndex(runEnd);
      }
    };

    // Let entrance animations settle before the first attempt.
    timer = window.setTimeout(attempt, 400);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
