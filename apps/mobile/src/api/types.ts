// Wire types, mirroring the service responses (and apps/web/src/lib/types.ts).

export interface SearchResult {
  id: string;
  title: string;
  propertyType: string;
  city: string;
  lat: number;
  lng: number;
  pricePaise: number;
  totalPaise?: number;
  nights?: number;
  maxGuests: number;
  bedrooms: number;
  coverPhotoUrl: string | null;
  ratingAvg?: number;
  ratingCount?: number;
  checkIn?: string;
  checkOut?: string;
  instantBook?: boolean;
  superhost?: boolean;
}

export interface SearchResponse {
  results: SearchResult[];
  truncated: boolean;
  cellsQueried: number;
  currency: "INR";
}

export interface Listing {
  id: string;
  hostId: string;
  title: string;
  description: string;
  propertyType: string;
  city: string;
  lat: number;
  lng: number;
  basePricePaise: number;
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  amenities: string[];
  photoUrls: string[];
  cancellationPolicy: "FLEXIBLE" | "MODERATE" | "STRICT";
  status?: "DRAFT" | "PUBLISHED" | "SUSPENDED";
  minNights?: number;
  instantBook?: boolean;
  host?: HostSummary | null;
  ratingAvg?: number;
  ratingCount?: number;
}

export interface CalendarResponse {
  listingId: string;
  nights: { date: string; available: boolean; pricePaise: number }[];
}

export type BookingStatus =
  | "REQUESTED"
  | "DECLINED"
  | "PENDING_PAYMENT"
  | "CONFIRMED"
  | "EXPIRED"
  | "CANCELLED"
  | "CHECKED_IN"
  | "COMPLETED";

/** POST /v1/bookings (booking-svc). Sent with an Idempotency-Key header. */
export interface CreateBookingRequest {
  listingId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  message?: string;
}

export interface CreateBookingResponse {
  bookingId: string;
  status: BookingStatus;
  totalPaise: number;
  holdExpiresAt: number; // epoch seconds
  /** null for a request to book: payment comes after the host accepts. */
  payment: { orderId: string; keyId: string; amountPaise: number } | null;
}

export interface Booking {
  bookingId: string;
  listingId: string;
  listingTitle?: string;
  coverPhotoUrl?: string | null;
  checkIn: string;
  checkOut: string;
  guests: number;
  totalPaise: number;
  status: BookingStatus;
  cancellationPolicy?: "FLEXIBLE" | "MODERATE" | "STRICT";
  holdExpiresAt?: number;
  cancelledBy?: "guest" | "host" | "admin";
  refundPaise?: number;
  refundStatus?: "PENDING" | "IN_PROGRESS" | "INITIATED" | "PROCESSED" | "FAILED";
  createdAt?: string;
  /** Host / admin view only. */
  hostPayoutPaise?: number;
  platformFeePaise?: number;
  price?: PriceBreakdown;
  instantBook?: boolean;
  requestMessage?: string;
  declineReason?: string;
  expiredReason?: string;
  guestId?: string;
  /** Only on the guest's own unpaid, unexpired hold. */
  payment?: { orderId: string; keyId: string; amountPaise: number };
}

export interface Page<T> {
  items: T[];
  nextCursor?: string | null;
}

export interface Review {
  bookingId: string;
  listingId: string;
  guestName: string;
  rating: number;
  comment: string;
  createdAt: string;
  hostReply: string | null;
  hostRepliedAt: string | null;
}

export type PayoutStatus = "created" | "needs_clarification" | "under_review" | "activated" | "suspended" | "rejected";

export interface Me {
  userId: string;
  displayName: string | null;
  bio: string | null;
  phone: string | null;
  isHost: boolean;
  host: null | {
    onboardingStep: "account" | "stakeholder" | "product" | "settlement" | "done";
    payoutStatus: PayoutStatus;
    canPublish: boolean;
    legalBusinessName: string | null;
    bankLast4: string | null;
  };
  createdAt: string;
}

export interface WishlistItem {
  id: string;
  title: string;
  city: string;
  propertyType: string;
  pricePaise: number;
  coverPhotoUrl: string | null;
  ratingAvg?: number;
  ratingCount?: number;
}

/** A host's own listing (GET /v1/host/listings). */
export interface HostListing extends Listing {
  status: "DRAFT" | "PUBLISHED" | "SUSPENDED";
  photos: string[];
  version: number;
}

// ---------- messaging (message-svc) ----------

export interface InboxThread {
  threadId: string;
  role: "guest" | "host";
  otherUserId: string;
  otherName: string;
  listingId: string;
  listingTitle: string;
  coverPhotoUrl: string | null;
  unread: number;
  lastMessageAt: string | null;
  lastPreview: string | null;
  lastFromMe: boolean;
}

export interface ThreadDetail {
  threadId: string;
  role: "guest" | "host" | "admin";
  listingId: string;
  listingTitle: string;
  coverPhotoUrl: string | null;
  otherName: string | null;
  contactSharing: boolean;
  bookings: { bookingId: string; checkIn: string; checkOut: string; status: BookingStatus; guests: number }[];
}

export interface ChatMessage {
  messageId: string;
  senderId: string;
  senderName: string;
  mine: boolean;
  body: string;
  masked: boolean;
  createdAt: string;
  cursor: string;
  pending?: boolean;
  failed?: boolean;
}

// ---------- pricing & trust ----------

export interface PriceBreakdown {
  nights: number;
  nightlySubtotalPaise: number;
  extraGuests: number;
  extraGuestPaise: number;
  discountKind: "weekly" | "monthly" | null;
  discountPct: number;
  discountPaise: number;
  cleaningFeePaise: number;
  valuePaise: number;
  gstRatePct: number;
  gstPaise: number;
  totalPaise: number;
}

export interface Quote extends PriceBreakdown {
  available: boolean;
  unavailable: string[];
}

export interface HostSummary {
  name: string;
  hostingSince: string | null;
  superhost: boolean;
  identityVerified: boolean;
  responseRatePct: number | null;
  reviews: number | null;
  ratingAvg: number | null;
}

export interface GuestReviews {
  ratingAvg: number | null;
  ratingCount: number;
  items: { bookingId: string; hostName: string; listingTitle: string; rating: number; comment: string; createdAt: string }[];
}
