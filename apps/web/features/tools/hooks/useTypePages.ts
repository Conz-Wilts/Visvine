'use client';

/**
 * The type-page dispatch, as the pages ask it.
 *
 * Everything comes off the space DTO the shell already hydrated with
 * (`useSpace().currentSpace.installedTools`), so a note or a profile learns
 * which Tool draws its surface without a fetch and without a second loading
 * state. The rules themselves live in lib/tools/typePages.ts — this file is the
 * React seam and the memo.
 */

import { useMemo } from 'react';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import {
  runnableInstalls,
  typePagesFor,
  typeTabsFor,
  type TypePageClaim,
  type TypePageOwner,
} from '@/lib/tools/typePages';
import type { SpaceFeatureConfig } from '@/lib/types';

/** The installs this viewer may run — locked and pulled-back Tools draw nothing. */
function useRunnable() {
  const { currentSpace, isAdmin } = useSpace();
  const installs = currentSpace?.installedTools;
  const config = (currentSpace?.featureConfig as SpaceFeatureConfig | undefined) ?? null;
  return useMemo(() => runnableInstalls(installs, config, isAdmin), [installs, config, isAdmin]);
}

/** Every context type an installed Tool claims, resolved: type → who draws it. */
export function useTypePages(): Record<string, TypePageClaim> {
  const installs = useRunnable();
  return useMemo(() => typePagesFor(installs), [installs]);
}

/** The Tools adding a tab to this type's built-in page — usually none. */
export function useTypeTabs(typeName: string | null | undefined): TypePageOwner[] {
  const installs = useRunnable();
  return useMemo(() => typeTabsFor(installs, typeName), [installs, typeName]);
}
