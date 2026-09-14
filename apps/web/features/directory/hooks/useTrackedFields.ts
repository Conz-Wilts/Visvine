'use client';

import { useCallback, useState } from 'react';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { fetchJsonBody } from '@/lib/fetchJson';
import { addTrackedField, removeTrackedField, updateTrackedField, type TrackedFieldResult } from '@/lib/directory/table';
import {
  findNodeTypeConfig,
  mergeNodeTypeList,
  seedNodeTypes,
  type NodeTypeConfig,
  type Space,
  type TrackedFieldKind,
} from '@/lib/types';

/**
 * Extending a type with fields, from the table. The schema rides the space's
 * type vocabulary (`NodeTypeConfig.fields`), saved the way the console saves
 * a recolour: the whole record, merged additively on the server so a stale
 * snapshot can't drop a type a member added meanwhile. Admins only — what a
 * space tracks about a type is a decision about the space, not a preference.
 */
export function useTrackedFields() {
  const { currentSpace, refreshSpace, isAdmin } = useSpace();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configFor = useCallback(
    (type: string): NodeTypeConfig | null => findNodeTypeConfig(type, currentSpace?.nodeTypes),
    [currentSpace?.nodeTypes],
  );

  const commit = useCallback(
    async (result: TrackedFieldResult | NodeTypeConfig): Promise<boolean> => {
      if (!currentSpace) return false;
      const next = 'ok' in result ? (result.ok ? result.config : null) : result;
      if (!next) {
        setError('ok' in result && !result.ok ? result.error : 'Could not save');
        return false;
      }
      setSaving(true);
      setError(null);
      try {
        // Start from the seeded list: a space that never stored its types has
        // a null column, and merging one edited entry onto null would make
        // that entry the whole vocabulary.
        const space: Space = {
          ...currentSpace,
          nodeTypes: mergeNodeTypeList(seedNodeTypes(currentSpace.nodeTypes), [next]),
        };
        await fetchJsonBody('/api/data/spaces', 'PUT', { space });
        await refreshSpace();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [currentSpace, refreshSpace],
  );

  const add = useCallback(
    (type: string, input: { label: string; kind: TrackedFieldKind; options?: string[] }) => {
      const config = configFor(type);
      if (!config) {
        setError('Unknown type');
        return Promise.resolve(false);
      }
      return commit(addTrackedField(config, input));
    },
    [configFor, commit],
  );

  const update = useCallback(
    (type: string, key: string, patch: { label?: string; options?: string[] }) => {
      const config = configFor(type);
      if (!config) {
        setError('Unknown type');
        return Promise.resolve(false);
      }
      return commit(updateTrackedField(config, key, patch));
    },
    [configFor, commit],
  );

  const remove = useCallback(
    (type: string, key: string) => {
      const config = configFor(type);
      if (!config) return Promise.resolve(false);
      return commit(removeTrackedField(config, key));
    },
    [configFor, commit],
  );

  const clearError = useCallback(() => setError(null), []);

  return { canEdit: isAdmin, saving, error, clearError, add, update, remove };
}
