'use client';

// A Tool working copy's preview page. Kept to the route plumbing — the deciding
// logic (resolving the tool, the build strip, the unavailable states) lives in
// features/tools/components/ToolPreview.tsx, like every other surface here.
//
// This path is load-bearing beyond the URL bar: it is what
// `visvine-desktop://open/tools/preview/<name>` resolves to, and what
// `create_tool` / `preview_tool` hand an authoring agent to hand back to the
// person it is working for. Renaming it breaks those links.

import { useParams } from 'next/navigation';
import ToolPreview from '@/features/tools/components/ToolPreview';

export default function ToolPreviewRoute() {
  const params = useParams<{ name: string }>();
  const name = Array.isArray(params.name) ? params.name[0] : params.name;
  return <ToolPreview name={name ?? ''} />;
}
