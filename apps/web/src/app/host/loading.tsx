import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-9 w-56" />
      <div className="mt-8 grid gap-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 w-full rounded-2xl" />)}
      </div>
    </div>
  );
}
