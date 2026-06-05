'use client';

interface Tab<T extends string = string> {
  id: T;
  label: string;
}

interface TabNavProps<T extends string = string> {
  tabs: Tab<T>[];
  activeTab: T;
  onTabChange: (id: T) => void;
  className?: string;
  /** Horizontally center the tabs (defaults to left-aligned). */
  center?: boolean;
}

export default function TabNav<T extends string = string>({
  tabs,
  activeTab,
  onTabChange,
  className = '',
  center = false,
}: TabNavProps<T>) {
  return (
    <div className={`border-b border-border-subtle ${className}`}>
      <nav className={`-mb-px flex space-x-8 ${center ? 'justify-center' : ''}`}>
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === id
                ? 'border-brand-green text-brand-green'
                : 'border-transparent text-text-muted hover:text-text-secondary hover:border-border-default'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
