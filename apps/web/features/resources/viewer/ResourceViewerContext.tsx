'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import ResourceViewerHost from './ResourceViewerHost';

interface ResourceViewerApi {
  /** Open a resource; `list` is what ← → walk (the grid, the channel's files). */
  open: (resourceId: string, list?: string[]) => void;
  close: () => void;
}

const Ctx = createContext<ResourceViewerApi | null>(null);

/** Opening the viewer from anywhere under the provider. */
export function useResourceViewer(): ResourceViewerApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useResourceViewer needs a ResourceViewerProvider');
  return api;
}

/** Set the viewer's URL params without a navigation: the page underneath stays as it is. */
function writeParams(mutate: (params: URLSearchParams) => void, push: boolean) {
  const url = new URL(window.location.href);
  mutate(url.searchParams);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (push) window.history.pushState(null, '', next);
  else window.history.replaceState(null, '', next);
}

/**
 * The resources viewer, over any page. Its state is the URL — `?resource=<id>`
 * and `&full=1` — so Back closes it, a copied link opens it, and a reload
 * keeps it; the list it walks is held here, since a URL of every id would not
 * fit.
 */
export function ResourceViewerProvider({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const resourceId = params.get('resource');
  const full = params.get('full') === '1';
  const [list, setList] = useState<string[]>([]);

  const open = useCallback((id: string, next?: string[]) => {
    setList(next ?? []);
    const already = new URL(window.location.href).searchParams.has('resource');
    writeParams((p) => p.set('resource', id), !already);
  }, []);

  const close = useCallback(() => {
    writeParams((p) => {
      p.delete('resource');
      p.delete('full');
    }, false);
  }, []);

  const api = useMemo(() => ({ open, close }), [open, close]);

  const index = resourceId ? list.indexOf(resourceId) : -1;
  const step = (delta: number) => {
    const next = list[index + delta];
    if (next) writeParams((p) => p.set('resource', next), false);
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      {resourceId && (
        <ResourceViewerHost
          resourceId={resourceId}
          full={full}
          onModeChange={(mode) => writeParams((p) => (mode === 'full' ? p.set('full', '1') : p.delete('full')), false)}
          onClose={close}
          onPrev={index > 0 ? () => step(-1) : null}
          onNext={index >= 0 && index < list.length - 1 ? () => step(1) : null}
          position={index >= 0 && list.length > 1 ? `${index + 1} of ${list.length}` : null}
        />
      )}
    </Ctx.Provider>
  );
}
