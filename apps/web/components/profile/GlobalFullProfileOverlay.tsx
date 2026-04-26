'use client';

import { useFullProfile } from '@/lib/contexts/FullProfileContext';
import FullProfileOverlay from './FullProfileOverlay';

export default function GlobalFullProfileOverlay() {
  const { openNodeId, closeProfile } = useFullProfile();

  return (
    <FullProfileOverlay
      nodeId={openNodeId}
      onClose={closeProfile}
    />
  );
}
