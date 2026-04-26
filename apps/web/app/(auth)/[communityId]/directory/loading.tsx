export default function DirectoryLoading() {
  return (
    <div className="p-4 sm:p-6 max-w-screen-2xl mx-auto animate-pulse">
      <div className="mb-4 sm:mb-6">
        <div className="h-7 sm:h-8 w-56 sm:w-72 rounded bg-gray-200" />
        <div className="h-4 w-80 sm:w-96 rounded bg-gray-200 mt-2 hidden sm:block" />
      </div>

      {/* Toolbar skeleton */}
      <div className="flex items-center gap-2 sm:gap-3 mb-4">
        <div className="h-10 flex-1 sm:flex-none sm:w-64 rounded-lg bg-gray-200" />
        <div className="h-10 w-32 rounded-lg bg-gray-200 hidden sm:block" />
        <div className="ml-auto h-10 w-10 sm:w-28 rounded-lg bg-gray-200" />
      </div>

      {/* Table skeleton */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="flex gap-4 bg-gray-50 px-4 py-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-4 flex-1 rounded bg-gray-200" />
          ))}
        </div>
        {/* Rows */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-t border-gray-100 px-4 py-3">
            <div className="h-8 w-8 rounded-full bg-gray-200 shrink-0" />
            {Array.from({ length: 5 }).map((_, j) => (
              <div key={j} className="h-4 flex-1 rounded bg-gray-200" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
