"use client";

import { Star } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";
import { call } from "@/lib/client-api";
import { formatRating, timeAgo } from "@/lib/format";
import type { Page, Review } from "@/lib/types";

export function ReviewItem({ r }: { r: Review }) {
  return (
    <article>
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-full bg-surface-2 font-semibold">{r.guestName.charAt(0).toUpperCase()}</div>
        <div>
          <div className="font-semibold">{r.guestName}</div>
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="flex" aria-label={`${r.rating} out of 5`}>
              {Array.from({ length: 5 }, (_, i) => (
                <Star key={i} className={`size-3 ${i < r.rating ? "fill-fg text-fg" : "text-line"}`} aria-hidden />
              ))}
            </span>
            · {timeAgo(r.createdAt)}
          </div>
        </div>
      </div>
      {r.comment && <p className="mt-3 leading-relaxed">{r.comment}</p>}
      {r.hostReply && (
        <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">
          <div className="font-semibold">Response from host</div>
          <p className="mt-1 text-fg/90">{r.hostReply}</p>
        </div>
      )}
    </article>
  );
}

export function Reviews({ listingId, initial, ratingAvg, ratingCount }: { listingId: string; initial: Page<Review>; ratingAvg?: number; ratingCount?: number }) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor ?? null);
  const [loading, setLoading] = useState(false);

  async function more() {
    if (!cursor) return;
    setLoading(true);
    try {
      const r = await call<Page<Review>>(`/v1/reviews/listing/${listingId}?limit=10&cursor=${encodeURIComponent(cursor)}`);
      setItems((x) => [...x, ...r.items]);
      setCursor(r.nextCursor ?? null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 className="flex items-center gap-2 text-xl font-semibold">
        <Star className="size-5 fill-current" aria-hidden />
        {ratingCount ? `${formatRating(ratingAvg)} · ${ratingCount} review${ratingCount === 1 ? "" : "s"}` : "No reviews yet"}
      </h2>
      {items.length === 0 ? (
        <p className="mt-2 text-muted">Guests who stay here can leave a review after check-out.</p>
      ) : (
        <div className="mt-6 grid gap-8 md:grid-cols-2">
          {items.map((r) => (
            <ReviewItem key={r.bookingId} r={r} />
          ))}
        </div>
      )}
      {cursor && (
        <Button variant="outline" className="mt-8" onClick={more} loading={loading}>
          Show more reviews
        </Button>
      )}
    </div>
  );
}
