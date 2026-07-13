export default function Loading() {
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header skeleton */}
      <div className="flex flex-col gap-3">
        <div className="h-10 w-64 rounded-xl bg-content-primary/5 border border-border-default animate-pulse" />
        <div className="h-5 w-96 max-w-full rounded-lg bg-content-primary/5 border border-border-subtle animate-pulse" />
      </div>

      {/* Metrics grid skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-panel p-6 flex flex-col gap-4 bg-content-primary/5 border border-border-default rounded-2xl">
            <div className="flex justify-between items-start">
              <div className="w-12 h-12 rounded-2xl bg-content-primary/5 border border-border-default animate-pulse" />
              <div className="h-6 w-16 rounded-full bg-content-primary/5 border border-border-default animate-pulse" />
            </div>
            <div className="flex flex-col gap-2">
              <div className="h-4 w-32 rounded bg-content-primary/5 animate-pulse" />
              <div className="h-8 w-20 rounded-lg bg-content-primary/10 animate-pulse" />
            </div>
          </div>
        ))}
      </div>

      {/* Activity section skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass-panel p-6 bg-content-primary/5 border border-border-default rounded-2xl">
          <div className="h-6 w-48 rounded-lg bg-content-primary/5 animate-pulse mb-6" />
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="w-40 shrink-0 h-4 rounded bg-content-primary/5 animate-pulse" />
                <div className="flex-1 h-2.5 rounded-full bg-content-primary/5 border border-border-subtle animate-pulse" />
                <div className="w-10 shrink-0 h-4 rounded bg-content-primary/5 animate-pulse" />
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel p-6 bg-content-primary/5 border border-border-default rounded-2xl">
          <div className="h-6 w-36 rounded-lg bg-content-primary/5 animate-pulse mb-6" />
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-4 p-3">
                <div className="w-2 h-2 mt-2 rounded-full bg-content-primary/10 animate-pulse" />
                <div className="flex-1 flex flex-col gap-2">
                  <div className="h-4 w-3/4 rounded bg-content-primary/5 animate-pulse" />
                  <div className="h-3 w-1/2 rounded bg-content-primary/5 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
