'use client';

import { createContext, useContext, type ComponentType, type CSSProperties, type ReactNode } from 'react';

/**
 * The two things a component library cannot know about the app it runs in: how
 * the app links (a router, a space prefix) and how it draws an image (an
 * optimiser, a CDN). The app hands its own over once, at the root; every
 * component that links or draws an image reads them from here, and without a
 * provider they are a plain `<a>` and `<img>`.
 */

export interface UILinkProps {
  href: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  onClick?: () => void;
}

export interface UIImageProps {
  src: string;
  alt: string;
  /** Intrinsic size in px — square images need one number. */
  width: number;
  height: number;
  className?: string;
  style?: CSSProperties;
}

interface UIAdapters {
  Link: ComponentType<UILinkProps>;
  Image: ComponentType<UIImageProps>;
}

function PlainLink({ href, children, ...rest }: UILinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

function PlainImage(props: UIImageProps) {
  return <img {...props} />;
}

const UIContext = createContext<UIAdapters>({ Link: PlainLink, Image: PlainImage });

export function UIProvider({
  link,
  image,
  children,
}: {
  link?: ComponentType<UILinkProps>;
  image?: ComponentType<UIImageProps>;
  children: ReactNode;
}) {
  return (
    <UIContext.Provider value={{ Link: link ?? PlainLink, Image: image ?? PlainImage }}>
      {children}
    </UIContext.Provider>
  );
}

/** The app's link and image components, or the plain defaults. */
export function useUIAdapters(): UIAdapters {
  return useContext(UIContext);
}
