'use client';

// A Tool's preview page. Kept to the route plumbing — the deciding logic lives in
// features/tools/components/PreviewPage.tsx, like every other surface.
//
// This path is load-bearing beyond the URL bar: it is what
// `visvine-desktop://open/tools/preview/<name>` resolves to, and what
// `create_tool` / `preview_tool` hand an authoring agent to hand back to the
// person it is working for. Renaming it breaks those links.

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import PreviewPage from '@/features/tools/components/PreviewPage';

export default function ToolPreviewRoute() {
  const params = useParams<{ name: string }>();
  const name = Array.isArray(params.name) ? params.name[0] : params.name;
  return (
    <Suspense>
      {name && <PreviewPage name={name} />}
    </Suspense>
  );
}
