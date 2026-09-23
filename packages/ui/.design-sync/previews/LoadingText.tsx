import { LoadingText } from '@visvine/ui';

export const Default = () => (
  <div className="w-80">
    <LoadingText />
  </div>
);

export const CustomText = () => (
  <div className="w-80">
    <LoadingText text="Loading queue…" />
  </div>
);

export const InPanel = () => (
  <div className="w-96 border-t border-b border-line-subtle">
    <div className="pt-3 text-sm font-semibold text-fg">Approvals</div>
    <LoadingText text="Loading submission…" className="py-8 text-sm" />
  </div>
);
