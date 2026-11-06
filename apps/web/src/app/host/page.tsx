import { ArrowRight, CalendarCheck, Home, IndianRupee, Plus, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ReservationRow } from "@/components/host/ReservationRow";
import { Badge, LinkButton } from "@/components/ui";
import { api } from "@/lib/api";
import { addDaysISO, formatINR, todayISO } from "@/lib/format";
import { payoutUi } from "@/lib/host";
import { requireHost } from "@/lib/host-guard";
import type { Booking, Listing, Me, Page } from "@/lib/types";

export const metadata: Metadata = { title: "Host dashboard" };

function Stat({ icon: Icon, label, value, sub }: { icon: typeof Home; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-center gap-2 text-sm font-medium text-muted"><Icon className="size-4" /> {label}</div>
      <div className="mt-2 text-3xl font-bold tracking-tight tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
    </div>
  );
}

export default async function HostHome() {
  const session = await requireHost();
  const [me, res, listings] = await Promise.all([
    api<Me>("/v1/me", { auth: true }),
    api<Page<Booking>>("/v1/host/reservations?limit=50", { auth: true }),
    api<Page<Listing>>("/v1/host/listings?limit=50", { auth: true }),
  ]);
  const today = todayISO();
  const monthStart = today.slice(0, 8) + "01";
  const live = res.items.filter((b) => b.status === "CONFIRMED" || b.status === "CHECKED_IN" || b.status === "COMPLETED");
  const upcoming = live.filter((b) => b.checkOut > today).sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  const requests = res.items.filter((b) => b.status === "REQUESTED").sort((a, b) => (a.holdExpiresAt ?? 0) - (b.holdExpiresAt ?? 0));
  const next30 = upcoming.filter((b) => b.checkIn <= addDaysISO(today, 30));
  const monthEarnings = live.filter((b) => b.checkOut >= monthStart && b.checkOut.slice(0, 7) === today.slice(0, 7)).reduce((s, b) => s + (b.hostPayoutPaise ?? 0), 0);
  const published = listings.items.filter((l) => l.status === "PUBLISHED");
  const rated = published.filter((l) => l.ratingCount);
  const avg = rated.length ? rated.reduce((s, l) => s + (l.ratingAvg ?? 0) * (l.ratingCount ?? 0), 0) / rated.reduce((s, l) => s + (l.ratingCount ?? 0), 0) : null;
  const payout = me.host ? payoutUi(me.host) : null;
  const firstName = (me.displayName ?? session.name ?? "").split(" ")[0];

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Welcome back{firstName ? `, ${firstName}` : ""}</h1>
        <LinkButton href="/host/listings/new" variant="outline"><Plus className="size-4" /> New listing</LinkButton>
      </div>

      {payout && me.host?.payoutStatus !== "activated" && (
        <Link href="/host/onboarding" className="mt-6 flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface p-5 hover:shadow-card">
          <div>
            <Badge tone={payout.tone}>{payout.label}</Badge>
            <p className="mt-2 text-[15px]">{payout.body}</p>
          </div>
          <ArrowRight className="size-5 shrink-0" />
        </Link>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={CalendarCheck} label="Next 30 days" value={String(next30.length)} sub={next30.length === 1 ? "stay booked" : "stays booked"} />
        <Stat icon={IndianRupee} label="Earnings this month" value={formatINR(monthEarnings)} sub="stays checking out this month" />
        <Stat icon={Home} label="Listed" value={`${published.length}/${listings.items.length}`} sub="listings live" />
        <Stat icon={Star} label="Rating" value={avg ? avg.toFixed(2) : "—"} sub={rated.length ? "across your listings" : "no reviews yet"} />
      </div>

      {requests.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-1 text-xl font-semibold">Booking requests <span className="ml-1 rounded-full bg-brand px-2 py-0.5 align-middle text-sm text-brand-fg">{requests.length}</span></h2>
          <p className="mb-4 text-sm text-muted">Respond within 24 hours. Unanswered requests expire and lower your response rate.</p>
          <div className="grid gap-3">{requests.map((b) => <ReservationRow key={b.bookingId} b={b} />)}</div>
        </section>
      )}

      <section className="mt-12">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Upcoming stays</h2>
          <Link href="/host/reservations" className="text-sm font-semibold underline">All reservations</Link>
        </div>
        {upcoming.length ? (
          <div className="grid gap-3">{upcoming.slice(0, 6).map((b) => <ReservationRow key={b.bookingId} b={b} />)}</div>
        ) : (
          <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-muted">
            {published.length ? "No upcoming stays yet. Sharp photos and competitive prices help." : "Publish a listing to start taking bookings."}
          </p>
        )}
      </section>
    </div>
  );
}
