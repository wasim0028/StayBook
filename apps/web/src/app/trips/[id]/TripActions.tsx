"use client";

import clsx from "clsx";
import { Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ReviewItem } from "@/app/listing/[id]/Reviews";
import { MessageButton } from "@/components/inbox/MessageButton";
import { Alert, Button, Modal, Textarea } from "@/components/ui";
import { POLICY_COPY } from "@/lib/amenities";
import { call, errorMessage } from "@/lib/client-api";
import { formatINR } from "@/lib/format";
import { pay } from "@/lib/razorpay";
import type { Booking, Review } from "@/lib/types";

const RATING_WORDS = ["", "Terrible", "Poor", "Okay", "Good", "Excellent"];

function StarInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="flex items-center gap-3">
      <div role="radiogroup" aria-label="Rating" className="flex" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onMouseEnter={() => setHover(n)} onClick={() => onChange(n)} className="p-0.5">
            <Star className={clsx("size-8 transition", n <= shown ? "fill-brand text-brand" : "text-line")} />
          </button>
        ))}
      </div>
      <span className="text-sm font-medium text-muted">{RATING_WORDS[shown]}</span>
    </div>
  );
}

function ReviewForm({ bookingId, onDone }: { bookingId: string; onDone: (r: Review) => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) return setErr("Pick a star rating first.");
    setBusy(true);
    setErr(undefined);
    try {
      onDone(await call<Review>("/v1/reviews", { method: "POST", body: { bookingId, rating, comment } }));
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="font-semibold">How was your stay?</h2>
      <p className="mt-1 text-sm text-muted">Your review helps other guests and your host.</p>
      <div className="mt-4"><StarInput value={rating} onChange={setRating} /></div>
      <Textarea className="mt-4" placeholder="What did you love? Anything the host could improve?" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Review" />
      {err && <div className="mt-3"><Alert tone="bad">{err}</Alert></div>}
      <Button type="submit" className="mt-4 w-full" loading={busy}>Post review</Button>
    </form>
  );
}

function useSecondsLeft(until?: number) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, until - now) : 0;
}

export function TripActions({ booking: b, canReview, review: initialReview }: { booking: Booking; canReview: boolean; review: Review | null }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState<"cancel" | "pay" | null>(null);
  const [err, setErr] = useState<string>();
  const [review, setReview] = useState(initialReview);
  const left = useSecondsLeft(b.status === "PENDING_PAYMENT" ? b.holdExpiresAt : undefined);

  // While waiting on the host or the payment webhook, refresh until the status moves on.
  useEffect(() => {
    if (b.status !== "PENDING_PAYMENT" && b.status !== "REQUESTED") return;
    const t = setInterval(() => router.refresh(), b.status === "REQUESTED" ? 30_000 : 5000);
    return () => clearInterval(t);
  }, [b.status, router]);

  async function cancel() {
    setBusy("cancel");
    setErr(undefined);
    try {
      await call(`/v1/bookings/${b.bookingId}/cancel`, { method: "POST" });
      setConfirmOpen(false);
      router.refresh();
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setBusy(null);
    }
  }

  async function payNow() {
    if (!b.payment) return;
    setBusy("pay");
    setErr(undefined);
    try {
      const r = await pay({ keyId: b.payment.keyId, orderId: b.payment.orderId, amountPaise: b.payment.amountPaise, title: b.listingTitle ?? "Your stay", bookingId: b.bookingId });
      if (r === "paid") router.replace(`/trips/${b.bookingId}?paid=1`);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const policy = b.cancellationPolicy ? POLICY_COPY[b.cancellationPolicy] : undefined;
  const cancellable = b.status === "CONFIRMED" || b.status === "PENDING_PAYMENT" || b.status === "REQUESTED";

  return (
    <div className="space-y-4">
      {b.status === "PENDING_PAYMENT" && (
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Finish booking</h2>
          {b.payment && left > 0 ? (
            <>
              <p className="mt-1 text-sm text-muted">Your dates are held for {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} more.</p>
              <Button className="mt-4 w-full" size="lg" onClick={payNow} loading={busy === "pay"}>Pay {formatINR(b.payment.amountPaise)}</Button>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">Checking your payment… If you didn&apos;t pay, this hold will lapse shortly.</p>
          )}
        </div>
      )}

      {err && <Alert tone="bad">{err}</Alert>}

      <MessageButton start={{ bookingId: b.bookingId }} label="Message host" className="[&_button]:w-full" />

      {review ? (
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="mb-4 font-semibold">Your review</h2>
          <ReviewItem r={review} />
        </div>
      ) : canReview ? (
        <ReviewForm bookingId={b.bookingId} onDone={setReview} />
      ) : null}

      {cancellable && (
        <Button variant="outline" className="w-full" onClick={() => setConfirmOpen(true)}>
          {b.status === "REQUESTED" ? "Withdraw request" : b.status === "PENDING_PAYMENT" ? "Release these dates" : "Cancel reservation"}
        </Button>
      )}

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={b.status === "REQUESTED" ? "Withdraw your request?" : b.status === "PENDING_PAYMENT" ? "Release your hold?" : "Cancel this reservation?"}>
        {b.status === "CONFIRMED" ? (
          <p className="text-[15px] text-muted">
            {policy ? <>This stay has a <span className="font-semibold text-fg">{policy.name}</span> policy: {policy.summary} </> : null}
            We&apos;ll show your exact refund as soon as it&apos;s cancelled. This can&apos;t be undone.
          </p>
        ) : (
          <p className="text-[15px] text-muted">Nothing has been charged. The dates go back on sale for other guests.</p>
        )}
        {err && <div className="mt-3"><Alert tone="bad">{err}</Alert></div>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Keep it</Button>
          <Button variant="danger" onClick={cancel} loading={busy === "cancel"}>{b.status === "REQUESTED" ? "Withdraw" : b.status === "PENDING_PAYMENT" ? "Release" : "Cancel reservation"}</Button>
        </div>
      </Modal>
    </div>
  );
}
