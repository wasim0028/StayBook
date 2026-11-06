"use client";

import { Clock, Loader2, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { DateRangePicker } from "@/components/DateRangePicker";
import { GuestsStepper } from "@/components/GuestsPicker";
import { Rating } from "@/components/Stars";
import { Alert, Button, LinkButton, Textarea } from "@/components/ui";
import { useDismiss } from "@/components/useDismiss";
import { rangeAvailable, stayTotal, type Availability, type Range } from "@/lib/calendar";
import { call, ClientApiError, errorMessage } from "@/lib/client-api";
import { addDaysISO, formatDate, formatINR, nightsBetween, plural, todayISO } from "@/lib/format";
import { pay } from "@/lib/razorpay";
import { PriceBreakdown } from "@/components/PriceBreakdown";
import type { Booking, CalendarResponse, CreateBookingResponse, Quote } from "@/lib/types";

interface Props {
  listing: { id: string; title: string; basePricePaise: number; maxGuests: number; ratingAvg?: number; ratingCount?: number; policyName: string; minNights?: number; instantBook: boolean; hostName?: string };
  initial: { checkIn?: string; checkOut?: string; guests: number };
  signedIn: boolean;
  email?: string;
  isOwner: boolean;
  bookable: boolean;
}

type Phase = { kind: "idle" } | { kind: "creating" } | { kind: "paying"; b: CreateBookingResponse } | { kind: "held"; b: CreateBookingResponse } | { kind: "confirming"; bookingId: string };

const MESSAGES: Record<string, string> = {
  DATES_UNAVAILABLE: "Some of those nights were just booked. Please pick other dates.",
  LISTING_NOT_BOOKABLE: "This host can't take bookings right now. Please try again later.",
  TOO_MANY_GUESTS: "That's more guests than this place allows.",
  OWN_LISTING: "You can't book your own listing.",
  HOLD_EXPIRED: "Your hold expired. Please start again.",
  MIN_NIGHTS: "That's shorter than this place's minimum stay.",
  MAX_NIGHTS: "That's longer than this place allows.",
};

function useCountdown(until?: number) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  const left = Math.max(0, until - now);
  return { left, label: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` };
}

export function BookingCard({ listing, initial, signedIn, email, isOwner, bookable }: Props) {
  const router = useRouter();
  const [range, setRange] = useState<Range>({ from: initial.checkIn, to: initial.checkOut });
  const [guests, setGuests] = useState(Math.min(Math.max(1, initial.guests), listing.maxGuests));
  const [avail, setAvail] = useState<Availability>();
  const [open, setOpen] = useState<"dates" | "guests" | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string>();
  const idemKey = useRef<{ sig: string; key: string } | null>(null);
  const [note, setNote] = useState("");
  const pop = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(null), []);
  useDismiss(pop, open !== null, close);

  const loadAvailability = useCallback(async () => {
    const from = todayISO();
    try {
      const r = await call<CalendarResponse>(`/v1/listings/${listing.id}/calendar?from=${from}&to=${addDaysISO(from, 365)}`);
      setAvail(Object.fromEntries(r.nights.map((n) => [n.date, { available: n.available ?? n.status === "FREE", pricePaise: n.pricePaise }])));
    } catch {
      /* availability is a convenience; the server re-checks on booking */
    }
  }, [listing.id]);
  useEffect(() => {
    void loadAvailability();
  }, [loadAvailability]);

  // The server's quote is the price the guest will be charged (fees, discounts, GST).
  const [quote, setQuote] = useState<Quote>();
  const [quoteErr, setQuoteErr] = useState<string>();
  useEffect(() => {
    setQuote(undefined);
    setQuoteErr(undefined);
    if (!range.from || !range.to) return;
    const ctl = new AbortController();
    const q = new URLSearchParams({ listingId: listing.id, checkIn: range.from, checkOut: range.to, guests: String(guests) });
    call<Quote>(`/v1/quote?${q}`, { signal: ctl.signal })
      .then(setQuote)
      .catch((e) => {
        if (ctl.signal.aborted) return;
        setQuoteErr(e instanceof ClientApiError ? (MESSAGES[e.code] ? `${MESSAGES[e.code]} ${e.message.charAt(0).toUpperCase()}${e.message.slice(1)}.` : e.message) : "Couldn't price these dates.");
      });
    return () => ctl.abort();
  }, [listing.id, range.from, range.to, guests]);

  const complete = !!(range.from && range.to);
  const nights = complete ? nightsBetween(range.from!, range.to!) : 0;
  const total = complete ? stayTotal(range.from!, range.to!, avail, listing.basePricePaise) : 0;
  const datesOk = complete && rangeAvailable(range.from!, range.to!, avail) && range.from! >= todayISO() && !quoteErr && quote?.available !== false;
  const held = phase.kind === "held" ? phase.b : undefined;
  const countdown = useCountdown(held?.holdExpiresAt);

  async function confirm(bookingId: string) {
    setPhase({ kind: "confirming", bookingId });
    // The Razorpay webhook confirms the booking; give it up to ~40s, then hand over to the trip page.
    for (let i = 0; i < 20; i++) {
      try {
        const b = await call<Booking>(`/v1/bookings/${bookingId}`);
        if (b.status === "CONFIRMED") break;
      } catch {
        /* keep polling */
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    router.push(`/trips/${bookingId}?paid=1`);
  }

  async function openCheckout(b: CreateBookingResponse) {
    if (!b.payment) return; // requests are paid later, from the trip page
    setPhase({ kind: "paying", b });
    try {
      const result = await pay({ keyId: b.payment!.keyId, orderId: b.payment!.orderId, amountPaise: b.payment!.amountPaise, title: listing.title, email, bookingId: b.bookingId });
      if (result === "paid") await confirm(b.bookingId);
      else setPhase({ kind: "held", b });
    } catch (e) {
      setError((e as Error).message);
      setPhase({ kind: "held", b });
    }
  }

  async function reserve() {
    setError(undefined);
    if (!signedIn) {
      const q = new URLSearchParams({ checkIn: range.from!, checkOut: range.to!, guests: String(guests) });
      window.location.href = `/auth/login?next=${encodeURIComponent(`/listing/${listing.id}?${q}`)}`;
      return;
    }
    // Same key for a retry of the same request, so a double-click or a network retry never holds twice.
    const sig = `${range.from}|${range.to}|${guests}`;
    if (idemKey.current?.sig !== sig) idemKey.current = { sig, key: crypto.randomUUID() };

    setPhase({ kind: "creating" });
    try {
      const b = await call<CreateBookingResponse>("/v1/bookings", {
        method: "POST",
        headers: { "idempotency-key": idemKey.current.key },
        body: { listingId: listing.id, checkIn: range.from, checkOut: range.to, guests, ...(note.trim() ? { message: note.trim() } : {}) },
      });
      if (b.status === "REQUESTED") {
        // Put the note in the conversation too, so host and guest can talk it through.
        if (note.trim()) {
          try {
            const { threadId } = await call<{ threadId: string }>("/v1/threads", { method: "POST", body: { bookingId: b.bookingId } });
            await call(`/v1/threads/${threadId}/messages`, { method: "POST", body: { body: note.trim(), clientId: crypto.randomUUID() } });
          } catch {
            /* the request itself went through; the note is on it */
          }
        }
        router.push(`/trips/${b.bookingId}?requested=1`);
        return;
      }
      await openCheckout(b);
    } catch (e) {
      setPhase({ kind: "idle" });
      if (e instanceof ClientApiError) {
        if (e.code === "DATES_UNAVAILABLE") {
          idemKey.current = null;
          void loadAvailability();
        }
        if (e.code === "REQUEST_FAILED") idemKey.current = null;
        setError(MESSAGES[e.code] ?? e.message);
      } else setError(errorMessage(e));
    }
  }

  async function releaseHold() {
    if (phase.kind !== "held") return;
    try {
      await call(`/v1/bookings/${phase.b.bookingId}/cancel`, { method: "POST" });
    } catch {
      /* the hold lapses on its own anyway */
    }
    idemKey.current = null;
    setPhase({ kind: "idle" });
    void loadAvailability();
  }

  const box = "rounded-2xl border border-line bg-surface p-6 shadow-card";

  if (phase.kind === "confirming") {
    return (
      <div className={box} role="status">
        <Loader2 className="size-8 animate-spin text-brand" />
        <h3 className="mt-4 text-lg font-semibold">Confirming your payment…</h3>
        <p className="mt-1 text-sm text-muted">This usually takes a few seconds. Please keep this page open.</p>
      </div>
    );
  }

  if (held) {
    const expired = countdown?.left === 0;
    return (
      <div className={box}>
        <h3 className="text-lg font-semibold">Complete your payment</h3>
        {expired ? (
          <div className="mt-3">
            <Alert tone="warn">Your hold has expired. Pick your dates again to start over.</Alert>
          </div>
        ) : (
          <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-warn-soft px-3 py-1 text-sm font-semibold text-warn">
            <Clock className="size-4" /> Dates held for {countdown?.label}
          </p>
        )}
        <dl className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Dates</dt><dd>{formatDate(range.from!)} – {formatDate(range.to!)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Guests</dt><dd>{guests}</dd></div>
          <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total</dt><dd>{formatINR(held.totalPaise)}</dd></div>
        </dl>
        {error && <div className="mt-4"><Alert tone="bad">{error}</Alert></div>}
        <div className="mt-5 space-y-2">
          {!expired && <Button className="w-full" size="lg" onClick={() => openCheckout(held)}>Pay {formatINR(held.totalPaise)}</Button>}
          <Button variant="ghost" className="w-full" onClick={expired ? () => { idemKey.current = null; setPhase({ kind: "idle" }); void loadAvailability(); } : releaseHold}>
            {expired ? "Start again" : "Release these dates"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={box} ref={pop}>
      <div className="flex items-baseline justify-between">
        <p>
          <span className="text-2xl font-bold">{formatINR(quote ? Math.round(quote.nightlySubtotalPaise / quote.nights) : complete ? Math.round(total / nights) : listing.basePricePaise)}</span> <span className="text-muted">night</span>
        </p>
        <Rating avg={listing.ratingAvg} count={listing.ratingCount} />
      </div>

      <div className="relative mt-5 rounded-xl border border-line">
        <button type="button" onClick={() => setOpen(open === "dates" ? null : "dates")} aria-expanded={open === "dates"} className="grid w-full grid-cols-2 text-left">
          <span className="border-r border-line px-3 py-2.5">
            <span className="block text-[11px] font-bold uppercase tracking-wide">Check-in</span>
            <span className={range.from ? "" : "text-muted"}>{range.from ? formatDate(range.from) : "Add date"}</span>
          </span>
          <span className="px-3 py-2.5">
            <span className="block text-[11px] font-bold uppercase tracking-wide">Check-out</span>
            <span className={range.to ? "" : "text-muted"}>{range.to ? formatDate(range.to) : "Add date"}</span>
          </span>
        </button>
        <button type="button" onClick={() => setOpen(open === "guests" ? null : "guests")} aria-expanded={open === "guests"} className="w-full border-t border-line px-3 py-2.5 text-left">
          <span className="block text-[11px] font-bold uppercase tracking-wide">Guests</span>
          <span>{plural(guests, "guest")}</span>
        </button>

        {open === "dates" && (
          <div className="absolute right-0 top-full z-30 mt-2 w-max max-w-[92vw] rounded-3xl border border-line bg-surface p-5 shadow-card">
            <DateRangePicker value={range} availability={avail} onChange={(r) => { setRange(r); setError(undefined); if (r.from && r.to) setOpen(null); }} />
            <div className="mt-3 flex justify-between text-sm">
              <button type="button" className="font-medium underline" onClick={() => setRange({})}>Clear dates</button>
              <button type="button" className="font-semibold" onClick={close}>Close</button>
            </div>
          </div>
        )}
        {open === "guests" && (
          <div className="absolute inset-x-0 top-full z-30 mt-2 rounded-2xl border border-line bg-surface p-5 shadow-card">
            <GuestsStepper value={guests} onChange={setGuests} max={listing.maxGuests} />
            <p className="mt-3 text-sm text-muted">This place has a maximum of {plural(listing.maxGuests, "guest")}.</p>
          </div>
        )}
      </div>

      {error && <div className="mt-4"><Alert tone="bad">{error}</Alert></div>}
      {complete && quoteErr && !error && <div className="mt-4"><Alert tone="warn">{quoteErr}</Alert></div>}
      {complete && !datesOk && !quoteErr && !error && <div className="mt-4"><Alert tone="warn">Some of those nights aren&apos;t available.</Alert></div>}

      <div className="mt-5">
        {isOwner ? (
          <LinkButton href={`/host/listings/${listing.id}`} variant="secondary" size="lg" className="w-full">Edit your listing</LinkButton>
        ) : !bookable ? (
          <Button size="lg" className="w-full" disabled>Not bookable yet</Button>
        ) : complete ? (
          <>
            {!listing.instantBook && signedIn && datesOk && (
              <div className="mb-3">
                <label htmlFor="note" className="text-sm font-medium">Message {listing.hostName ?? "the host"}</label>
                <Textarea id="note" className="mt-1.5 min-h-20" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Say who's coming and why you're travelling. Hosts accept friendly, complete requests faster." />
              </div>
            )}
            <Button size="lg" className="w-full" onClick={reserve} loading={phase.kind === "creating" || phase.kind === "paying"} disabled={!datesOk || (!listing.instantBook && signedIn && note.trim().length < 10)}>
              {!signedIn ? "Log in to reserve" : listing.instantBook ? <><Zap className="size-4" /> Reserve</> : "Request to book"}
            </Button>
          </>
        ) : (
          <Button size="lg" className="w-full" onClick={() => setOpen("dates")}>Check availability</Button>
        )}
      </div>

      {complete && datesOk && (
        <>
          <p className="mt-3 text-center text-sm text-muted">{listing.instantBook ? "Instant Book: confirmed as soon as you pay. Dates are held for 15 minutes." : `You won't be charged yet. ${listing.hostName ?? "The host"} has 24 hours to accept; then you pay to confirm.`}</p>
          <div className="mt-5">{quote ? <PriceBreakdown p={quote} totalLabel="Total (incl. GST)" /> : <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-5" />)}</div>}</div>
          <p className="mt-3 text-xs text-muted">{listing.policyName} cancellation policy applies.</p>
        </>
      )}
      {!complete && listing.minNights && listing.minNights > 1 ? <p className="mt-3 text-center text-sm text-muted">Minimum stay: {plural(listing.minNights, "night")}</p> : null}
    </div>
  );
}
