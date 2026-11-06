// Wire types shared by server components and the browser. Mirrors the service contracts.

export type PropertyType = "apartment" | "house" | "villa" | "room" | "hotel" | "homestay" | "cabin";
export type CancellationPolicy = "FLEXIBLE" | "MODERATE" | "STRICT";

export interface SearchResult {
  id: string;
  title: string;
  propertyType: PropertyType;
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
  minNights?: number;
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
  propertyType: PropertyType;
  city: string;
  country: string;
  lat: number;
  lng: number;
  basePricePaise: number;
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  amenities: string[];
  photos: string[];
  photoUrls: string[];
  cancellationPolicy: CancellationPolicy;
  cleaningFeePaise?: number;
  weeklyDiscountPct?: number;
  monthlyDiscountPct?: number;
  minNights?: number;
  maxNights?: number;
  guestsIncluded?: number;
  extraGuestFeePaise?: number;
  instantBook?: boolean;
  hostSuperhost?: boolean;
  /** Public listing view only. */
  host?: HostSummary | null;
  status: "DRAFT" | "PUBLISHED" | "SUSPENDED";
  version: number;
  ratingAvg?: number;
  ratingCount?: number;
}

export interface CalendarNight {
  date: string;
  available?: boolean;
  /** Host view only. */
  status?: "FREE" | "HELD" | "BOOKED" | "BLOCKED";
  pricePaise: number;
}

export interface CalendarResponse {
  listingId: string;
  nights: CalendarNight[];
}

export type BookingStatus = "REQUESTED" | "DECLINED" | "PENDING_PAYMENT" | "CONFIRMED" | "EXPIRED" | "CANCELLED" | "CHECKED_IN" | "COMPLETED";

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
  cancellationPolicy?: CancellationPolicy;
  holdExpiresAt?: number;
  cancelledBy?: "guest" | "host" | "admin";
  refundPaise?: number;
  refundStatus?: string;
  createdAt?: string;
  // host / admin view
  hostPayoutPaise?: number;
  platformFeePaise?: number;
  guestId?: string;
  price?: PriceBreakdown;
  instantBook?: boolean;
  requestMessage?: string;
  declineReason?: string;
  expiredReason?: string;
  platformGstPaise?: number;
  /** Present only for the guest's own unpaid, unexpired hold. */
  payment?: { orderId: string; keyId: string; amountPaise: number };
}

export interface CreateBookingResponse {
  bookingId: string;
  status: BookingStatus;
  totalPaise: number;
  holdExpiresAt: number;
  /** null for a request to book: payment comes after the host accepts. */
  payment: { orderId: string; keyId: string; amountPaise: number } | null;
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

export interface Me {
  userId: string;
  displayName: string | null;
  bio: string | null;
  phone: string | null;
  isHost: boolean;
  host: null | {
    onboardingStep: "account" | "stakeholder" | "product" | "settlement" | "done";
    payoutStatus: "created" | "needs_clarification" | "under_review" | "activated" | "suspended" | "rejected";
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
  propertyType: PropertyType;
  pricePaise: number;
  coverPhotoUrl: string | null;
  ratingAvg?: number;
  ratingCount?: number;
}

// ---------- messaging ----------

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
  guestId: string;
  hostId: string;
  otherUserId: string | null;
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
  /** Client-only: not yet confirmed by the server. */
  pending?: boolean;
  failed?: boolean;
}

export interface InboxSummary {
  unread: number;
  version: number;
}

// ---------- pricing ----------

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
  listingId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  available: boolean;
  unavailable: string[];
  nightPrices: number[];
}

// ---------- trust ----------

export interface HostSummary {
  name: string;
  hostingSince: string | null;
  superhost: boolean;
  identityVerified: boolean;
  responseRatePct: number | null;
  reviews: number | null;
  ratingAvg: number | null;
}

export interface GuestReview {
  bookingId: string;
  hostName: string;
  listingTitle: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface GuestReviews {
  ratingAvg: number | null;
  ratingCount: number;
  items: GuestReview[];
}
