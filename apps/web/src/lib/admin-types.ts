export const METRIC_FIELDS = ["checkouts", "bookings", "gmvPaise", "feePaise", "nights", "cancellations", "refundPaise", "expired", "signups", "hostsOnboarded", "hostsActivated", "listingsPublished"] as const;
export type MetricField = (typeof METRIC_FIELDS)[number];
export type MetricDay = Record<MetricField, number> & { day: string };

export interface Metrics {
  from: string;
  to: string;
  days: MetricDay[];
  totals: Record<MetricField, number>;
  rates: { conversion: number | null; cancellation: number | null; avgBookingPaise: number | null };
}

export interface Overview {
  today: MetricDay;
  last7: Pick<Metrics, "totals" | "rates">;
  queues: null | { refunds: { count: number; more: boolean }; hosts: { count: number; more: boolean } };
}

export interface RefundEntry {
  bookingId: string;
  listingTitle?: string;
  guestId: string;
  hostId: string;
  guestName: string | null;
  hostName: string | null;
  totalPaise: number;
  refundPaise?: number;
  refundStatus: "FAILED" | "PENDING" | "IN_PROGRESS";
  refundError?: string;
  cancelledBy?: string;
  since: string;
}

export interface HostEntry {
  userId: string;
  displayName?: string;
  hostName: string | null;
  legalBusinessName?: string;
  onboardingStep?: string;
  payoutStatus?: string;
  reason: string;
  since: string;
}

export interface ListingEntry {
  listingId: string;
  hostId: string;
  hostName: string | null;
  title: string;
  city: string;
  status: "PUBLISHED" | "DRAFT" | "SUSPENDED";
  basePricePaise: number;
  photoCount: number;
  ratingAvg?: number;
  ratingCount?: number;
  since: string;
}

export interface DirectoryUser {
  userId: string;
  email: string | null;
  name: string | null;
  enabled: boolean;
  status: string;
  createdAt: string | null;
  groups?: string[];
}

export interface AdminUser {
  userId: string;
  account: DirectoryUser | null;
  profile: Record<string, unknown> | null;
  listings: Record<string, unknown>[];
  hostBookings: Record<string, unknown>[];
  trips: Record<string, unknown>[];
}

export interface AuditItem {
  at: string;
  actor: string;
  action: string;
  targetType: "booking" | "listing" | "user";
  targetId: string;
  detail?: Record<string, unknown>;
}

export const METRIC_LABEL: Record<MetricField, string> = {
  checkouts: "Checkouts started",
  bookings: "Paid bookings",
  gmvPaise: "Gross bookings (GMV)",
  feePaise: "Platform fees",
  nights: "Nights booked",
  cancellations: "Cancellations",
  refundPaise: "Refunds",
  expired: "Holds expired",
  signups: "Sign-ups",
  hostsOnboarded: "Hosts onboarded",
  hostsActivated: "Hosts activated",
  listingsPublished: "Listings published",
};
export const isMoney = (f: MetricField) => f.endsWith("Paise");
