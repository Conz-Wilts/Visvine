export default function MessagesLoading() {
  return (
    <div className="mx-auto h-[calc(100dvh-56px)] w-full max-w-7xl animate-pulse border-t border-border-subtle bg-surface-1 p-4">
      <div className="grid h-full grid-cols-1 gap-4 md:grid-cols-[24rem_1fr]">
        <div className="rounded-xl bg-surface-3" />
        <div className="rounded-xl bg-surface-3" />
      </div>
    </div>
  );
}
