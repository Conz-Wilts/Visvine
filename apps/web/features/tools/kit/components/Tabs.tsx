import type { ReactNode } from 'react';
import { cx } from './cx';

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

/** Controlled: the Tool owns which tab is active, so it can put it in state. */
export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  return (
    <div className={cx('vv-tabs', className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          className={cx('vv-tab', tab.id === active && 'vv-tab--active')}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
