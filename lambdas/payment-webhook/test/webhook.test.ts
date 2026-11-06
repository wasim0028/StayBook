import { createHmac } from "node:crypto";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addDays, autoRefundKey, bookingKey, listingKey, nightKey, todayUtc, userKey, type RazorpayApi } from "@mp/shared";
import { bearer, fakeVerifier, startTestDb } from "@mp/test-utils";
// End-to-end: real holds are created through booking-svc, then confirmed through this webhook.
import { buildApp } from "../../../services/booking-svc/src/app.js";
import { createWebhookHandler, type FunctionUrlEvent, type Logger } from "../src/webhook.js";

const SECRET = "whsec_test";
const LISTING = "44444444-4444-4444-8444-444444444444";
const GUEST = bearer("guest-1", "guest");
const GUEST2 = bearer("guest-2", "guest");

const calls: { op: string; args: unknown[] }[] = [];
const fail: { refund?: boolean } = {};
let seq = 0;
const razorpay: RazorpayApi = {
  async createOrder(i) {
    calls.push({ op: "createOrder", args: [i] });
    return { id: `order_${++seq}`, amount: i.amountPaise };
  },
  async refund(paymentId, i) {
    calls.push({ op: "refund", args: [paymentId, i] });
    if (fail.refund) throw new Error("razorpay 500");
    return { id: `rfnd_${++seq}`, status: "pending" };
  },
  async paymentTransfers() {
    return [{ id: "trf_1", amount: 0, recipient: "acc_H" }];
  },
  async reverseTransfer(id) {
    calls.push({ op: "reverseTransfer", args: [id] });
    return { id: `rvrsl_${++seq}` };
  },
};
const refunds = () => calls.filter((c) => c.op === "refund");

const logs: { level: string; msg: string }[] = [];
const log: Logger = {
  info: (msg) => logs.push({ level: "info", msg }),
  warn: (msg) => logs.push({ level: "warn", msg }),
  error: (msg) => logs.push({ level: "error", msg }),
};

let db: Awaited<ReturnType<typeof startTestDb>>;
let api: ReturnType<typeof buildApp>["app"];
let clock = Math.floor(Date.now() / 1000);
let webhook: ReturnType<typeof createWebhookHandler>;

beforeAll(async () => {
  db = await startTestDb();
  api = buildApp({
    ddb: db,
    verifier: fakeVerifier,
    razorpay,
    razorpayKeyId: "rzp_test",
    cdnBaseUrl: "https://cdn.test",
    platformFeePct: 12,
    holdMinutes: 15,
    clock: () => clock,
    logger: false,
  }).app;
  await api.ready();
  webhook = createWebhookHandler(async () => ({ ddb: db, razorpay, webhookSecret: SECRET, log, clock: () => clock }));

  await db.doc.send(
    new PutCommand({
      TableName: db.table,
      Item: { ...listingKey(LISTING), id: LISTING, hostId: "host-1", title: "Webhook stay", status: "PUBLISHED", basePricePaise: 4_000_00, maxGuests: 4, cancellationPolicy: "FLEXIBLE" },
    }),
  );
  await db.doc.send(
    new PutCommand({ TableName: db.table, Item: { ...userKey("host-1"), razorpayAccountId: "acc_H", razorpayAccountStatus: "activated" } }),
  );
}, 30_000);

afterAll(async () => {
  await api?.close();
  await db?.stop();
});

beforeEach(() => {
  calls.length = 0;
  logs.length = 0;
  delete fail.refund;
  clock = Math.floor(Date.now() / 1000);
});

// ---------- helpers ----------

let rangeSeq = 0;
function nextRange() {
  const checkIn = addDays(todayUtc(), 30 + rangeSeq++ * 7);
  return { checkIn, checkOut: addDays(checkIn, 2) };
}

async function hold(headers = GUEST, range = nextRange()) {
  const r = await api.inject({
    method: "POST",
    url: "/v1/bookings",
    headers: { ...headers, "idempotency-key": `k-${Math.random().toString(36).slice(2)}` },
    payload: { listingId: LISTING, ...range, guests: 2 },
  });
  expect(r.statusCode).toBe(201);
  return { ...(r.json() as { bookingId: string; totalPaise: number; payment: { orderId: string } }), range };
}

function signed(body: object, opts: { secret?: string; base64?: boolean; eventId?: string } = {}): FunctionUrlEvent {
  const raw = JSON.stringify(body);
  const sig = createHmac("sha256", opts.secret ?? SECRET).update(raw).digest("hex");
  return {
    body: opts.base64 ? Buffer.from(raw).toString("base64") : raw,
    isBase64Encoded: !!opts.base64,
    // Function URLs lowercase header names; mixed case here proves the handler normalises them.
    headers: { "X-Razorpay-Signature": sig, "x-razorpay-event-id": opts.eventId ?? `evt_${Math.random()}` },
  };
}

const captured = (paymentId: string, orderId: string, amount: number) => ({
  event: "payment.captured",
  payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, currency: "INR", status: "captured" } } },
});

async function booking(id: string) {
  return (await db.doc.send(new GetCommand({ TableName: db.table, Key: bookingKey(id), ConsistentRead: true }))).Item!;
}
async function night(date: string) {
  return (await db.doc.send(new GetCommand({ TableName: db.table, Key: nightKey(LISTING, date) }))).Item;
}

// ---------- tests ----------

describe("security and parsing", () => {
  it("rejects a bad signature without touching anything", async () => {
    const h = await hold();
    const r = await webhook(signed(captured("pay_x", h.payment.orderId, h.totalPaise), { secret: "wrong" }));
    expect(r.statusCode).toBe(401);
    expect((await booking(h.bookingId)).status).toBe("PENDING_PAYMENT");
  });

  it("rejects a missing signature, ignores unrelated events, and 400s on invalid JSON", async () => {
    expect((await webhook({ body: "{}", headers: {} })).statusCode).toBe(401);
    expect((await webhook(signed({ event: "order.paid", payload: {} }))).body).toBe("ignored");
    const raw = "not json";
    const sig = createHmac("sha256", SECRET).update(raw).digest("hex");
    expect((await webhook({ body: raw, headers: { "x-razorpay-signature": sig } })).statusCode).toBe(400);
  });

  it("acknowledges payments for orders it doesn't know", async () => {
    const r = await webhook(signed(captured("pay_unknown", "order_not_ours", 100)));
    expect(r).toEqual({ statusCode: 200, body: "unknown order" });
  });
});

describe("payment.captured", () => {
  it("confirms the booking end to end, and booking-svc then reports it confirmed", async () => {
    const h = await hold();
    const r = await webhook(signed(captured("pay_ok", h.payment.orderId, h.totalPaise), { base64: true }));
    expect(r).toEqual({ statusCode: 200, body: "confirmed" });

    const b = await booking(h.bookingId);
    expect(b).toMatchObject({ status: "CONFIRMED", paymentId: "pay_ok" });
    expect(b.GSI4PK).toBeUndefined(); // out of the hold index
    expect(await night(h.range.checkIn)).toMatchObject({ status: "BOOKED", bookingId: h.bookingId });
    expect((await night(h.range.checkIn))!.holdExpiresAt).toBeUndefined();

    const viaApi = await api.inject({ url: `/v1/bookings/${h.bookingId}`, headers: GUEST });
    expect(viaApi.json().status).toBe("CONFIRMED");
  });

  it("is idempotent across duplicate deliveries", async () => {
    const h = await hold();
    const ev = captured("pay_dup", h.payment.orderId, h.totalPaise);
    await webhook(signed(ev));
    expect((await webhook(signed(ev))).body).toBe("already confirmed");
    expect(refunds()).toHaveLength(0);
  });

  it("still confirms a late payment when nobody took the nights", async () => {
    const h = await hold();
    clock += 30 * 60; // hold long gone, booking not yet expired by the job
    const r = await webhook(signed(captured("pay_late_ok", h.payment.orderId, h.totalPaise)));
    expect(r.body).toBe("confirmed");
    expect((await booking(h.bookingId)).status).toBe("CONFIRMED");
  });

  it("also re-confirms an EXPIRED booking whose nights were released", async () => {
    const h = await hold();
    await db.doc.send(
      new UpdateCommand({
        TableName: db.table,
        Key: bookingKey(h.bookingId),
        UpdateExpression: "SET #s = :e REMOVE GSI4PK, GSI4SK",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":e": "EXPIRED" },
      }),
    );
    for (const d of [h.range.checkIn, addDays(h.range.checkIn, 1)]) {
      await db.doc.send(new PutCommand({ TableName: db.table, Item: { ...nightKey(LISTING, d), status: "FREE" } }));
    }
    expect((await webhook(signed(captured("pay_revive", h.payment.orderId, h.totalPaise)))).body).toBe("confirmed");
    expect(await night(h.range.checkIn)).toMatchObject({ status: "BOOKED", bookingId: h.bookingId });
  });

  it("refunds a late payment in full when another guest has the nights, exactly once", async () => {
    const range = nextRange();
    const first = await hold(GUEST, range);
    clock += 20 * 60;
    const second = await hold(GUEST2, range); // takes over the lapsed hold
    calls.length = 0;

    const ev = captured("pay_too_late", first.payment.orderId, first.totalPaise);
    expect((await webhook(signed(ev))).body).toBe("refunded");
    expect(refunds()).toHaveLength(1);
    expect(refunds()[0]!.args).toEqual(["pay_too_late", expect.objectContaining({ amountPaise: first.totalPaise, reverseAll: true })]);

    expect((await booking(first.bookingId))).toMatchObject({ status: "EXPIRED", expiredReason: "NIGHTS_TAKEN" });
    expect(await night(range.checkIn)).toMatchObject({ status: "HELD", bookingId: second.bookingId }); // untouched

    expect((await webhook(signed(ev))).body).toBe("refund already handled");
    expect(refunds()).toHaveLength(1);
  });

  it("returns 500 when the refund call fails, so Razorpay retries, then refunds on the retry", async () => {
    const h = await hold();
    await api.inject({ method: "POST", url: `/v1/bookings/${h.bookingId}/cancel`, headers: GUEST });
    const ev = captured("pay_after_cancel", h.payment.orderId, h.totalPaise);

    fail.refund = true;
    await expect(webhook(signed(ev))).rejects.toThrow("razorpay 500");
    const guard = await db.doc.send(new GetCommand({ TableName: db.table, Key: autoRefundKey("pay_after_cancel") }));
    expect(guard.Item).toBeUndefined();

    delete fail.refund;
    expect((await webhook(signed(ev))).body).toBe("refunded");
    expect(refunds()).toHaveLength(2); // one failed attempt + one success
    expect((await booking(h.bookingId)).status).toBe("CANCELLED");
  });

  it("refunds a payment whose amount doesn't match the booking", async () => {
    const h = await hold();
    expect((await webhook(signed(captured("pay_wrong_amt", h.payment.orderId, h.totalPaise - 1)))).body).toBe("refunded");
    expect(logs.some((l) => l.level === "error" && l.msg === "payment amount mismatch")).toBe(true);
    expect((await booking(h.bookingId)).status).toBe("EXPIRED");
    expect(await night(h.range.checkIn)).toBeUndefined(); // hold released
  });

  it("refunds a second, different payment on an already-confirmed booking", async () => {
    const h = await hold();
    await webhook(signed(captured("pay_one", h.payment.orderId, h.totalPaise)));
    expect((await webhook(signed(captured("pay_two", h.payment.orderId, h.totalPaise)))).body).toBe("refunded");
    expect(refunds()[0]!.args[0]).toBe("pay_two");
    expect((await booking(h.bookingId))).toMatchObject({ status: "CONFIRMED", paymentId: "pay_one" });
  });
});

describe("host payout status events", () => {
  const status = async () =>
    ((await db.doc.send(new GetCommand({ TableName: db.table, Key: userKey("host-kyc") }))).Item ?? {}).razorpayAccountStatus;

  beforeAll(async () => {
    await db.doc.send(new PutCommand({ TableName: db.table, Item: { ...userKey("host-kyc"), userId: "host-kyc", razorpayAccountId: "acc_KYC", razorpayAccountStatus: "under_review" } }));
    await db.doc.send(new PutCommand({ TableName: db.table, Item: { PK: "RZPACC#acc_KYC", SK: "META", userId: "host-kyc" } }));
  });

  it("updates the host's status from account events", async () => {
    const r = await webhook(signed({ event: "account.activated", payload: { account: { entity: { id: "acc_KYC", status: "activated" } } } }));
    expect(r.body).toBe("status updated");
    expect(await status()).toBe("activated");

    await webhook(signed({ event: "account.suspended", payload: { account: { entity: { id: "acc_KYC", status: "suspended" } } } }));
    expect(await status()).toBe("suspended");
  });

  it("understands product.route events (account_id + activation_status)", async () => {
    await webhook(signed({ event: "product.route.needs_clarification", payload: { product: { entity: { account_id: "acc_KYC", activation_status: "needs_clarification" } } } }));
    expect(await status()).toBe("needs_clarification");
  });

  it("ignores unknown accounts and unmapped statuses without failing", async () => {
    const unknown = await webhook(signed({ event: "account.activated", payload: { account: { entity: { id: "acc_NOPE", status: "activated" } } } }));
    expect(unknown).toMatchObject({ statusCode: 200, body: "unknown account" });
    const odd = await webhook(signed({ event: "account.under_review", payload: { account: { entity: { id: "acc_KYC", status: "something_new" } } } }));
    expect(odd.body).toBe("ignored");
    expect(await status()).toBe("needs_clarification");
  });
});

describe("refund events", () => {
  it("marks a cancellation refund PROCESSED, matching on the refund id", async () => {
    const h = await hold();
    await webhook(signed(captured("pay_for_refund", h.payment.orderId, h.totalPaise)));
    const cancel = await api.inject({ method: "POST", url: `/v1/bookings/${h.bookingId}/cancel`, headers: GUEST });
    const refundId = cancel.json().refundId as string;
    expect(cancel.json().refundStatus).toBe("INITIATED");

    const other = { event: "refund.processed", payload: { refund: { entity: { id: "rfnd_other", payment_id: "pay_for_refund", amount: 1, status: "processed", notes: { bookingId: h.bookingId } } } } };
    await webhook(signed(other));
    expect((await booking(h.bookingId)).refundStatus).toBe("INITIATED");

    const mine = { event: "refund.processed", payload: { refund: { entity: { id: refundId, payment_id: "pay_for_refund", amount: h.totalPaise, status: "processed", notes: { bookingId: h.bookingId } } } } };
    expect((await webhook(signed(mine))).body).toBe("refund processed");
    expect((await booking(h.bookingId)).refundStatus).toBe("PROCESSED");
  });

  it("tracks auto-refunds and logs failed refunds loudly", async () => {
    const range = nextRange();
    const first = await hold(GUEST, range);
    clock += 20 * 60;
    await hold(GUEST2, range);
    await webhook(signed(captured("pay_auto", first.payment.orderId, first.totalPaise)));
    const guard = (await db.doc.send(new GetCommand({ TableName: db.table, Key: autoRefundKey("pay_auto") }))).Item!;

    const failed = { event: "refund.failed", payload: { refund: { entity: { id: guard.refundId, payment_id: "pay_auto", amount: 1, status: "failed", notes: [] } } } };
    expect((await webhook(signed(failed))).body).toBe("refund failed");
    expect((await db.doc.send(new GetCommand({ TableName: db.table, Key: autoRefundKey("pay_auto") }))).Item!.status).toBe("FAILED");
    expect(logs.some((l) => l.level === "error" && l.msg === "refund failed at Razorpay")).toBe(true);
  });
});
