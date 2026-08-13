'use client';

import { createContext, useContext } from 'react';

/**
 * Factory for the common "context + guarded hook" pattern. Creates a context
 * with no default value and a hook that throws a descriptive error when called
 * outside `<{name}Provider>` — replacing the copy-pasted
 * `createContext(undefined)` + "useX must be used within XProvider" boilerplate.
 *
 * Contexts that intentionally work outside their provider (i.e. ship a real
 * default value) should keep using `createContext` directly.
 *
 * @param name     Base name, e.g. 'Space' → error mentions SpaceProvider.
 * @param hookName Name used in the error message; defaults to `use{name}`.
 *                 Pass explicitly when the public hook is named differently
 *                 (e.g. useProfileCache for ProfileProvider).
 */
export function createSafeContext<T>(name: string, hookName: string = `use${name}`) {
  const Context = createContext<T | undefined>(undefined);
  Context.displayName = `${name}Context`;

  function useSafeContext(): T {
    const ctx = useContext(Context);
    if (ctx === undefined) {
      throw new Error(`${hookName} must be used within ${name}Provider`);
    }
    return ctx;
  }

  return [Context, useSafeContext] as const;
}
