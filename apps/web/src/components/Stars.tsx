import { Star } from "lucide-react";
import { formatRating } from "@/lib/format";

export function Rating({ avg, count, className = "" }: { avg?: number; count?: number; className?: string }) {
  if (!count) return <span className={`inline-flex items-center gap-1 text-sm text-muted ${className}`}>New</span>;
  return (
    <span className={`inline-flex items-center gap-1 text-sm ${className}`}>
      <Star className="size-3.5 fill-current" aria-hidden />
      <span className="font-semibold">{formatRating(avg)}</span>
      <span className="text-muted">({count})</span>
    </span>
  );
}
