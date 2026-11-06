import { DeleteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DdbContext } from "./ddb.js";
import { isConditionalFailure } from "./ddb.js";
import { nightKey } from "./keys.js";
import type { CancellationPolicy } from "./types.js";

export type BookingStatus =
  | "REQUESTED" //       request-to-book: nights HELD, waiting for the host (24h)
  | "DECLINED" //        host said no (or the request lapsed unanswered: see expiredReason)
  | "PENDING_PAYMENT" // nights HELD, waiting for payment.captured
  | "CONFIRMED" //       paid, nights BOOKED
  | "EXPIRED" //         hold lapsed (or order creation failed) before payment
  | "CANCELLED" //       cancelled by guest, host or admin
  | "CHECKED_IN"
  | "COMPLETED";

export type RefundStatus = "PENDING" | "IN_PROGRESS" | "INITIATED" | "PROCESSED" | "FAILED";

/** Stored at BOOKING#<id> / META. Money is integer paise. */
export interface BookingRecord {
  bookingId: string;
  listingId: string;
  hostId: string;
  guestId: string;
  listingTitle: string;
  coverPhotoId?: string;
  checkIn: string;
  checkOut: string;
  nights: string[];
  nightPrices: number[];
  guests: number;
  totalPaise: number;
  /** Price breakdown at booking time (absent on bookings made before itemised pricing). */
  price?: import("./pricing.js").Quote;
  /** GST the platform remits itself (host not GST-registered); otherwise included in the host payout. */
  platformGstPaise?: number;
  platformFeePaise: number;
  hostPayoutPaise: number;
  currency: "INR";
  cancellationPolicy: CancellationPolicy;
  status: BookingStatus;
  /** False when the listing required the host's approval (request to book). */
  instantBook?: boolean;
  /** Guest's note to the host with a request. */
  requestMessage?: string;
  acceptedAt?: string;
  declinedAt?: string;
  declineReason?: string;
  holdExpiresAt?: number;
  orderId?: string;
  paymentId?: string;
  confirmedAt?: string;
  cancelledAt?: string;
  cancelledBy?: "guest" | "host" | "admin";
  refundPaise?: number;
  hostReversalPaise?: number;
  hostReversalId?: string;
  refundId?: string;
  refundStatus?: RefundStatus;
  refundError?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------- times (all listings are in India; check-in 14:00 IST, check-out 11:00 IST) ----------

const IST_OFFSET_MIN = 330;

function istEpoch(date: string, hour: number): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Math.floor((Date.UTC(y, m - 1, d, hour, 0) - IST_OFFSET_MIN * 60_000) / 1000);
}

export const CHECK_IN_HOUR = 14;
export const CHECK_OUT_HOUR = 11;
export const checkInEpoch = (date: string) => istEpoch(date, CHECK_IN_HOUR);
export const checkOutEpoch = (date: string) => istEpoch(date, CHECK_OUT_HOUR);

/** Request-to-book: the host has this long to answer; after accepting, the guest this long to pay. */
export const REQUEST_WINDOW_SECONDS = 24 * 3600;
export const PAY_AFTER_ACCEPT_SECONDS = 12 * 3600;

/** Host money stays frozen in Razorpay until 24h after check-out (dispute window). */
export const PAYOUT_HOLD_AFTER_CHECKOUT_SECONDS = 24 * 3600;

// ---------- money ----------

export function splitPayment(totalPaise: number, platformFeePct: number) {
  if (!Number.isInteger(totalPaise) || totalPaise <= 0) throw new RangeError("total must be positive paise");
  if (platformFeePct < 0 || platformFeePct >= 100) throw new RangeError("fee pct out of range");
  const platformFeePaise = Math.round((totalPaise * platformFeePct) / 100);
  return { platformFeePaise, hostPayoutPaise: totalPaise - platformFeePaise };
}

// ---------- cancellation policy ----------

export interface RefundDecision {
  refundPaise: number;
  /** Portion of the host's transfer to pull back, proportional to the refund. */
  hostReversalPaise: number;
  rule: string;
}

/**
 * Guest-initiated cancellation refunds.
 *   FLEXIBLE: full refund until 24h before check-in, then everything except the first night.
 *   MODERATE: full refund until 5 days before check-in, then 50%.
 *   STRICT:   50% until 7 days before check-in, then nothing.
 * Host/admin cancellations always refund in full (see fullRefund).
 * Returns null once check-in time has passed: cancellation then goes through support.
 */
/**
 * What a late flexible cancellation keeps: the first night, after any length-of-stay discount, plus its
 * tax. The cleaning fee is refunded (the guest never arrived).
 */
export function firstNightCharge(b: Pick<BookingRecord, "nightPrices" | "price" | "totalPaise">): number {
  const first = b.nightPrices[0] ?? 0;
  if (!b.price) return Math.min(first, b.totalPaise);
  const net = first - Math.round((first * b.price.discountPct) / 100) + (b.price.extraGuestPaise ? Math.round(b.price.extraGuestPaise / b.price.nights) : 0);
  return Math.min(b.totalPaise, net + Math.round((net * b.price.gstRatePct) / 100));
}

export function guestRefund(b: Pick<BookingRecord, "cancellationPolicy" | "totalPaise" | "hostPayoutPaise" | "nightPrices" | "checkIn" | "price">, nowEpoch: number): RefundDecision | null {
  const secondsBefore = checkInEpoch(b.checkIn) - nowEpoch;
  if (secondsBefore <= 0) return null;
  const days = secondsBefore / 86_400;

  let refund: number;
  let rule: string;
  switch (b.cancellationPolicy) {
    case "FLEXIBLE":
      if (days >= 1) [refund, rule] = [b.totalPaise, "flexible: full refund (24h+ before check-in)"];
      else [refund, rule] = [b.totalPaise - firstNightCharge(b), "flexible: first night charged (<24h before check-in)"];
      break;
    case "MODERATE":
      if (days >= 5) [refund, rule] = [b.totalPaise, "moderate: full refund (5+ days before check-in)"];
      else [refund, rule] = [Math.floor(b.totalPaise / 2), "moderate: 50% refund (<5 days before check-in)"];
      break;
    case "STRICT":
      if (days >= 7) [refund, rule] = [Math.floor(b.totalPaise / 2), "strict: 50% refund (7+ days before check-in)"];
      else [refund, rule] = [0, "strict: no refund (<7 days before check-in)"];
      break;
    default:
      throw new Error(`unknown cancellation policy: ${String(b.cancellationPolicy)}`);
  }
  return { refundPaise: refund, hostReversalPaise: hostShareOf(refund, b), rule };
}

export function fullRefund(b: Pick<BookingRecord, "totalPaise" | "hostPayoutPaise">, who: "host" | "admin"): RefundDecision {
  return { refundPaise: b.totalPaise, hostReversalPaise: b.hostPayoutPaise, rule: `${who} cancellation: full refund` };
}

function hostShareOf(refundPaise: number, b: Pick<BookingRecord, "totalPaise" | "hostPayoutPaise">): number {
  if (refundPaise >= b.totalPaise) return b.hostPayoutPaise;
  return Math.round((refundPaise * b.hostPayoutPaise) / b.totalPaise);
}

// ---------- nights ----------

/**
 * Deletes night items still owned by this booking (status in `statuses`). Nights that someone else
 * has since taken are left alone. Missing night items mean FREE, so deleting is how nights are released.
 */
export async function releaseNights(
  ctx: DdbContext,
  listingId: string,
  nights: string[],
  bookingId: string,
  statuses: ("HELD" | "BOOKED")[],
): Promise<{ released: string[]; skipped: string[] }> {
  const released: string[] = [];
  const skipped: string[] = [];
  const values: Record<string, unknown> = { ":b": bookingId };
  statuses.forEach((s, i) => (values[`:s${i}`] = s));
  const statusList = statuses.map((_, i) => `:s${i}`).join(", ");

  for (let i = 0; i < nights.length; i += 10) {
    await Promise.all(
      nights.slice(i, i + 10).map(async (date) => {
        try {
          await ctx.doc.send(
            new DeleteCommand({
              TableName: ctx.table,
              Key: nightKey(listingId, date),
              // Keep host price overrides: a night with a custom price is reset to FREE instead of deleted.
              ConditionExpression: `bookingId = :b AND #s IN (${statusList}) AND attribute_not_exists(pricePaise)`,
              ExpressionAttributeNames: { "#s": "status" },
              ExpressionAttributeValues: values,
            }),
          );
          released.push(date);
        } catch (e) {
          if (!isConditionalFailure(e)) throw e;
          if (await resetOverriddenNight(ctx, listingId, date, bookingId, statuses)) released.push(date);
          else skipped.push(date);
        }
      }),
    );
  }
  return { released: released.sort(), skipped: skipped.sort() };
}

async function resetOverriddenNight(
  ctx: DdbContext,
  listingId: string,
  date: string,
  bookingId: string,
  statuses: string[],
): Promise<boolean> {
  const values: Record<string, unknown> = { ":b": bookingId, ":free": "FREE" };
  statuses.forEach((s, i) => (values[`:s${i}`] = s));
  try {
    await ctx.doc.send(
      new UpdateCommand({
        TableName: ctx.table,
        Key: nightKey(listingId, date),
        UpdateExpression: "SET #s = :free REMOVE bookingId, holdExpiresAt",
        ConditionExpression: `bookingId = :b AND #s IN (${statuses.map((_, i) => `:s${i}`).join(", ")})`,
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: values,
      }),
    );
    return true;
  } catch (e) {
    if (isConditionalFailure(e)) return false;
    throw e;
  }
}
