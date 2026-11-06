import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { istMonth } from "@mp/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addDays,
  bookingKey,
  checkInEpoch,
  checkOutEpoch,
  listingKey,
  nightKey,
  orderKey,
  todayUtc,
  userKey,
  type RazorpayApi,
} from "@mp/shared";
import { bearer, fakeVerifier, startTestDb } from "@mp/test-utils";
import { buildApp } from "../src/app.js";

// ---------- fakes ----------

interface Call {
  op: string;
  args: unknown[];
}
const calls: Call[] = [];
const fail: Partial<Record<keyof RazorpayApi, boolean>> = {};
let orderSeq = 0;

const fakeRazorpay: RazorpayApi = {
  async createOrder(i) {
    calls.push({ op: "createOrder", args: [i] });
    if (fail.createOrder) throw new Error("razorpay down");
    return { id: `order_${++orderSeq}`, amount: i.amountPaise };
  },
  async refund(paymentId, i) {
    calls.push({ op: "refund", args: [paymentId, i] });
    if (fail.refund) throw new Error("refund rejected");
    return { id: `rfnd_${calls.length}`, status: "pending" };
  },
  async paymentTransfers(paymentId) {
    calls.push({ op: "paymentTransfers", args: [paymentId] });
    return [{ id: "trf_1", amount: 0, recipient: "acc_HOST1" }];
  },
  async reverseTransfer(id, amount) {
    calls.push({ op: "reverseTransfer", args: [id, amount] });
    return { id: `rvrsl_${calls.length}` };
  },
};
const ops = () => calls.map((c) => c.op);

// ---------- setup ----------

let db: Awaited<ReturnType<typeof startTestDb>>;
let app: ReturnType<typeof buildApp>["app"];
let clock = Math.floor(Date.now() / 1000);

const LISTING = "11111111-1111-4111-8111-111111111111";
const STRICT_LISTING = "22222222-2222-4222-8222-222222222222";
const BASE = 5_000_00;

const HOST = bearer("host-1", "host");
const GUEST = bearer("guest-1", "guest");
const GUEST2 = bearer("guest-2", "guest");
const STRANGER = bearer("guest-9", "guest");
const ADMIN = bearer("admin-1", "admin");

async function put(item: Record<string, unknown>) {
  await db.doc.send(new PutCommand({ TableName: db.table, Item: item }));
}

const PRICED = "44444444-4444-4444-8444-444444444444";
const REQUEST_ONLY = "55555555-5555-4555-8555-555555555555";

async function seedListing(id: string, policy: string) {
  await put({
    ...listingKey(id),
    id,
    hostId: "host-1",
    title: `Test stay ${policy}`,
    status: "PUBLISHED",
    basePricePaise: BASE,
    maxGuests: 4,
    cancellationPolicy: policy,
    coverPhotoId: "cover-1",
  });
}

beforeAll(async () => {
  db = await startTestDb();
  app = buildApp({
    ddb: db,
    verifier: fakeVerifier,
    razorpay: fakeRazorpay,
    razorpayKeyId: "rzp_test_key",
    cdnBaseUrl: "https://cdn.test",
    platformFeePct: 12,
    holdMinutes: 15,
    clock: () => clock,
    logger: false,
  }).app;
  await app.ready();
  await seedListing(LISTING, "MODERATE");
  await seedListing(STRICT_LISTING, "STRICT");
  await put({ ...userKey("host-1"), userId: "host-1", razorpayAccountId: "acc_HOST1", razorpayAccountStatus: "activated" });
  // A GST-registered host with Airbnb-style fees, discounts and stay rules.
  await put({ ...listingKey(PRICED), id: PRICED, hostId: "host-2", title: "Priced villa", status: "PUBLISHED", basePricePaise: BASE, maxGuests: 6, cancellationPolicy: "FLEXIBLE", cleaningFeePaise: 1_000_00, weeklyDiscountPct: 10, minNights: 2, maxNights: 14, guestsIncluded: 2, extraGuestFeePaise: 500_00 });
  await put({ ...listingKey(REQUEST_ONLY), id: REQUEST_ONLY, hostId: "host-1", title: "Request villa", status: "PUBLISHED", basePricePaise: BASE, maxGuests: 4, cancellationPolicy: "MODERATE", instantBook: false });
  await put({ ...userKey("host-2"), userId: "host-2", razorpayAccountId: "acc_HOST2", razorpayAccountStatus: "activated", gstin: "29ABCDE1234F1Z5" });
}, 30_000);

afterAll(async () => {
  await app?.close();
  await db?.stop();
});

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(fail)) delete fail[k as keyof RazorpayApi];
  clock = Math.floor(Date.now() / 1000);
});

let keySeq = 0;
const newKey = () => `test-key-${++keySeq}-${Date.now()}`;

/** Each test books its own date range so tests don't interfere. */
let rangeSeq = 0;
function nextRange(nights = 3, daysAhead = 20) {
  const checkIn = addDays(todayUtc(), daysAhead + rangeSeq++ * 10);
  return { checkIn, checkOut: addDays(checkIn, nights) };
}

function book(headers: Record<string, string>, body: Record<string, unknown>, key = newKey()) {
  return app.inject({ method: "POST", url: "/v1/bookings", headers: { ...headers, "idempotency-key": key }, payload: body });
}

async function night(listingId: string, date: string) {
  return (await db.doc.send(new GetCommand({ TableName: db.table, Key: nightKey(listingId, date) }))).Item;
}

async function record(bookingId: string) {
  return (await db.doc.send(new GetCommand({ TableName: db.table, Key: bookingKey(bookingId) }))).Item!;
}

/** Stand-in for the payment webhook (tested in lambdas/payment-webhook). */
async function confirm(bookingId: string) {
  const b = await record(bookingId);
  await db.doc.send(
    new UpdateCommand({
      TableName: db.table,
      Key: bookingKey(bookingId),
      UpdateExpression: "SET #s = :c, paymentId = :p REMOVE GSI4PK, GSI4SK",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":c": "CONFIRMED", ":p": `pay_${bookingId.slice(0, 8)}` },
    }),
  );
  for (const d of b.nights as string[]) {
    await db.doc.send(
      new UpdateCommand({
        TableName: db.table,
        Key: nightKey(b.listingId, d),
        UpdateExpression: "SET #s = :booked REMOVE holdExpiresAt",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":booked": "BOOKED" },
      }),
    );
  }
}

async function bookAndConfirm(listingId: string, range: { checkIn: string; checkOut: string }) {
  const r = await book(GUEST, { listingId, ...range, guests: 2 });
  expect(r.statusCode).toBe(201);
  const { bookingId } = r.json();
  await confirm(bookingId);
  calls.length = 0;
  return bookingId as string;
}


async function auditFor(targetId: string) {
  const r = await db.doc.send(new QueryCommand({ TableName: db.table, KeyConditionExpression: "PK = :pk", FilterExpression: "targetId = :t", ExpressionAttributeValues: { ":pk": `AUDIT#${istMonth(new Date())}`, ":t": targetId } }));
  return r.Items ?? [];
}

// ---------- tests ----------

describe("POST /v1/bookings", () => {
  it("holds the nights, prices overrides, and creates an order with an on-hold host transfer", async () => {
    const range = nextRange(3);
    await put({ ...nightKey(LISTING, addDays(range.checkIn, 1)), status: "FREE", pricePaise: 8_000_00 });

    const r = await book(GUEST, { listingId: LISTING, ...range, guests: 2 });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    // 18,000 for 3 nights = 6,000/night -> 5% GST
    const value = BASE + 8_000_00 + BASE;
    const total = value + Math.round(value * 0.05);
    expect(body).toMatchObject({
      status: "PENDING_PAYMENT",
      totalPaise: total,
      holdExpiresAt: clock + 15 * 60,
      payment: { keyId: "rzp_test_key", amountPaise: total },
    });

    const order = calls.find((c) => c.op === "createOrder")!.args[0] as Parameters<RazorpayApi["createOrder"]>[0];
    expect(order.amountPaise).toBe(total);
    expect(order.receipt).toBe(body.bookingId);
    expect(order.transfer).toMatchObject({
      account: "acc_HOST1",
      amountPaise: value - Math.round(value * 0.12), // fee on the stay value; GST kept by the platform (host has no GSTIN)
      onHoldUntil: checkOutEpoch(range.checkOut) + 24 * 3600,
    });

    for (let i = 0; i < 3; i++) {
      expect(await night(LISTING, addDays(range.checkIn, i))).toMatchObject({ status: "HELD", bookingId: body.bookingId });
    }
    // The host's price override survives the hold
    expect((await night(LISTING, addDays(range.checkIn, 1)))!.pricePaise).toBe(8_000_00);

    const pointer = await db.doc.send(new GetCommand({ TableName: db.table, Key: orderKey(body.payment.orderId) }));
    expect(pointer.Item?.bookingId).toBe(body.bookingId);
  });

  it("is idempotent: same key + same body returns the same booking without a second order", async () => {
    const range = nextRange();
    const key = newKey();
    const a = await book(GUEST, { listingId: LISTING, ...range, guests: 2 }, key);
    const b = await book(GUEST, { listingId: LISTING, ...range, guests: 2 }, key);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.json().bookingId).toBe(a.json().bookingId);
    expect(b.json().payment.orderId).toBe(a.json().payment.orderId);
    expect(ops().filter((o) => o === "createOrder")).toHaveLength(1);

    const c = await book(GUEST, { listingId: LISTING, ...range, guests: 3 }, key);
    expect(c.statusCode).toBe(422);
    expect(c.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("lets exactly one of many concurrent guests hold the same dates", async () => {
    const range = nextRange();
    const results = await Promise.all(
      ["g-a", "g-b", "g-c", "g-d", "g-e"].map((g) => book(bearer(g, "guest"), { listingId: LISTING, ...range, guests: 1 })),
    );
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409, 409, 409, 409]);
    for (const r of results.filter((x) => x.statusCode === 409)) {
      expect(r.json().error.code).toBe("DATES_UNAVAILABLE");
    }
  });

  it("frees the dates for others once the hold lapses", async () => {
    const range = nextRange();
    expect((await book(GUEST, { listingId: LISTING, ...range, guests: 2 })).statusCode).toBe(201);
    const blocked = await book(GUEST2, { listingId: LISTING, ...range, guests: 2 });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.details.dates).toHaveLength(3);

    clock += 16 * 60;
    expect((await book(GUEST2, { listingId: LISTING, ...range, guests: 2 })).statusCode).toBe(201);
  });

  it("refuses blocked nights, own listings, too many guests, and unbookable hosts", async () => {
    const range = nextRange();
    await put({ ...nightKey(LISTING, range.checkIn), status: "BLOCKED" });
    expect((await book(GUEST, { listingId: LISTING, ...range, guests: 2 })).json().error.code).toBe("DATES_UNAVAILABLE");

    const r2 = nextRange();
    expect((await book(HOST, { listingId: LISTING, ...r2, guests: 2 })).statusCode).toBe(403);
    expect((await book(GUEST, { listingId: LISTING, ...r2, guests: 9 })).json().error.code).toBe("TOO_MANY_GUESTS");

    const noKey = await app.inject({ method: "POST", url: "/v1/bookings", headers: GUEST, payload: { listingId: LISTING, ...r2, guests: 2 } });
    expect(noKey.statusCode).toBe(400);

    const past = await book(GUEST, { listingId: LISTING, checkIn: "2020-01-01", checkOut: "2020-01-03", guests: 2 });
    expect(past.json().error.code).toBe("INVALID_DATES");

    await put({ ...userKey("host-1"), userId: "host-1", razorpayAccountId: "acc_HOST1", razorpayAccountStatus: "suspended" });
    try {
      expect((await book(GUEST, { listingId: LISTING, ...r2, guests: 2 })).json().error.code).toBe("LISTING_NOT_BOOKABLE");
    } finally {
      await put({ ...userKey("host-1"), userId: "host-1", razorpayAccountId: "acc_HOST1", razorpayAccountStatus: "activated" });
    }
    expect((await book(STRANGER, { listingId: "33333333-3333-4333-8333-333333333333", ...r2, guests: 2 })).statusCode).toBe(404);
  });

  it("releases the hold and the idempotency key when Razorpay is down", async () => {
    const range = nextRange();
    const key = newKey();
    fail.createOrder = true;
    const r = await book(GUEST, { listingId: LISTING, ...range, guests: 2 }, key);
    expect(r.statusCode).toBe(502);
    expect(await night(LISTING, range.checkIn)).toBeUndefined();

    delete fail.createOrder;
    const retry = await book(GUEST, { listingId: LISTING, ...range, guests: 2 }, key);
    expect(retry.statusCode).toBe(201);
  });
});

describe("reading bookings", () => {
  it("shows a booking to its guest, host and admins only, with fees hidden from guests", async () => {
    const range = nextRange();
    const id = await bookAndConfirm(LISTING, range);
    const asGuest = await app.inject({ url: `/v1/bookings/${id}`, headers: GUEST });
    expect(asGuest.statusCode).toBe(200);
    expect(asGuest.json().hostPayoutPaise).toBeUndefined();
    expect(asGuest.json().coverPhotoUrl).toBe(`https://cdn.test/listings/${LISTING}/cover-1/w720.webp`);
    expect(asGuest.json().GSI1PK).toBeUndefined();

    const asHost = await app.inject({ url: `/v1/bookings/${id}`, headers: HOST });
    expect(asHost.json().hostPayoutPaise).toBeGreaterThan(0);
    expect((await app.inject({ url: `/v1/bookings/${id}`, headers: STRANGER })).statusCode).toBe(404);
    expect((await app.inject({ url: `/v1/bookings/${id}`, headers: ADMIN })).statusCode).toBe(200);
  });

  it("gives the guest Checkout details for their own live hold, and nobody else", async () => {
    const r = await book(GUEST, { listingId: LISTING, ...nextRange(), guests: 1 });
    const { bookingId, payment } = r.json();
    const asGuest = (await app.inject({ url: `/v1/bookings/${bookingId}`, headers: GUEST })).json();
    expect(asGuest.status).toBe("PENDING_PAYMENT");
    expect(asGuest.payment).toEqual(payment);
    expect((await app.inject({ url: `/v1/bookings/${bookingId}`, headers: ADMIN })).json().payment).toBeUndefined();
    await confirm(bookingId);
    expect((await app.inject({ url: `/v1/bookings/${bookingId}`, headers: GUEST })).json().payment).toBeUndefined();
  });

  it("lists trips for the guest and confirmed reservations for the host", async () => {
    const pending = (await book(GUEST, { listingId: LISTING, ...nextRange(), guests: 2 })).json().bookingId;
    const confirmed = await bookAndConfirm(LISTING, nextRange());

    const trips = (await app.inject({ url: "/v1/trips?limit=50", headers: GUEST })).json().items.map((b: { bookingId: string }) => b.bookingId);
    expect(trips).toEqual(expect.arrayContaining([pending, confirmed]));

    const res = (await app.inject({ url: "/v1/host/reservations?limit=50", headers: HOST })).json().items.map((b: { bookingId: string }) => b.bookingId);
    expect(res).toContain(confirmed);
    expect(res).not.toContain(pending);
    expect((await app.inject({ url: "/v1/host/reservations", headers: GUEST })).statusCode).toBe(403);
  });
});

describe("cancellation", () => {
  it("cancelling an unpaid hold releases nights without any refund", async () => {
    const range = nextRange();
    const id = (await book(GUEST, { listingId: LISTING, ...range, guests: 2 })).json().bookingId;
    calls.length = 0;
    const r = await app.inject({ method: "POST", url: `/v1/bookings/${id}/cancel`, headers: GUEST });
    expect(r.json().status).toBe("CANCELLED");
    expect(await night(LISTING, range.checkIn)).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("moderate, 5+ days out: full refund in one call with reverse_all, nights freed", async () => {
    const range = nextRange();
    const id = await bookAndConfirm(LISTING, range);
    const b = await record(id);
    const r = await app.inject({ method: "POST", url: `/v1/bookings/${id}/cancel`, headers: GUEST });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: "CANCELLED", refundPaise: b.totalPaise, refundStatus: "INITIATED" });
    expect(ops()).toEqual(["refund"]);
    expect(calls[0]!.args[1]).toMatchObject({ amountPaise: b.totalPaise, reverseAll: true });
    expect(await night(LISTING, range.checkIn)).toBeUndefined();
  });

  it("moderate, under 5 days: 50% refund, reversing only the host's proportional share", async () => {
    const range = nextRange();
    const id = await bookAndConfirm(LISTING, range);
    const b = await record(id);
    clock = checkInEpoch(range.checkIn) - 2 * 86_400;

    const r = await app.inject({ method: "POST", url: `/v1/bookings/${id}/cancel`, headers: GUEST });
    const half = Math.floor(b.totalPaise / 2);
    expect(r.json().refundPaise).toBe(half);
    expect(ops()).toEqual(["paymentTransfers", "reverseTransfer", "refund"]);
    expect(calls[1]!.args).toEqual(["trf_1", Math.round((half * b.hostPayoutPaise) / b.totalPaise)]);
    expect(calls[2]!.args[1]).toMatchObject({ amountPaise: half, reverseAll: false });
  });

  it("strict, under 7 days: no refund and no Razorpay calls", async () => {
    const range = nextRange();
    const id = await bookAndConfirm(STRICT_LISTING, range);
    clock = checkInEpoch(range.checkIn) - 3 * 86_400;
    const r = await app.inject({ method: "POST", url: `/v1/bookings/${id}/cancel`, headers: GUEST });
    expect(r.json()).toMatchObject({ status: "CANCELLED", refundPaise: 0 });
    expect(r.json().refundStatus).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("refuses guest cancellation after check-in, and double cancellation", async () => {
    const range = nextRange();
    const id = await bookAndConfirm(LISTING, range);
    clock = checkInEpoch(range.checkIn) + 60;
    expect((await app.inject({ method: "POST", url: `/v1/bookings/${id}/cancel`, headers: GUEST })).json().error.code).toBe("TOO_LATE_TO_CANCEL");

    clock = Math.floor(Date.now() / 1000);
    expect((await app.inject({ method: "POST", url: `/v1/bookings/${id}/cancel`, headers: GUEST })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/v1/bookings/${id}/cancel`, headers: GUEST })).json().error.code).toBe("NOT_CANCELLABLE");
  });

  it("host cancellation always refunds the guest in full, even on a strict listing", async () => {
    const range = nextRange();
    const id = await bookAndConfirm(STRICT_LISTING, range);
    clock = checkInEpoch(range.checkIn) - 86_400;
    const r = await app.inject({ method: "POST", url: `/v1/bookings/${id}/cancel`, headers: HOST });
    expect(r.json()).toMatchObject({ cancelledBy: "host", refundPaise: (await record(id)).totalPaise });
    expect(calls[0]!.args[1]).toMatchObject({ reverseAll: true });
  });

  it("a failed refund is recorded, and an admin retry does not reverse the host transfer twice", async () => {
    const range = nextRange();
    const id = await bookAndConfirm(LISTING, range);
    clock = checkInEpoch(range.checkIn) - 2 * 86_400; // partial refund path
    fail.refund = true;
    const r = await app.inject({ method: "POST", url: `/v1/bookings/${id}/cancel`, headers: GUEST });
    expect(r.json().refundStatus).toBe("FAILED");
    expect(ops()).toEqual(["paymentTransfers", "reverseTransfer", "refund"]);

    expect((await app.inject({ method: "POST", url: `/v1/admin/bookings/${id}/retry-refund`, headers: GUEST })).statusCode).toBe(403);

    delete fail.refund;
    calls.length = 0;
    const retry = await app.inject({ method: "POST", url: `/v1/admin/bookings/${id}/retry-refund`, headers: ADMIN });
    expect(retry.json().refundStatus).toBe("INITIATED");
    expect(ops()).toEqual(["refund"]);

    const again = await app.inject({ method: "POST", url: `/v1/admin/bookings/${id}/retry-refund`, headers: ADMIN });
    expect(again.json().error.code).toBe("NOTHING_TO_RETRY");
    expect((await auditFor(id)).map((a) => [a.action, a.detail.before, a.detail.after])).toEqual([["booking.retry_refund", "FAILED", "INITIATED"]]);
  });
});

describe("itemised pricing", () => {
  const quoteUrl = (q: Record<string, string | number>) => `/v1/quote?${new URLSearchParams(Object.entries(q).map(([k, v]): [string, string] => [k, String(v)]))}`;

  it("quotes nightly prices, extra guests, weekly discount, cleaning fee and GST", async () => {
    const range = nextRange(7);
    const r = await app.inject({ url: quoteUrl({ listingId: PRICED, ...range, guests: 3 }) });
    expect(r.statusCode).toBe(200);
    // 7 x 5,000 = 35,000; +1 extra guest x 500 x 7 = 3,500; -10% of 35,000 = 3,500; +1,000 cleaning
    // = 36,000 (5,143/night -> 5%) + 1,800 GST = 37,800
    expect(r.json()).toMatchObject({
      available: true,
      nights: 7,
      nightlySubtotalPaise: 35_000_00,
      extraGuests: 1,
      extraGuestPaise: 3_500_00,
      discountKind: "weekly",
      discountPaise: 3_500_00,
      cleaningFeePaise: 1_000_00,
      valuePaise: 36_000_00,
      gstRatePct: 5,
      gstPaise: 1_800_00,
      totalPaise: 37_800_00,
    });
  });

  it("enforces the listing's minimum and maximum nights on quotes and bookings", async () => {
    const one = nextRange(1);
    expect((await app.inject({ url: quoteUrl({ listingId: PRICED, ...one, guests: 2 }) })).json().error.code).toBe("MIN_NIGHTS");
    expect((await book(GUEST, { listingId: PRICED, ...one, guests: 2 })).json().error).toMatchObject({ code: "MIN_NIGHTS", details: { minNights: 2 } });
    expect((await app.inject({ url: quoteUrl({ listingId: PRICED, ...nextRange(15), guests: 2 }) })).json().error.code).toBe("MAX_NIGHTS");
  });

  it("charges the quoted total and passes GST to a GST-registered host", async () => {
    const range = nextRange(7);
    const q = (await app.inject({ url: quoteUrl({ listingId: PRICED, ...range, guests: 3 }) })).json();
    const r = await book(GUEST, { listingId: PRICED, ...range, guests: 3 });
    expect(r.statusCode).toBe(201);
    expect(r.json().totalPaise).toBe(q.totalPaise);
    const order = calls.find((c) => c.op === "createOrder")!.args[0] as Parameters<RazorpayApi["createOrder"]>[0];
    // 36,000 - 12% fee (4,320) + 1,800 GST
    expect(order.transfer).toMatchObject({ account: "acc_HOST2", amountPaise: 33_480_00 });

    const asGuest = (await app.inject({ url: `/v1/bookings/${r.json().bookingId}`, headers: GUEST })).json();
    expect(asGuest.price).toMatchObject({ cleaningFeePaise: 1_000_00, discountPaise: 3_500_00, gstPaise: 1_800_00 });
    expect(asGuest.platformGstPaise).toBeUndefined();
  });

  it("reports nights that are taken without failing the quote", async () => {
    const range = nextRange(3);
    await book(GUEST2, { listingId: LISTING, ...range, guests: 1 });
    const q = (await app.inject({ url: quoteUrl({ listingId: LISTING, ...range, guests: 1 }) })).json();
    expect(q.available).toBe(false);
    expect(q.unavailable).toHaveLength(3);
  });
});

describe("request to book", () => {
  const post = (url: string, headers: Record<string, string>, payload?: object) => app.inject({ method: "POST", url, headers, payload });

  it("holds the dates for 24h without charging, until the host answers", async () => {
    const range = nextRange(2);
    const r = await book(GUEST, { listingId: REQUEST_ONLY, ...range, guests: 2, message: "Hi! Two of us for a quiet weekend." });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: "REQUESTED", payment: null, holdExpiresAt: clock + 24 * 3600 });
    expect(calls.find((c) => c.op === "createOrder")).toBeUndefined();
    expect(await night(REQUEST_ONLY, range.checkIn)).toMatchObject({ status: "HELD", bookingId: r.json().bookingId });
    const g = (await app.inject({ url: `/v1/bookings/${r.json().bookingId}`, headers: GUEST })).json();
    expect(g).toMatchObject({ status: "REQUESTED", requestMessage: "Hi! Two of us for a quiet weekend." });
    expect(g.payment).toBeUndefined();
  });

  it("on accept, creates the order and gives the guest 12h to pay", async () => {
    const range = nextRange(2);
    const { bookingId } = (await book(GUEST, { listingId: REQUEST_ONLY, ...range, guests: 2 })).json();
    expect((await post(`/v1/bookings/${bookingId}/accept`, GUEST)).statusCode).toBe(403);
    const a = await post(`/v1/bookings/${bookingId}/accept`, HOST);
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ status: "PENDING_PAYMENT", holdExpiresAt: clock + 12 * 3600 });
    expect(calls.filter((c) => c.op === "createOrder")).toHaveLength(1);
    expect(await night(REQUEST_ONLY, range.checkIn)).toMatchObject({ holdExpiresAt: clock + 12 * 3600 });
    const g = (await app.inject({ url: `/v1/bookings/${bookingId}`, headers: GUEST })).json();
    expect(g.payment).toMatchObject({ keyId: "rzp_test_key", amountPaise: g.totalPaise });
    expect((await post(`/v1/bookings/${bookingId}/accept`, HOST)).json().error.code).toBe("NOT_A_REQUEST");
  });

  it("on decline, frees the dates; only the listing's host can answer", async () => {
    const range = nextRange(2);
    const { bookingId } = (await book(GUEST, { listingId: REQUEST_ONLY, ...range, guests: 2 })).json();
    expect((await post(`/v1/bookings/${bookingId}/decline`, bearer("host-2", "host"))).statusCode).toBe(404);
    const d = await post(`/v1/bookings/${bookingId}/decline`, HOST, { reason: "Dates blocked for repairs" });
    expect(d.json()).toMatchObject({ status: "DECLINED", declineReason: "Dates blocked for repairs" });
    expect(await night(REQUEST_ONLY, range.checkIn)).toBeUndefined();
    expect((await book(GUEST2, { listingId: REQUEST_ONLY, ...range, guests: 1 })).statusCode).toBe(201);
  });

  it("lets the guest withdraw a request, and refuses late answers", async () => {
    const range = nextRange(2);
    const { bookingId } = (await book(GUEST, { listingId: REQUEST_ONLY, ...range, guests: 2 })).json();
    expect((await post(`/v1/bookings/${bookingId}/cancel`, HOST)).json().error.code).toBe("NOT_CONFIRMED");
    const w = await post(`/v1/bookings/${bookingId}/cancel`, GUEST);
    expect(w.json()).toMatchObject({ status: "CANCELLED" });
    expect(w.json().refundPaise).toBeUndefined();

    const r2 = nextRange(2);
    const late = (await book(GUEST, { listingId: REQUEST_ONLY, ...r2, guests: 2 })).json();
    clock += 25 * 3600;
    expect((await post(`/v1/bookings/${late.bookingId}/accept`, HOST)).json().error.code).toBe("REQUEST_EXPIRED");
  });
});

