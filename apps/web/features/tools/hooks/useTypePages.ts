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
  typePagesFor,
  typeTabsFor,
  type TypePageClaim,
  type TypePageOwner,
} from '@/lib/tools/typePages';

/** Every context type an installed Tool claims, resolved: type → who draws it. */
export function useTypePages(): Record<string, TypePageClaim> {
  const { currentSpace } = useSpace();
  const installs = currentSpace?.installedTools;
  return useMemo(() => typePagesFor(installs), [installs]);
}

/** The Tools adding a tab to this type's built-in page — usually none. */
export function useTypeTabs(typeName: string | null | undefined): TypePageOwner[] {
  const { currentSpace } = useSpace();
  const installs = currentSpace?.installedTools;
  return useMemo(() => typeTabsFor(installs, typeName), [installs, typeName]);
}
