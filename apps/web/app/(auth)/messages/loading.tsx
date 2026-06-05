export default function MessagesLoading() {
  return (
    <div className="flex h-[calc(100dvh-56px)] w-full flex-col px-6">
      {/* Centered title placeholder */}
      <div className="flex items-center justify-center pt-6 pb-4">
        <div className="h-12 w-48 animate-pulse rounded-xl bg-surface-3" />
      </div>

      {/* Two-pane skeleton — sits on the page background, no white panel */}
      <div className="grid min-h-0 w-full flex-1 grid-cols-1 gap-4 overflow-hidden md:grid-cols-[24rem_1fr]">
        <div className="animate-pulse rounded-xl bg-surface-3" />
        <div className="animate-pulse rounded-xl bg-surface-3" />
      </div>
    </div>
  );
}
