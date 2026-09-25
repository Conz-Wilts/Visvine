import type { ReactNode } from 'react';
import { Tabs as UITabs } from '@visvine/ui';

export interface TabItem {
  id: string;
  label: ReactNode;
}

export interface TabsProps {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

/**
 * The app's tabs (@visvine/ui): words with the accent underline sliding
 * beneath the active one. Controlled — the Tool owns which tab is active. For
 * a Tool's own top-level sections, declare `surfaces.nav` instead: the host
 * draws them on the band.
 */
export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  return (
    <UITabs
      options={tabs.map((tab) => ({ id: tab.id, label: typeof tab.label === 'string' ? tab.label : String(tab.label ?? tab.id) }))}
      value={active}
      onChange={onChange}
      className={className}
    />
  );
}
