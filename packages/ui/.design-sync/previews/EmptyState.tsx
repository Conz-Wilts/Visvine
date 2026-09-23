import { EmptyState } from '@visvine/ui';

const ClipboardIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="M9 12h6M9 16h4" />
  </svg>
);

const PlugIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4" />
  </svg>
);

export const Default = () => (
  <div className="w-96">
    <EmptyState title="Nothing on yet" description="Public events from every space appear here." />
  </div>
);

export const Sizes = () => (
  <div className="w-96 divide-y divide-line-subtle">
    <EmptyState size="sm" title="No spaces match" description="Try a wider search." />
    <EmptyState size="md" title="Nothing waiting" icon={<ClipboardIcon />} description="Nothing is waiting on you." />
  </div>
);

export const WithLink = () => (
  <div className="w-96">
    <EmptyState
      title="Nothing on for that"
      description="Widen the window, or clear a filter."
      action={{ label: 'Clear filters', onClick: () => {} }}
    />
  </div>
);

export const PageSolid = () => (
  <div className="flex w-96 flex-col justify-center overflow-hidden" style={{ height: 300 }}>
    <EmptyState
      size="page"
      icon={<PlugIcon />}
      title="No connectors"
      description="No connectors in Growth team."
      action={{ label: 'Browse catalogue', onClick: () => {} }}
      actionStyle="solid"
    />
  </div>
);
