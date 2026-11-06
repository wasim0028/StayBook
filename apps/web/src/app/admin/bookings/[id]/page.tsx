import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminAction } from "@/components/admin/AdminAction";
import { Mono } from "@/components/admin/Table";
import { Alert, Badge } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";
import { dateTime } from "@/lib/admin-format";
import { POLICY_COPY } from "@/lib/amenities";
import { api, ApiError } from "@/lib/api";
import { STATUS_UI } from "@/lib/booking-ui";
import { formatDateLong, formatINR, nightsBetween, plural } from "@/lib/format";
import type { Booking } from "@/lib/types";

export const metadata: Metadata = { title: "Booking" };

type AdminBooking = Booking & { hostId: string; guestId: string; orderId?: string; paymentId?: string; refundId?: string; refundError?: string; hostReversalId?: string; confirmedAt?: string; cancelledAt?: string; updatedAt?: string };

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2.5 text-[15px] last:border-0">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right">{v ?? "—"}</dd>
    </div>
  );
}

export default async function AdminBookingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let b: AdminBooking;
  try {
    b = await api<AdminBooking>(`/v1/bookings/${id}`, { auth: true });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const s = STATUS_UI[b.status];
  const n = nightsBetween(b.checkIn, b.checkOut);

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{b.listingTitle}</h1>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>
      <p className="mt-1 text-muted">{formatDateLong(b.checkIn)} → {formatDateLong(b.checkOut)} · {plural(n, "night")} · {plural(b.guests, "guest")}</p>

      {b.refundStatus === "FAILED" && <div className="mt-5"><Alert tone="bad">Refund failed: {b.refundError ?? "no reason recorded"}</Alert></div>}

      <div className="mt-6 flex flex-wrap gap-2">
        <Link href={`/admin/users/${b.guestId}`} className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:border-fg">Guest</Link>
        <Link href={`/admin/users/${b.hostId}`} className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:border-fg">Host</Link>
        <Link href={`/listing/${b.listingId}`} target="_blank" className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:border-fg">Listing</Link>
        {(b.refundStatus === "FAILED" || b.refundStatus === "PENDING") && (
          <AdminAction path={`/v1/admin/bookings/${b.bookingId}/retry-refund`} label="Retry refund" title="Retry this refund?" body={`Asks Razorpay again to refund ${formatINR(b.refundPaise ?? 0)}.`} confirmLabel="Retry refund" variant="primary" size="md" />
        )}
        {b.status === "CONFIRMED" && (
          <AdminAction path={`/v1/bookings/${b.bookingId}/cancel`} label="Cancel with full refund" title="Cancel this booking?" body={`The guest gets the full ${formatINR(b.totalPaise)} back, the host's transfer is reversed and the dates reopen. Recorded in the audit log.`} confirmLabel="Cancel and refund" variant="danger" size="md" />
        )}
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Money</h2>
          <dl className="mt-2">
            <Row k="Guest paid" v={formatINR(b.totalPaise)} />
            <Row k="Platform fee" v={formatINR(b.platformFeePaise ?? 0)} />
            <Row k="Host payout" v={formatINR(b.hostPayoutPaise ?? 0)} />
            <Row k="Refund" v={b.refundPaise != null ? `${formatINR(b.refundPaise)} · ${b.refundStatus ?? ""}` : undefined} />
            <Row k="Policy" v={b.cancellationPolicy ? POLICY_COPY[b.cancellationPolicy]?.name : undefined} />
          </dl>
        </section>
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Payment references</h2>
          <dl className="mt-2">
            <Row k="Booking" v={<Mono>{b.bookingId}</Mono>} />
            <Row k="Razorpay order" v={b.orderId && <Mono>{b.orderId}</Mono>} />
            <Row k="Payment" v={b.paymentId && <Mono>{b.paymentId}</Mono>} />
            <Row k="Refund" v={b.refundId && <Mono>{b.refundId}</Mono>} />
            <Row k="Transfer reversal" v={b.hostReversalId && <Mono>{b.hostReversalId}</Mono>} />
          </dl>
        </section>
        <section className="rounded-2xl border border-line bg-surface p-5 md:col-span-2">
          <h2 className="font-semibold">Timeline</h2>
          <dl className="mt-2">
            <Row k="Created" v={b.createdAt && dateTime(b.createdAt)} />
            <Row k="Paid" v={b.confirmedAt && dateTime(b.confirmedAt)} />
            <Row k="Cancelled" v={b.cancelledAt && `${dateTime(b.cancelledAt)} by ${b.cancelledBy}`} />
            <Row k="Last change" v={b.updatedAt && dateTime(b.updatedAt)} />
          </dl>
        </section>
      </div>
    </div>
  );
}
