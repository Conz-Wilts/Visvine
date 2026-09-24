import type { ResourceView } from '@/lib/resources/shared/view';
import type { ZoomState } from '@visvine/ui';

/** What every renderer is given: the resource, the viewer's mode, and zoom where it zooms. */
export interface RendererProps {
  resource: ResourceView;
  full: boolean;
  zoom: ZoomState;
  onZoom: (next: ZoomState) => void;
}
