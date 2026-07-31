import type { ReactNode } from 'react';
import PaneShell from '@/components/pane/PaneShell';

// Layouts persist across child navigations, which is what lets the pane-top tab
// bar, the toolbar portal host and the note surface survive moves between
// notes, profiles and the Directory index. See components/pane/PaneShell.tsx.
export default function DirectoryLayout({ children }: { children: ReactNode }) {
  return <PaneShell>{children}</PaneShell>;
}
