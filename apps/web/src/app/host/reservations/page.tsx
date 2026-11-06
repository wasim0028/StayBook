import { CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { ReservationRow } from "@/components/host/ReservationRow";
import { EmptyState } from "@/components/ui";
import { api } from "@/lib/api";
import { tripGroup, type TripGroup } from "@/lib/booking-ui";
import { todayISO } from "@/lib/format";
import { requireHost } from "@/lib/host-guard";
import type { Booking, Page } from "@/lib/types";

export const metadata: Metadata = { title: "Reservations" };

const TABS: { k: TripGroup; label: string; empty: string }[] = [
  { k: "upcoming", label: "Upcoming", empty: "No upcoming reservations. Guests will appear here once they book." },
  { k: "past", label: "Completed", empty: "No completed stays yet." },
  { k: "cancelled", label: "Cancelled", empty: "No cancellations. Nice." },
];

export default async function Reservations({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireHost();
  const { tab } = await searchParams;
  const active = TABS.find((t) => t.k === tab) ?? TABS[0]!;
  const page = await api<Page<Booking>>("/v1/host/reservations?limit=50", { auth: true });
  const today = todayISO();
  const items = page.items.filter((b) => tripGroup(b, today) === active.k);
  if (active.k === "upcoming") items.sort((a, b) => a.checkIn.localeCompare(b.checkIn));

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Reservations</h1>
      <div className="mt-6 flex gap-2">
        {TABS.map((t) => (
          <Link key={t.k} href={`/host/reservations?tab=${t.k}`} className={clsx("rounded-full border px-4 py-2 text-sm font-semibold transition", t.k === active.k ? "border-fg bg-fg text-bg" : "border-line hover:border-fg")}>
            {t.label}
          </Link>
        ))}
      </div>
      <div className="mt-6 grid gap-3">
        {items.length ? items.map((b) => <ReservationRow key={b.bookingId} b={b} />) : <EmptyState icon={<CalendarDays className="size-6" />} title={`No ${active.label.toLowerCase()} reservations`} body={active.empty} />}
      </div>
    </div>
  );
}
