import { DeleteCommand, GetCommand, PutCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  autoRefundKey,
  bookingKey,
  isConditionalFailure,
  nightKey,
  nightTtl,
  normalizeAccountStatus,
  orderKey,
  releaseNights,
  userKey,
  verifyWebhookSignature,
  type BookingRecord,
  type DdbContext,
  type RazorpayApi,
} from "@mp/shared";

/** Lambda Function URL event (payload format 2.0), only the fields used here. */
export interface FunctionUrlEvent {
  body?: string;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
}

export interface Result {
  statusCode: number;
  body: string;
}

export interface Logger {
  info(msg: string, ctx?: object): void;
  warn(msg: string, ctx?: object): void;
  error(msg: string, ctx?: object): void;
}

export interface WebhookDeps {
  ddb: DdbContext;
  razorpay: RazorpayApi;
  webhookSecret: string;
  log: Logger;
  /** Epoch seconds; injectable for tests. */
  clock?: () => number;
}

interface PaymentEntity {
  id: string;
  order_id?: string;
  amount: number;
  currency: string;
  status: string;
}

interface RefundEntity {
  id: string;
  payment_id: string;
  amount: number;
  status: string;
  notes?: Record<string, string> | unknown[];
}

const ok = (body: string): Result => ({ statusCode: 200, body });

/**
 * Razorpay webhook. Subscribe to: payment.captured, payment.failed, refund.processed, refund.failed,
 * and account.under_review/needs_clarification/activated/rejected/suspended (Route linked accounts).
 * (Enable automatic capture on the Razorpay account so payments arrive as captured.)
 *
 * Every path is idempotent: Razorpay retries non-2xx responses for up to 24h, and can deliver an
 * event more than once or out of order. Throwing returns 500, which asks Razorpay to retry.
 */
export function createWebhookHandler(getDeps: () => Promise<WebhookDeps>) {
  return async (event: FunctionUrlEvent): Promise<Result> => {
    const deps = await getDeps();
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : (event.body ?? "");
    const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));

    if (!verifyWebhookSignature(raw, headers["x-razorpay-signature"], deps.webhookSecret)) {
      deps.log.warn("rejected webhook with bad signature");
      return { statusCode: 401, body: "bad signature" };
    }

    let payload: { event?: string; payload?: Record<string, { entity?: unknown }> };
    try {
      payload = JSON.parse(raw);
    } catch {
      return { statusCode: 400, body: "invalid json" };
    }
    const eventId = headers["x-razorpay-event-id"];
    deps.log.info("webhook received", { event: payload.event, eventId });

    switch (payload.event) {
      case "payment.captured":
        return onPaymentCaptured(deps, payload.payload?.payment?.entity as PaymentEntity);
      case "refund.processed":
      case "refund.failed":
        return onRefund(deps, payload.payload?.refund?.entity as RefundEntity, payload.event === "refund.processed" ? "PROCESSED" : "FAILED");
      case "account.under_review":
      case "account.needs_clarification":
      case "account.activated":
      case "account.rejected":
      case "account.suspended":
        return onAccountStatus(deps, payload.event, (payload.payload?.account?.entity ?? {}) as { id?: string; status?: string });
      case "product.route.under_review":
      case "product.route.needs_clarification":
      case "product.route.activated":
      case "product.route.rejected": {
        const e = (payload.payload?.product?.entity ?? {}) as { account_id?: string; activation_status?: string };
        return onAccountStatus(deps, payload.event, { id: e.account_id, status: e.activation_status });
      }
      case "payment.failed":
        // The hold stays; the guest can retry payment on the same order until it lapses.
        return ok("noted");
      default:
        return ok("ignored");
    }
  };
}

/**
 * Linked-account KYC events keep USER#<id>.razorpayAccountStatus current; listing-svc refuses to publish
 * and booking-svc refuses to sell unless it is "activated". Unknown accounts and unmapped statuses are ignored.
 */
async function onAccountStatus(deps: WebhookDeps, event: string, e: { id?: string; status?: string }): Promise<Result> {
  const { ddb, log } = deps;
  const status = normalizeAccountStatus(e.status ?? event.split(".").pop());
  if (!e.id || !status) return ok("ignored");
  const link = await ddb.doc.send(new GetCommand({ TableName: ddb.table, Key: { PK: `RZPACC#${e.id}`, SK: "META" } }));
  const userId = link.Item?.userId as string | undefined;
  if (!userId) {
    log.warn("status event for unknown account", { accountId: e.id, event });
    return ok("unknown account");
  }
  await ddb.doc.send(
    new UpdateCommand({
      TableName: ddb.table,
      Key: userKey(userId),
      UpdateExpression: "SET razorpayAccountStatus = :s, updatedAt = :at",
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeValues: { ":s": status, ":at": new Date().toISOString() },
    }),
  );
  log.info("host payout status updated", { userId, status });
  return ok("status updated");
}

async function getBooking(ddb: DdbContext, id: string): Promise<BookingRecord | undefined> {
  const r = await ddb.doc.send(new GetCommand({ TableName: ddb.table, Key: bookingKey(id), ConsistentRead: true }));
  return r.Item as BookingRecord | undefined;
}

async function onPaymentCaptured(deps: WebhookDeps, p: PaymentEntity | undefined): Promise<Result> {
  const { ddb, log } = deps;
  if (!p?.id || !p.order_id) return ok("no order");

  const pointer = await ddb.doc.send(new GetCommand({ TableName: ddb.table, Key: orderKey(p.order_id) }));
  const bookingId = pointer.Item?.bookingId as string | undefined;
  if (!bookingId) {
    log.warn("payment for unknown order", { paymentId: p.id, orderId: p.order_id });
    return ok("unknown order");
  }
  const b = await getBooking(ddb, bookingId);
  if (!b) throw new Error(`order ${p.order_id} points at missing booking ${bookingId}`);

  if (b.status === "CONFIRMED" && b.paymentId === p.id) return ok("already confirmed");

  if (p.amount !== b.totalPaise || p.currency !== "INR") {
    log.error("payment amount mismatch", { bookingId, paid: p.amount, expected: b.totalPaise, currency: p.currency });
    return autoRefund(deps, p, b, "AMOUNT_MISMATCH");
  }
  if (b.status !== "PENDING_PAYMENT" && b.status !== "EXPIRED") {
    return autoRefund(deps, p, b, b.status === "CONFIRMED" ? "DUPLICATE_PAYMENT" : `BOOKING_${b.status}`);
  }

  const now = deps.clock?.() ?? Math.floor(Date.now() / 1000);
  try {
    await ddb.doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: ddb.table,
              Key: bookingKey(b.bookingId),
              UpdateExpression: "SET #s = :confirmed, paymentId = :p, confirmedAt = :at, updatedAt = :at REMOVE GSI4PK, GSI4SK, expiredReason",
              ConditionExpression: "#s IN (:pending, :expired) AND orderId = :order",
              ExpressionAttributeNames: { "#s": "status" },
              ExpressionAttributeValues: {
                ":confirmed": "CONFIRMED",
                ":pending": "PENDING_PAYMENT",
                ":expired": "EXPIRED",
                ":p": p.id,
                ":order": p.order_id,
                ":at": new Date(now * 1000).toISOString(),
              },
            },
          },
          // A late payment still wins if nobody else has taken the nights in the meantime.
          ...b.nights.map((date) => ({
            Update: {
              TableName: ddb.table,
              Key: nightKey(b.listingId, date),
              UpdateExpression: "SET #s = :booked, bookingId = :b, #ttl = :ttl REMOVE holdExpiresAt",
              ConditionExpression: "attribute_not_exists(SK) OR bookingId = :b OR #s = :free OR (#s = :held AND holdExpiresAt < :now)",
              ExpressionAttributeNames: { "#s": "status", "#ttl": "ttl" },
              ExpressionAttributeValues: {
                ":booked": "BOOKED",
                ":held": "HELD",
                ":free": "FREE",
                ":b": b.bookingId,
                ":now": now,
                ":ttl": nightTtl(date),
              },
            },
          })),
        ],
      }),
    );
    log.info("booking confirmed", { bookingId: b.bookingId, paymentId: p.id });
    return ok("confirmed");
  } catch (e) {
    if ((e as { name?: string }).name !== "TransactionCanceledException") throw e;
    const reasons = ((e as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? []).map((r) => r.Code);
    if (reasons.some((c) => c === "TransactionConflict")) throw e; // concurrent writer: let Razorpay retry

    const fresh = await getBooking(ddb, b.bookingId);
    if (fresh?.status === "CONFIRMED" && fresh.paymentId === p.id) return ok("already confirmed");
    const reason = reasons[0] === "ConditionalCheckFailed" ? `BOOKING_${fresh?.status ?? "MISSING"}` : "NIGHTS_TAKEN";
    log.warn("payment arrived but booking can't be confirmed; refunding", { bookingId: b.bookingId, paymentId: p.id, reason });
    return autoRefund(deps, p, fresh ?? b, reason);
  }
}

/**
 * Full refund of a payment that can't be honoured. The AUTOREFUND#<paymentId> item guarantees we
 * call Razorpay at most once per payment; it's removed again if the call fails, so a retry can try again.
 */
async function autoRefund(deps: WebhookDeps, p: PaymentEntity, b: BookingRecord, reason: string): Promise<Result> {
  const { ddb, log } = deps;
  try {
    await ddb.doc.send(
      new PutCommand({
        TableName: ddb.table,
        Item: { ...autoRefundKey(p.id), bookingId: b.bookingId, amount: p.amount, reason, status: "IN_PROGRESS", createdAt: new Date().toISOString() },
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
  } catch (e) {
    if (!isConditionalFailure(e)) throw e;
    const existing = (await ddb.doc.send(new GetCommand({ TableName: ddb.table, Key: autoRefundKey(p.id), ConsistentRead: true }))).Item;
    if (existing?.status === "IN_PROGRESS") {
      // A previous attempt may have crashed mid-call; a human must check Razorpay before retrying.
      log.error("auto-refund state unknown; check Razorpay dashboard", { paymentId: p.id, bookingId: b.bookingId });
    }
    return ok("refund already handled");
  }

  let refundId: string;
  try {
    const refund = await deps.razorpay.refund(p.id, {
      amountPaise: p.amount,
      reverseAll: true, // also claws back the host's on-hold transfer created with the order
      receipt: `auto_${b.bookingId}`.slice(0, 40),
      notes: { bookingId: b.bookingId, reason },
    });
    refundId = refund.id;
  } catch (e) {
    // Razorpay rejected or never received the call: drop the guard so the webhook retry can refund.
    await ddb.doc.send(new DeleteCommand({ TableName: ddb.table, Key: autoRefundKey(p.id) }));
    log.error("auto-refund call failed; will retry", { paymentId: p.id, bookingId: b.bookingId, err: (e as Error).message });
    throw e; // 500 -> Razorpay retries the webhook
  }

  await ddb.doc.send(
    new UpdateCommand({
      TableName: ddb.table,
      Key: autoRefundKey(p.id),
      UpdateExpression: "SET #s = :done, refundId = :r",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":done": "INITIATED", ":r": refundId },
    }),
  );

  // A late payment on a still-pending hold: close the booking and release whatever nights it still holds.
  if (b.status === "PENDING_PAYMENT") {
    try {
      await ddb.doc.send(
        new UpdateCommand({
          TableName: ddb.table,
          Key: bookingKey(b.bookingId),
          UpdateExpression: "SET #s = :expired, expiredReason = :r, updatedAt = :now REMOVE GSI4PK, GSI4SK",
          ConditionExpression: "#s = :pending",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: { ":expired": "EXPIRED", ":pending": "PENDING_PAYMENT", ":r": reason, ":now": new Date().toISOString() },
        }),
      );
    } catch (e) {
      if (!isConditionalFailure(e)) throw e;
    }
    await releaseNights(ddb, b.listingId, b.nights, b.bookingId, ["HELD"]);
  }
  log.warn("payment auto-refunded", { paymentId: p.id, bookingId: b.bookingId, refundId, reason });
  return ok("refunded");
}

async function onRefund(deps: WebhookDeps, r: RefundEntity | undefined, status: "PROCESSED" | "FAILED"): Promise<Result> {
  const { ddb, log } = deps;
  if (!r?.id) return ok("no refund");
  if (status === "FAILED") log.error("refund failed at Razorpay", { refundId: r.id, paymentId: r.payment_id });

  const notes = Array.isArray(r.notes) ? {} : (r.notes ?? {});
  const bookingId = (notes as Record<string, string>).bookingId;

  // Cancellation refunds live on the booking; auto-refunds live on AUTOREFUND#<paymentId>.
  const updates: Promise<unknown>[] = [];
  if (bookingId) {
    updates.push(
      ddb.doc.send(
        new UpdateCommand({
          TableName: ddb.table,
          Key: bookingKey(bookingId),
          UpdateExpression: "SET refundStatus = :s, updatedAt = :now",
          ConditionExpression: "refundId = :rid",
          ExpressionAttributeValues: { ":s": status, ":rid": r.id, ":now": new Date().toISOString() },
        }),
      ),
    );
  }
  updates.push(
    ddb.doc.send(
      new UpdateCommand({
        TableName: ddb.table,
        Key: autoRefundKey(r.payment_id),
        UpdateExpression: "SET #s = :s",
        ConditionExpression: "refundId = :rid",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": status, ":rid": r.id },
      }),
    ),
  );
  const results = await Promise.allSettled(updates);
  for (const res of results) {
    if (res.status === "rejected" && !isConditionalFailure(res.reason)) throw res.reason;
  }
  return ok(`refund ${status.toLowerCase()}`);
}
