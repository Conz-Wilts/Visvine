'use client';

// An installed Tool's full-pane page. Kept to the route plumbing — the deciding
// logic (resolving the install, the 404 state, the header) is in
// features/tools/components/ToolPage.tsx, like every other surface here.
//
// `/t/` rather than `/tools/<slug>`: `/tools/preview/<name>` is a working
// copy's page, and an installed Tool's slug must never be able to shadow it.

import { useParams } from 'next/navigation';
import ToolPage from '@/features/tools/components/ToolPage';

export default function ToolRoute() {
  const params = useParams<{ slug: string }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  return <ToolPage slug={slug ?? ''} />;
}
