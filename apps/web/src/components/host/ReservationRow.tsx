import { ImageOff } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { STATUS_UI } from "@/lib/booking-ui";
import { formatINR, formatRange, nightsBetween, plural } from "@/lib/format";
import type { Booking } from "@/lib/types";

export function ReservationRow({ b }: { b: Booking }) {
  const s = STATUS_UI[b.status];
  return (
    <Link href={`/host/reservations/${b.bookingId}`} className="flex items-center gap-4 rounded-xl border border-line bg-surface p-3 transition hover:shadow-card">
      <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-surface-2">
        {b.coverPhotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={b.coverPhotoUrl} alt="" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-muted"><ImageOff className="size-5" /></div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{b.listingTitle}</div>
        <div className="text-sm text-muted">{formatRange(b.checkIn, b.checkOut)} · {plural(nightsBetween(b.checkIn, b.checkOut), "night")} · {plural(b.guests, "guest")}</div>
      </div>
      <div className="hidden text-right sm:block">
        <div className="font-semibold">{formatINR(b.hostPayoutPaise ?? 0)}</div>
        <div className="text-xs text-muted">your payout</div>
      </div>
      <Badge tone={s.tone}>{s.label}</Badge>
    </Link>
  );
}
