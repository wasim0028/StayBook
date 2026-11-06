export type CancellationPolicy = "FLEXIBLE" | "MODERATE" | "STRICT";
export type ListingStatus = "DRAFT" | "PUBLISHED" | "SUSPENDED";
export type PropertyType = "apartment" | "house" | "villa" | "room" | "hotel" | "homestay" | "cabin";
export type NightStatus = "FREE" | "HELD" | "BOOKED" | "BLOCKED";

export const PROPERTY_TYPES: readonly PropertyType[] = [
  "apartment",
  "house",
  "villa",
  "room",
  "hotel",
  "homestay",
  "cabin",
];

export const AMENITIES = [
  "wifi",
  "kitchen",
  "ac",
  "heating",
  "parking",
  "pool",
  "washer",
  "tv",
  "workspace",
  "gym",
  "breakfast",
  "pets_allowed",
  "balcony",
  "hot_tub",
] as const;
export type Amenity = (typeof AMENITIES)[number];

/** Amounts are integer paise (INR). Never use floats for money. */
export interface Listing {
  id: string;
  hostId: string;
  title: string;
  description: string;
  propertyType: PropertyType;
  city: string;
  country: string;
  lat: number;
  lng: number;
  basePricePaise: number;
  currency: "INR";
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  amenities: string[];
  /** S3 object keys; the API turns them into CDN URLs. */
  photos: string[];
  cancellationPolicy: CancellationPolicy;
  // Pricing (optional on listings created before itemised pricing; see pricingOf())
  cleaningFeePaise?: number;
  weeklyDiscountPct?: number;
  monthlyDiscountPct?: number;
  minNights?: number;
  maxNights?: number;
  guestsIncluded?: number;
  extraGuestFeePaise?: number;
  /** Default true. False = guests send a request and the host approves within 24h. */
  instantBook?: boolean;
  /** Set daily by host-evaluator from the host's record. */
  hostSuperhost?: boolean;
  status: ListingStatus;
  /** Optimistic concurrency counter. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Host profile fields owned by user-svc; listing-svc only reads them to gate publishing. */
export interface HostProfile {
  userId: string;
  razorpayAccountId?: string;
  razorpayAccountStatus?: "created" | "needs_clarification" | "under_review" | "activated" | "suspended" | "rejected";
  gstin?: string;
}

export interface Night {
  date: string;
  status: NightStatus;
  pricePaise?: number;
  holdExpiresAt?: number;
}

/** A night can be sold if it is FREE or its payment hold has lapsed. */
export function isNightAvailable(n: Pick<Night, "status" | "holdExpiresAt">, nowEpoch: number): boolean {
  if (n.status === "FREE") return true;
  return n.status === "HELD" && typeof n.holdExpiresAt === "number" && n.holdExpiresAt < nowEpoch;
}

export interface SearchResult {
  id: string;
  title: string;
  propertyType: PropertyType;
  city: string;
  lat: number;
  lng: number;
  pricePaise: number;
  /** Present only when check-in/out were supplied. */
  totalPaise?: number;
  nights?: number;
  maxGuests: number;
  bedrooms: number;
  coverPhotoUrl: string | null;
  ratingAvg?: number;
  ratingCount?: number;
  /** Flexible-date results: the window that was found. */
  checkIn?: string;
  checkOut?: string;
  minNights?: number;
  instantBook?: boolean;
  superhost?: boolean;
}
