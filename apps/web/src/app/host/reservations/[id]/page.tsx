import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge } from "@/components/ui";
import { POLICY_COPY } from "@/lib/amenities";
import { api, ApiError } from "@/lib/api";
import { STATUS_UI } from "@/lib/booking-ui";
import { formatDateLong, formatINR, nightsBetween, plural } from "@/lib/format";
import { requireHost } from "@/lib/host-guard";
import type { Booking, GuestReviews, Review } from "@/lib/types";
import { HostReservationActions } from "./HostReservationActions";

export const metadata: Metadata = { title: "Reservation" };

export default async function HostReservation({ params }: { params: Promise<{ id: string }> }) {
  await requireHost();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let b: Booking;
  try {
    b = await api<Booking>(`/v1/bookings/${id}`, { auth: true });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const [review, guestReviews, myGuestReview] = await Promise.all([
    api<Review>(`/v1/reviews/by-booking/${id}`, { auth: true }).catch(() => null),
    b.guestId ? api<GuestReviews>(`/v1/reviews/guests/${b.guestId}?limit=5`, { auth: true }).catch(() => null) : Promise.resolve(null),
    api<{ rating: number; comment: string }>(`/v1/reviews/guests/by-booking/${id}`, { auth: true }).catch(() => null),
  ]);
  const out = Date.parse(`${b.checkOut}T11:00:00+05:30`);
  const canReviewGuest = !myGuestReview && ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(b.status) && Date.now() >= out && Date.now() <= out + 30 * 86_400_000;
  const s = STATUS_UI[b.status];
  const nights = nightsBetween(b.checkIn, b.checkOut);
  const releaseAt = new Date(Date.parse(`${b.checkOut}T11:00:00+05:30`) + 24 * 3600 * 1000);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <Link href="/host/reservations" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg"><ArrowLeft className="size-4" /> Reservations</Link>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{b.listingTitle}</h1>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>
      <p className="mt-1 text-muted">{formatDateLong(b.checkIn)} → {formatDateLong(b.checkOut)} · {plural(nights, "night")} · {plural(b.guests, "guest")}</p>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Earnings</h2>
          <dl className="mt-3 space-y-2 text-[15px]">
            <div className="flex justify-between"><dt className="text-muted">{b.status === "REQUESTED" || b.status === "PENDING_PAYMENT" ? "Guest pays" : "Guest paid"}</dt><dd>{formatINR(b.totalPaise)}</dd></div>
            {b.price && b.price.cleaningFeePaise > 0 && <div className="flex justify-between"><dt className="text-muted">incl. cleaning fee</dt><dd>{formatINR(b.price.cleaningFeePaise)}</dd></div>}
            {b.price && b.price.discountPaise > 0 && <div className="flex justify-between"><dt className="text-muted">after {b.price.discountKind} discount</dt><dd>−{formatINR(b.price.discountPaise)}</dd></div>}
            {b.price && <div className="flex justify-between"><dt className="text-muted">GST ({b.price.gstRatePct}%)</dt><dd>{b.platformGstPaise ? `−${formatINR(b.platformGstPaise)} (we remit it)` : "included, you remit it"}</dd></div>}
            <div className="flex justify-between"><dt className="text-muted">Platform fee</dt><dd>−{formatINR(b.platformFeePaise ?? 0)}</dd></div>
            <div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>Your payout</dt><dd>{formatINR(b.hostPayoutPaise ?? 0)}</dd></div>
          </dl>
          {b.status === "CONFIRMED" && <p className="mt-3 text-sm text-muted">Released to your bank from {releaseAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}.</p>}
          {b.status === "CANCELLED" && <p className="mt-3 text-sm text-muted">Cancelled by {b.cancelledBy ?? "—"}. {b.refundPaise ? `${formatINR(b.refundPaise)} refunded to the guest; your share was reduced accordingly.` : "No refund was due."}</p>}
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Details</h2>
          <ul className="mt-3 space-y-2 text-[15px]">
            <li><span className="text-muted">Booking ID </span><code className="break-all rounded bg-surface-2 px-1.5 py-0.5 text-xs">{b.bookingId}</code></li>
            <li><span className="text-muted">Policy </span>{b.cancellationPolicy ? POLICY_COPY[b.cancellationPolicy]?.name : "—"}</li>
            <li><span className="text-muted">Booked </span>{b.createdAt ? new Date(b.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—"}</li>
          </ul>
        </div>
      </div>

      {b.status === "REQUESTED" && b.requestMessage && (
        <blockquote className="mt-6 rounded-2xl border-l-4 border-brand bg-surface p-5 text-[15px]">“{b.requestMessage}”</blockquote>
      )}
      {b.status === "PENDING_PAYMENT" && <div className="mt-6"><Alert tone="info">{b.instantBook === false ? "You accepted. The guest has 12 hours to pay." : "The guest is paying now. These dates are held for up to 15 minutes."}</Alert></div>}

      <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-semibold">About this guest</h2>
        {guestReviews && guestReviews.ratingCount > 0 ? (
          <>
            <p className="mt-1 text-[15px]">★ {guestReviews.ratingAvg?.toFixed(2)} from {guestReviews.ratingCount} host review{guestReviews.ratingCount === 1 ? "" : "s"}</p>
            <ul className="mt-4 space-y-4">
              {guestReviews.items.map((r) => (
                <li key={r.bookingId} className="text-sm">
                  <div className="font-medium">{"★".repeat(r.rating)}<span className="text-line">{"★".repeat(5 - r.rating)}</span> · {r.hostName}, {r.listingTitle}</div>
                  {r.comment && <p className="mt-1 text-muted">“{r.comment}”</p>}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">No reviews from other hosts yet.</p>
        )}
      </section>

      <div className="mt-6"><HostReservationActions booking={b} review={review} canReviewGuest={canReviewGuest} myGuestReview={myGuestReview} /></div>
    </div>
  );
}
