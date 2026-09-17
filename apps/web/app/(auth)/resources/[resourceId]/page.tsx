'use client';

import { use, useEffect, useState } from 'react';
import { useSpaceRouter } from '@/features/shared/hooks/useSpaceRouter';
import ResourceFile from '@/features/resources/components/ResourceFile';
import { fetchJson } from '@/lib/fetchJson';

/**
 * A file's own URL. A file is shown on its Resource's page, so this sends the
 * browser there; a file with no Resource yet is shown here as it is.
 */
export default function ResourceFilePage({ params }: { params: Promise<{ resourceId: string }> }) {
  const { resourceId: raw } = use(params);
  const resourceId = decodeURIComponent(raw);
  const router = useSpaceRouter();
  const [unlinked, setUnlinked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ nodeId: string | null }>(`/api/resources/${encodeURIComponent(resourceId)}`)
      .then(({ nodeId }) => {
        if (cancelled) return;
        if (nodeId) router.replace(`/directory/${encodeURIComponent(nodeId)}`);
        else setUnlinked(true);
      })
      .catch(() => { if (!cancelled) setUnlinked(true); });
    return () => { cancelled = true; };
  }, [resourceId, router]);

  return unlinked ? <ResourceFile resourceId={resourceId} /> : null;
}
