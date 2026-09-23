import { Skeleton, Stack } from '@visvine/ui';

export const Bar = () => (
  <div className="w-72">
    <Skeleton className="h-4 w-48" />
  </div>
);

export const Shapes = () => (
  <div className="flex w-80 items-center gap-4">
    <Skeleton className="h-11 w-11 rounded-xl" />
    <Skeleton className="h-3 w-24" />
    <Skeleton className="h-8 w-20 rounded-lg bg-line-subtle" />
  </div>
);

export const PeopleList = () => (
  <div className="w-80 divide-y divide-line-subtle">
    {[40, 28, 34].map((w, i) => (
      <div key={i} className="flex items-center gap-3 py-2.5">
        <Skeleton className="h-9 w-9 flex-none rounded-xl" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5" style={{ width: `${w * 4}px` }} />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    ))}
  </div>
);

export const ConnectorRows = () => (
  <Stack gap={2} className="w-96">
    {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
  </Stack>
);

export const ToolFrame = () => (
  <div className="w-96 space-y-3">
    <Skeleton className="h-5 w-48" />
    <Skeleton className="h-3.5 w-72" />
    <div className="grid grid-cols-2 gap-3">
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-24 w-full rounded-lg" />
    </div>
    <Skeleton className="h-24 w-full rounded-lg" />
  </div>
);
