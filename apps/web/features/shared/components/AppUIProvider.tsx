'use client';

import type { ReactNode } from 'react';
import NextImage from 'next/image';
import { UIProvider, type UIImageProps, type UILinkProps } from '@visvine/ui';
import SpaceLink from '@/features/shared/components/SpaceLink';
import { isOptimizableImageUrl } from '@/lib/mediaUrl';

/** @visvine/ui's links go through SpaceLink, so they stay in the space being stood in. */
function AppLink({ href, ...props }: UILinkProps) {
  return <SpaceLink href={href} {...props} />;
}

/** @visvine/ui's images go through next/image where the optimiser can reach them. */
function AppImage({ src, alt, ...props }: UIImageProps) {
  // Local blob previews and inline data URLs cannot go through the optimiser.
  if (src.startsWith('data:') || src.startsWith('blob:')) {
    return <img src={src} alt={alt} {...props} />;
  }
  return (
    <NextImage
      src={src}
      alt={alt}
      {...props}
      // The optimiser re-encodes what the upload already wrote as WebP, and at
      // the default 75 that second pass is what shows on a face.
      quality={90}
      // Hosts outside next.config remotePatterns (e.g. the server-only GCS CDN
      // hostname) render unoptimised rather than throwing.
      unoptimized={!isOptimizableImageUrl(src)}
    />
  );
}

/** Hands the shared components this app's link and image. Mounted once, at the root. */
export default function AppUIProvider({ children }: { children: ReactNode }) {
  return (
    <UIProvider link={AppLink} image={AppImage}>
      {children}
    </UIProvider>
  );
}
