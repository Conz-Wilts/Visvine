'use client';

import { useSyncExternalStore } from 'react';

const subscribe = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
};
const read = () => document.visibilityState !== 'hidden';
const readServer = () => true;

/**
 * Whether the tab is on screen. A poll or a ticking clock puts this in its
 * effect's deps and skips the timer while false: a background tab then costs
 * nothing, and the effect re-running on the flip back to true is the catch-up
 * read, so what it shows is current the moment the tab is.
 */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, read, readServer);
}
