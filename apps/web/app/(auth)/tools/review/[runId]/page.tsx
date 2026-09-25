'use client';

// The page Visvine's dynamic run opens (lib/tools/review): the version under
// review, full-size, in its honeypot, as the review runner. Nobody else can
// resolve its target, so for anyone else it is a Tool that is not there.

import { useParams } from 'next/navigation';
import ToolFrame from '@/features/tools/components/ToolFrame';

export default function ToolReviewRoute() {
  const params = useParams<{ runId: string }>();
  const runId = Array.isArray(params.runId) ? params.runId[0] : params.runId;
  if (!runId) return null;
  return <ToolFrame target={{ kind: 'review', runId }} title="Review" mode="page" className="h-full" />;
}
