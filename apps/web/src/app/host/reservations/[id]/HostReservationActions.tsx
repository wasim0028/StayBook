"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ReviewItem } from "@/app/listing/[id]/Reviews";
import { MessageButton } from "@/components/inbox/MessageButton";
import { Alert, Button, Modal, Textarea } from "@/components/ui";
import { call, errorMessage } from "@/lib/client-api";
import { formatINR } from "@/lib/format";
import type { Booking, Review } from "@/lib/types";

export function HostReservationActions({ booking: b, review: initial, canReviewGuest = false, myGuestReview = null }: { booking: Booking; review: Review | null; canReviewGuest?: boolean; myGuestReview?: { rating: number; comment: string } | null }) {
  const router = useRouter();
  const [review, setReview] = useState(initial);
  const [reply, setReply] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"cancel" | "reply" | "accept" | "decline" | "greview" | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineWhy, setDeclineWhy] = useState("");
  const [gRating, setGRating] = useState(0);
  const [gComment, setGComment] = useState("");
  const [gDone, setGDone] = useState(myGuestReview);

  async function answer(kind: "accept" | "decline") {
    setBusy(kind);
    setErr(undefined);
    try {
      await call(`/v1/bookings/${b.bookingId}/${kind}`, { method: "POST", body: kind === "decline" && declineWhy.trim() ? { reason: declineWhy.trim() } : undefined });
      setDeclineOpen(false);
      router.refresh();
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setBusy(null);
    }
  }

  async function reviewGuest(e: React.FormEvent) {
    e.preventDefault();
    if (!gRating) return;
    setBusy("greview");
    setErr(undefined);
    try {
      setGDone(await call<{ rating: number; comment: string }>("/v1/reviews/guests", { method: "POST", body: { bookingId: b.bookingId, rating: gRating, comment: gComment.trim() } }));
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setBusy(null);
    }
  }
  const [err, setErr] = useState<string>();

  async function cancel() {
    setBusy("cancel");
    setErr(undefined);
    try {
      await call(`/v1/bookings/${b.bookingId}/cancel`, { method: "POST" });
      setOpen(false);
      router.refresh();
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setBusy(null);
    }
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setBusy("reply");
    setErr(undefined);
    try {
      setReview(await call<Review>(`/v1/reviews/by-booking/${b.bookingId}/reply`, { method: "POST", body: { text: reply.trim() } }));
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {b.status === "REQUESTED" && (
        <div className="rounded-2xl border-2 border-fg bg-surface p-5">
          <h2 className="text-lg font-semibold">Respond to this request</h2>
          <p className="mt-1 text-sm text-muted">
            Accepting sends the guest a payment link; the booking is confirmed when they pay. Respond by {b.holdExpiresAt ? new Date(b.holdExpiresAt * 1000).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "the deadline"}, or the request expires and counts against your response rate.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => answer("accept")} loading={busy === "accept"}>Accept</Button>
            <Button variant="outline" onClick={() => setDeclineOpen(true)}>Decline</Button>
          </div>
        </div>
      )}
      {b.status !== "EXPIRED" && b.status !== "DECLINED" && <MessageButton start={{ bookingId: b.bookingId }} label="Message guest" variant="secondary" />}

      {gDone ? (
        <div className="rounded-2xl border border-line bg-surface p-5 text-sm"><span className="font-semibold">Your review of this guest:</span> {"★".repeat(gDone.rating)} {gDone.comment && <span className="text-muted">“{gDone.comment}”</span>}</div>
      ) : canReviewGuest ? (
        <form onSubmit={reviewGuest} className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-semibold">How was this guest?</h2>
          <p className="mt-1 text-sm text-muted">Your review helps other hosts. Guests see it on their profile.</p>
          <div className="mt-3 flex gap-1" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={gRating === n} aria-label={`${n} stars`} onClick={() => setGRating(n)} className={`text-3xl ${n <= gRating ? "text-brand" : "text-line"}`}>★</button>
            ))}
          </div>
          <Textarea className="mt-3" maxLength={1000} value={gComment} onChange={(e) => setGComment(e.target.value)} placeholder="Were they communicative, respectful of house rules, and did they leave the place tidy?" />
          <Button type="submit" className="mt-3" disabled={!gRating} loading={busy === "greview"}>Post review</Button>
        </form>
      ) : null}

      <Modal open={declineOpen} onClose={() => setDeclineOpen(false)} title="Decline this request?">
        <p className="text-[15px] text-muted">The dates go back on sale and the guest isn&apos;t charged. Declining often can affect how your listing ranks.</p>
        <label htmlFor="why" className="mt-4 block text-sm font-medium">Reason for the guest (optional)</label>
        <Textarea id="why" className="mt-1.5 min-h-20" maxLength={500} value={declineWhy} onChange={(e) => setDeclineWhy(e.target.value)} placeholder="e.g. Sorry, we're hosting family that week." />
        {err && <div className="mt-3"><Alert tone="bad">{err}</Alert></div>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeclineOpen(false)}>Back</Button>
          <Button variant="danger" onClick={() => answer("decline")} loading={busy === "decline"}>Decline request</Button>
        </div>
      </Modal>
      {err && !open && <Alert tone="bad">{err}</Alert>}
      {review && (
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="mb-4 font-semibold">Guest review</h2>
          <ReviewItem r={review} />
          {!review.hostReply && (
            <form onSubmit={sendReply} className="mt-5 border-t border-line pt-5">
              <label htmlFor="reply" className="text-sm font-medium">Reply publicly (once)</label>
              <Textarea id="reply" className="mt-1.5" maxLength={500} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Thank the guest, or respond to their feedback." />
              <Button type="submit" className="mt-3" loading={busy === "reply"} disabled={!reply.trim()}>Post reply</Button>
            </form>
          )}
        </div>
      )}

      {b.status === "CONFIRMED" && (
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Need to cancel?</h2>
          <p className="mt-1 text-sm text-muted">Host cancellations refund the guest in full and can affect your listing&apos;s ranking. Only possible before check-in.</p>
          <Button variant="outline" className="mt-4" onClick={() => setOpen(true)}>Cancel reservation</Button>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Cancel this reservation?">
        <p className="text-[15px] text-muted">The guest gets a full refund of {formatINR(b.totalPaise)} and your {formatINR(b.hostPayoutPaise ?? 0)} payout is reversed. This can&apos;t be undone.</p>
        {err && <div className="mt-3"><Alert tone="bad">{err}</Alert></div>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Keep reservation</Button>
          <Button variant="danger" onClick={cancel} loading={busy === "cancel"}>Cancel and refund guest</Button>
        </div>
      </Modal>
    </div>
  );
}
