'use client';

import { use } from 'react';
import SpaceOverview from '@/features/spaces/components/SpaceOverview';

export default function SpaceDetailPage({ params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = use(params);
  return <SpaceOverview spaceId={decodeURIComponent(spaceId)} />;
}
