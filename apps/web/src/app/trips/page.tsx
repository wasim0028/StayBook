import { CalendarDays, ImageOff, Luggage } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, EmptyState, LinkButton } from "@/components/ui";
import { api } from "@/lib/api";
import { STATUS_UI, tripGroup, type TripGroup } from "@/lib/booking-ui";
import { formatINR, formatRange, nightsBetween, plural, todayISO } from "@/lib/format";
import type { Booking, Page } from "@/lib/types";

export const metadata: Metadata = { title: "Trips" };

function TripRow({ b }: { b: Booking }) {
  const s = STATUS_UI[b.status];
  return (
    <Link href={`/trips/${b.bookingId}`} className="group flex gap-4 rounded-2xl border border-line bg-surface p-3 transition hover:shadow-card sm:p-4">
      <div className="size-24 shrink-0 overflow-hidden rounded-xl bg-surface-2 sm:size-28">
        {b.coverPhotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={b.coverPhotoUrl} alt="" className="size-full object-cover transition duration-500 group-hover:scale-105" />
        ) : (
          <div className="grid size-full place-items-center text-muted"><ImageOff className="size-6" /></div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate font-semibold">{b.listingTitle ?? "Your stay"}</h3>
            <Badge tone={s.tone}>{s.label}</Badge>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
            <CalendarDays className="size-4" /> {formatRange(b.checkIn, b.checkOut)} · {plural(nightsBetween(b.checkIn, b.checkOut), "night")}
          </p>
        </div>
        <p className="text-sm">
          <span className="font-semibold">{formatINR(b.totalPaise)}</span> <span className="text-muted">· {plural(b.guests, "guest")}</span>
        </p>
      </div>
    </Link>
  );
}

const SECTIONS: { key: TripGroup; title: string }[] = [
  { key: "upcoming", title: "Upcoming" },
  { key: "past", title: "Where you've been" },
  { key: "cancelled", title: "Cancelled and expired" },
];

export default async function TripsPage() {
  const page = await api<Page<Booking>>("/v1/trips?limit=50", { auth: true });
  const today = todayISO();
  const groups: Record<TripGroup, Booking[]> = { upcoming: [], past: [], cancelled: [] };
  for (const b of page.items) groups[tripGroup(b, today)].push(b);
  groups.upcoming.sort((a, b) => a.checkIn.localeCompare(b.checkIn));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Trips</h1>
      {page.items.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<Luggage className="size-6" />}
            title="No trips booked… yet"
            body="Time to dust off your bags and start planning your next adventure."
            action={<LinkButton href="/">Start searching</LinkButton>}
          />
        </div>
      ) : (
        SECTIONS.filter((s) => groups[s.key].length > 0).map((s) => (
          <section key={s.key} className="mt-10">
            <h2 className="mb-4 text-xl font-semibold">{s.title}</h2>
            <div className="grid gap-4">
              {groups[s.key].map((b) => (
                <TripRow key={b.bookingId} b={b} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
