import type { ReactNode } from 'react';
import PaneShell from '@/features/shared/components/pane/PaneShell';

// Discover wears the same pane chrome as the Directory: its views are the tab
// bar at the top of the pane, registered by the page (usePaneChrome).
export default function DiscoverLayout({ children }: { children: ReactNode }) {
  return <PaneShell>{children}</PaneShell>;
}
