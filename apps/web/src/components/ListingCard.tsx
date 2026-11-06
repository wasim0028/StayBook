import { Award, ImageOff, Zap } from "lucide-react";
import Link from "next/link";
import { PROPERTY_LABEL } from "@/lib/amenities";
import { formatINR, formatRange, plural } from "@/lib/format";
import type { SearchResult, WishlistItem } from "@/lib/types";
import { HeartButton } from "./HeartButton";
import { Rating } from "./Stars";

type CardData = Pick<SearchResult, "id" | "title" | "city" | "propertyType" | "pricePaise" | "coverPhotoUrl" | "ratingAvg" | "ratingCount"> & Partial<Pick<SearchResult, "totalPaise" | "nights" | "bedrooms" | "maxGuests" | "checkIn" | "checkOut" | "minNights" | "instantBook" | "superhost">>;

export function ListingCard({ l, saved, signedIn, query }: { l: CardData | WishlistItem; saved: boolean; signedIn: boolean; query?: string }) {
  const c = l as CardData;
  return (
    <Link href={`/listing/${l.id}${query ? `?${query}` : ""}`} className="group block" data-testid="listing-card">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-surface-2">
        {l.coverPhotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={l.coverPhotoUrl} alt={l.title} loading="lazy" className="size-full object-cover transition duration-500 group-hover:scale-105" />
        ) : (
          <div className="grid size-full place-items-center text-muted">
            <ImageOff className="size-8" aria-hidden />
          </div>
        )}
        <HeartButton listingId={l.id} saved={saved} signedIn={signedIn} className="absolute right-3 top-3" />
        {c.superhost && <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-surface/95 px-2.5 py-1 text-xs font-bold shadow-sm"><Award className="size-3.5 text-brand" /> Superhost</span>}
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1 truncate font-semibold">{c.instantBook && <Zap className="size-3.5 shrink-0 fill-current" aria-label="Instant Book" />}<span className="truncate">{l.title}</span></h3>
          <p className="truncate text-sm text-muted">
            {PROPERTY_LABEL[l.propertyType] ?? l.propertyType} · {l.city}
            {c.bedrooms != null ? ` · ${plural(c.bedrooms, "bedroom")}` : ""}
          </p>
        </div>
        <Rating avg={l.ratingAvg} count={l.ratingCount} className="shrink-0 pt-0.5" />
      </div>
      {c.checkIn && <p className="text-sm text-muted">{formatRange(c.checkIn, c.checkOut)}</p>}
      <p className="mt-1 text-[15px]">
        {c.totalPaise != null && c.nights ? (
          <>
            <span className="font-semibold">{formatINR(c.totalPaise)}</span> <span className="text-muted">total for {plural(c.nights, "night")}</span>
          </>
        ) : (
          <>
            <span className="font-semibold">{formatINR(l.pricePaise)}</span> <span className="text-muted">night</span>
          </>
        )}
      </p>
    </Link>
  );
}

export function ListingCardSkeleton() {
  return (
    <div aria-hidden>
      <div className="skeleton aspect-[4/3] w-full rounded-2xl" />
      <div className="skeleton mt-3 h-4 w-3/4" />
      <div className="skeleton mt-2 h-3.5 w-1/2" />
    </div>
  );
}
