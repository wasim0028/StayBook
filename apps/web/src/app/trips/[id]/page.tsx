import { ArrowLeft, CalendarCheck, CalendarX, CheckCircle2, Clock, Receipt, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PriceBreakdown } from "@/components/PriceBreakdown";
import { Alert, Badge } from "@/components/ui";
import { POLICY_COPY } from "@/lib/amenities";
import { api, ApiError } from "@/lib/api";
import { refundLine, STATUS_UI } from "@/lib/booking-ui";
import { formatDateLong, formatINR, nightsBetween, plural } from "@/lib/format";
import type { Booking, Review } from "@/lib/types";
import { TripActions } from "./TripActions";

export const metadata: Metadata = { title: "Trip" };

/** Check-out 11:00 IST as epoch seconds (mirrors the server rule). */
const checkoutEpoch = (iso: string) => Math.floor(Date.parse(`${iso}T11:00:00+05:30`) / 1000);

export default async function TripPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ paid?: string; requested?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let b: Booking;
  try {
    b = await api<Booking>(`/v1/bookings/${id}`, { auth: true });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const review = await api<Review>(`/v1/reviews/by-booking/${id}`, { auth: true }).catch(() => null);

  const now = Math.floor(Date.now() / 1000);
  const out = checkoutEpoch(b.checkOut);
  const canReview = !review && ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(b.status) && now >= out && now <= out + 30 * 86_400;
  const s = STATUS_UI[b.status];
  const nights = nightsBetween(b.checkIn, b.checkOut);
  const refund = refundLine(b, formatINR);
  const policy = b.cancellationPolicy ? POLICY_COPY[b.cancellationPolicy] : undefined;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <Link href="/trips" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> All trips
      </Link>

      {sp.paid && b.status === "CONFIRMED" && (
        <div className="mt-5 flex items-start gap-3 rounded-2xl bg-ok-soft p-5 text-ok">
          <CheckCircle2 className="mt-0.5 size-6 shrink-0" />
          <div>
            <div className="text-lg font-semibold">You&apos;re booked!</div>
            <p className="text-sm">We&apos;ve emailed your confirmation. Your host gets paid after you check out.</p>
          </div>
        </div>
      )}
      {b.status === "REQUESTED" && (
        <div className="mt-5 rounded-2xl bg-info-soft p-5 text-info">
          <div className="text-lg font-semibold">{sp.requested ? "Request sent!" : "Waiting for the host"}</div>
          <p className="text-sm">You won&apos;t be charged yet. The host has until {b.holdExpiresAt ? new Date(b.holdExpiresAt * 1000).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "24 hours"} to accept; then you&apos;ll have 12 hours to pay and confirm. We&apos;ll email you either way.</p>
        </div>
      )}
      {b.status === "DECLINED" && (
        <div className="mt-5"><Alert tone="warn">{b.expiredReason === "REQUEST_NOT_ANSWERED" ? "The host didn't respond in time, so the request expired." : `The host couldn't accept this request${b.declineReason ? `: “${b.declineReason}”` : "."}`} You weren&apos;t charged.</Alert></div>
      )}
      {b.status === "PENDING_PAYMENT" && b.instantBook === false && !sp.paid && (
        <div className="mt-5"><Alert tone="ok">Good news: the host accepted! Pay within 12 hours to confirm your stay.</Alert></div>
      )}
      {sp.paid && b.status === "PENDING_PAYMENT" && (
        <div className="mt-5">
          <Alert tone="info">We&apos;re still confirming your payment with the bank. This page will show “Confirmed” within a minute; you&apos;ll also get an email.</Alert>
        </div>
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="overflow-hidden rounded-3xl bg-surface-2">
            {b.coverPhotoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.coverPhotoUrl} alt="" className="aspect-[16/9] w-full object-cover" />
            )}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{b.listingTitle ?? "Your stay"}</h1>
            <Badge tone={s.tone}>{s.label}</Badge>
          </div>
          <Link href={`/listing/${b.listingId}`} className="mt-1 inline-block text-sm font-medium underline">View listing</Link>

          <div className="mt-6 grid grid-cols-2 overflow-hidden rounded-2xl border border-line">
            <div className="border-r border-line p-4">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted"><CalendarCheck className="size-4" /> Check-in</div>
              <div className="mt-1 font-semibold">{formatDateLong(b.checkIn)}</div>
              <div className="text-sm text-muted">After 2:00 pm</div>
            </div>
            <div className="p-4">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted"><CalendarX className="size-4" /> Check-out</div>
              <div className="mt-1 font-semibold">{formatDateLong(b.checkOut)}</div>
              <div className="text-sm text-muted">Before 11:00 am</div>
            </div>
          </div>

          <ul className="mt-6 space-y-3 text-[15px]">
            <li className="flex items-center gap-3"><Users className="size-5 text-muted" /> {plural(b.guests, "guest")} · {plural(nights, "night")}</li>
            <li className="flex items-start gap-3"><Receipt className="mt-0.5 size-5 shrink-0 text-muted" /> <span className="min-w-0"><span className="whitespace-nowrap">Booking ID</span> <code className="break-all rounded bg-surface-2 px-1.5 py-0.5 text-xs">{b.bookingId}</code></span></li>
            {policy && <li className="flex items-start gap-3"><Clock className="mt-0.5 size-5 shrink-0 text-muted" /> <span><span className="font-medium">{policy.name} cancellation.</span> <span className="text-muted">{policy.summary}</span></span></li>}
          </ul>

          {refund && <div className="mt-6"><Alert tone={b.refundStatus === "FAILED" ? "warn" : "info"}>{refund}</Alert></div>}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="mb-3 font-semibold">Payment</h2>
            {b.price ? (
              <PriceBreakdown p={b.price} totalLabel={b.status === "PENDING_PAYMENT" ? "Total due" : b.status === "EXPIRED" ? "Not charged" : "Total paid"} />
            ) : (
              <dl className="space-y-2 text-[15px]">
                <div className="flex justify-between"><dt className="text-muted">{plural(nights, "night")}</dt><dd>{formatINR(b.totalPaise)}</dd></div>
                <div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>{b.status === "PENDING_PAYMENT" ? "Total due" : b.status === "EXPIRED" ? "Not charged" : "Total paid"}</dt><dd>{formatINR(b.totalPaise)}</dd></div>
              </dl>
            )}
            {b.refundPaise != null && b.refundPaise > 0 && <div className="mt-2 flex justify-between text-[15px] text-ok"><span>Refund</span><span>−{formatINR(b.refundPaise)}</span></div>}
          </div>
          <TripActions booking={b} canReview={canReview} review={review} />
        </aside>
      </div>
    </div>
  );
}
