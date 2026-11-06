import { encodeGeohash, GEO_PRECISION } from "./geohash.js";

/** Single-table key builders. Keep every key format in this file. */

export const GSI = {
  guestBookings: "GSI1", // GSI1PK=GUEST#<id>   GSI1SK=BOOKING#<createdAt ISO>#<bookingId>
  hostItems: "GSI2", //     GSI2PK=HOST#<id>    GSI2SK=LISTING#<id> | BOOKING#<checkIn>#<bookingId>
  geo: "GSI3", //           GSI3PK=GEO#<hash5>  GSI3SK=PRICE#<paise,10 digits>#<listingId>
  holds: "GSI4", //         GSI4PK=HOLD#<shard> GSI4SK=<holdExpiresAt,10 digits>#<bookingId>  (sparse: PENDING_PAYMENT only)
  ops: "GSI5", //           GSI5PK=QUEUE#<queue> GSI5SK=<ISO time>#<id>   (only on OPSQ# items written by ops-indexer)
} as const;

/** Pending holds are spread over this many GSI4 partitions so one hot key can't throttle checkout. */
export const HOLD_SHARDS = 8;

export const MAX_PRICE_PAISE = 9_999_999_999; // 10 digits, ~INR 99.9 million

export function pricePad(paise: number): string {
  if (!Number.isInteger(paise) || paise < 0 || paise > MAX_PRICE_PAISE) throw new RangeError("invalid price");
  return String(paise).padStart(10, "0");
}

export const listingKey = (id: string) => ({ PK: `LISTING#${id}`, SK: "META" });
export const nightKey = (id: string, date: string) => ({ PK: `LISTING#${id}`, SK: `NIGHT#${date}` });
export const nightSk = (date: string) => `NIGHT#${date}`;
export const userKey = (id: string) => ({ PK: `USER#${id}`, SK: "PROFILE" });

export const hostGsiKeys = (hostId: string, listingId: string) => ({
  GSI2PK: `HOST#${hostId}`,
  GSI2SK: `LISTING#${listingId}`,
});

export function geoCell(lat: number, lng: number): string {
  return `GEO#${encodeGeohash(lat, lng, GEO_PRECISION)}`;
}

export function geoGsiKeys(lat: number, lng: number, pricePaise: number, listingId: string) {
  return {
    GSI3PK: geoCell(lat, lng),
    GSI3SK: `PRICE#${pricePad(pricePaise)}#${listingId}`,
  };
}

// ---------- bookings and payments ----------

export const bookingKey = (id: string) => ({ PK: `BOOKING#${id}`, SK: "META" });
/** Idempotency keys are scoped per user, so two users can't collide on the same client-chosen key. */
export const idempotencyKey = (userId: string, key: string) => ({ PK: `IDEMP#${userId}#${key}`, SK: "META" });
/** Razorpay order id -> booking id, written when the order is attached. The webhook resolves bookings through it. */
export const orderKey = (orderId: string) => ({ PK: `ORDER#${orderId}`, SK: "META" });
/** Guard so a payment is auto-refunded at most once, however often Razorpay retries the webhook. */
export const autoRefundKey = (paymentId: string) => ({ PK: `AUTOREFUND#${paymentId}`, SK: "META" });

export function holdShard(bookingId: string): number {
  let h = 0;
  for (let i = 0; i < bookingId.length; i++) h = (h * 31 + bookingId.charCodeAt(i)) >>> 0;
  return h % HOLD_SHARDS;
}

export const epochPad = (epochSeconds: number) => String(Math.floor(epochSeconds)).padStart(10, "0");

export function holdGsiKeys(bookingId: string, holdExpiresAt: number) {
  return { GSI4PK: `HOLD#${holdShard(bookingId)}`, GSI4SK: `${epochPad(holdExpiresAt)}#${bookingId}` };
}

export const guestBookingGsiKeys = (guestId: string, createdAtIso: string, bookingId: string) => ({
  GSI1PK: `GUEST#${guestId}`,
  GSI1SK: `BOOKING#${createdAtIso}#${bookingId}`,
});

export const hostBookingGsiKeys = (hostId: string, checkIn: string, bookingId: string) => ({
  GSI2PK: `HOST#${hostId}`,
  GSI2SK: `BOOKING#${checkIn}#${bookingId}`,
});

/** Sort-key bounds for a price range inside one geo cell ('~' sorts after every id character). */
export function geoPriceRange(minPaise: number | undefined, maxPaise: number | undefined) {
  return {
    lo: `PRICE#${pricePad(minPaise ?? 0)}`,
    hi: `PRICE#${pricePad(maxPaise ?? MAX_PRICE_PAISE)}#~`,
  };
}

// ---------- operations (ops-indexer + admin-svc) ----------

/**
 * Staff work queues. Each entry is its own item, mirrored from a domain item by ops-indexer, so the
 * services that own bookings, listings and users never carry admin-only attributes.
 */
export const OPS_QUEUES = ["refunds", "hosts", "listings-published", "listings-draft", "listings-suspended"] as const;
export type OpsQueue = (typeof OPS_QUEUES)[number];

/** One mirror item per (source entity, queue family); re-writing it moves the entry between queues. */
export const opsEntryKey = (entity: "BOOKING" | "USER" | "LISTING", id: string, family: "refunds" | "hosts" | "listings") => ({
  PK: `OPSQ#${entity}#${id}`,
  SK: family,
});
export const opsGsiKeys = (queue: OpsQueue, sortTime: string, id: string) => ({ GSI5PK: `QUEUE#${queue}`, GSI5SK: `${sortTime}#${id}` });

/** Daily business counters, one item per IST day. */
export const metricDayKey = (day: string) => ({ PK: "METRIC#DAY", SK: day });
/** Marks a stream record as counted, so at-least-once delivery still counts each change once. */
export const metricMarkKey = (eventId: string) => ({ PK: `OPSMARK#${eventId}`, SK: "META" });

/** Staff actions, partitioned by IST month (YYYY-MM), newest first by SK. */
export const auditKey = (month: string, isoTime: string, id: string) => ({ PK: `AUDIT#${month}`, SK: `${isoTime}#${id}` });

// ---------- messaging (message-svc) ----------

/** One conversation per (listing, guest): asking again about the same place continues the same thread. */
export const threadIdOf = (listingId: string, guestId: string) => `${listingId}_${guestId}`;
export const THREAD_ID_RE = /^[0-9a-f-]{36}_[0-9a-f-]{36}$/i;
export const threadKey = (threadId: string) => ({ PK: `THREAD#${threadId}`, SK: "META" });
export const messageSk = (isoTime: string, messageId: string) => `MSG#${isoTime}#${messageId}`;
/** Guards a client-chosen message id, so a retried send never posts twice. */
export const messageGuardKey = (threadId: string, clientId: string) => ({ PK: `THREAD#${threadId}`, SK: `CLIENTID#${clientId}` });
/** A user's membership in a thread; GSI1 (INBOX#<user>, <lastMessageAt>#<thread>) orders their inbox. */
export const participantKey = (userId: string, threadId: string) => ({ PK: `USER#${userId}`, SK: `THREAD#${threadId}` });
export const inboxGsiKeys = (userId: string, lastMessageAt: string, threadId: string) => ({ GSI1PK: `INBOX#${userId}`, GSI1SK: `${lastMessageAt}#${threadId}` });
/** Per-user unread total and a version that changes on every inbox event (cheap to poll). */
export const inboxStateKey = (userId: string) => ({ PK: `USER#${userId}`, SK: "INBOX" });
export const pushTokenKey = (userId: string, token: string) => ({ PK: `USER#${userId}`, SK: `PUSH#${token}` });

/** Per-host trust counters (response rate, Superhost inputs), at USER#<id> / HOSTSTATS. */
export const hostStatsKey = (hostId: string) => ({ PK: `USER#${hostId}`, SK: "HOSTSTATS" });
/** Hosts are expected to reply within this long to count as "responded". */
export const RESPONSE_WINDOW_SECONDS = 24 * 3600;
