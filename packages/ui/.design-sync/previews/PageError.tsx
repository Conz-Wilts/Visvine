import { PageError } from '@visvine/ui';

export const WithRetry = () => (
  <div className="w-96">
    <PageError message="Couldn't load this space." onRetry={() => {}} />
  </div>
);

export const NotFound = () => (
  <div className="w-96">
    <PageError message="This event doesn't exist." />
  </div>
);

export const InlineInPanel = () => (
  <div className="w-96 border-t border-b border-line-subtle">
    <div className="pt-3 text-sm font-semibold text-fg">Recent runs</div>
    <PageError size="inline" message="Couldn't load runs for Standup digest." onRetry={() => {}} />
  </div>
);
