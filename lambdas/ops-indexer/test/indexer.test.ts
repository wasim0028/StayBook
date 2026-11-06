import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb } from "@mp/test-utils";
import { handleBatch, istDay, processRecord, type Deps, type StreamRecord } from "../src/indexer.js";

let db: Awaited<ReturnType<typeof startTestDb>>;
const deps = (): Deps => ({ ddb: db, log: { info() {}, error() {} }, clock: () => 1_793_000_000 });
let seq = 1;

function rec(eventName: "INSERT" | "MODIFY" | "REMOVE", oldImg?: object, newImg?: object, id = String(seq++)): StreamRecord {
  const m = (o?: object) => (o ? marshall(o, { removeUndefinedValues: true }) : undefined);
  return { eventID: `ev-${id}`, eventName, dynamodb: { SequenceNumber: id, ApproximateCreationDateTime: 1_793_000_000, OldImage: m(oldImg), NewImage: m(newImg) } };
}

async function queue(name: string) {
  const r = await db.doc.send(new QueryCommand({ TableName: db.table, IndexName: "GSI5", KeyConditionExpression: "GSI5PK = :q", ExpressionAttributeValues: { ":q": `QUEUE#${name}` } }));
  return r.Items ?? [];
}
async function day(d: string) {
  return (await db.doc.send(new GetCommand({ TableName: db.table, Key: { PK: "METRIC#DAY", SK: d } }))).Item ?? {};
}

const booking = (id: string, status: string, extra: object = {}) => ({
  PK: `BOOKING#${id}`, SK: "META", bookingId: id, listingId: "L1", listingTitle: "Villa", guestId: "g1", hostId: "h1",
  totalPaise: 1_000_000, platformFeePaise: 120_000, nights: ["2026-12-01", "2026-12-02"], status,
  createdAt: "2026-11-30T06:00:00.000Z", updatedAt: "2026-11-30T06:00:00.000Z", ...extra,
});

beforeAll(async () => {
  db = await startTestDb();
}, 30_000);
afterAll(async () => db?.stop());

describe("work queues", () => {
  it("puts a failed refund in the refunds queue and takes it out once processed", async () => {
    const pending = booking("b1", "CANCELLED", { cancelledAt: "2026-11-30T07:00:00.000Z", refundPaise: 500_000, refundStatus: "FAILED", refundError: "insufficient balance" });
    await processRecord(deps(), rec("MODIFY", booking("b1", "CONFIRMED"), pending));
    const q = await queue("refunds");
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ bookingId: "b1", refundStatus: "FAILED", refundError: "insufficient balance", refundPaise: 500_000 });

    await processRecord(deps(), rec("MODIFY", pending, { ...pending, refundStatus: "PROCESSED" }));
    expect(await queue("refunds")).toHaveLength(0);
  });

  it("moves a listing between status queues and drops it when deleted", async () => {
    const l = { PK: "LISTING#L9", SK: "META", id: "L9", hostId: "h1", title: "Cabin", city: "Manali", status: "DRAFT", photos: ["p1", "p2"], basePricePaise: 300_000, updatedAt: "2026-11-01T00:00:00.000Z" };
    await processRecord(deps(), rec("INSERT", undefined, l));
    expect((await queue("listings-draft")).map((i) => i.listingId)).toEqual(["L9"]);
    const pub = { ...l, status: "PUBLISHED", updatedAt: "2026-11-02T00:00:00.000Z" };
    await processRecord(deps(), rec("MODIFY", l, pub));
    expect(await queue("listings-draft")).toHaveLength(0);
    const [entry] = await queue("listings-published");
    expect(entry).toMatchObject({ listingId: "L9", photoCount: 2, coverPhotoId: "p1", title: "Cabin" });
    await processRecord(deps(), rec("MODIFY", pub, { ...pub, status: "SUSPENDED" }));
    expect(await queue("listings-published")).toHaveLength(0);
    expect(await queue("listings-suspended")).toHaveLength(1);
    await processRecord(deps(), rec("REMOVE", { ...pub, status: "SUSPENDED" }, undefined));
    expect(await queue("listings-suspended")).toHaveLength(0);
  });

  it("lists hosts that are stuck in onboarding or need attention, not healthy ones", async () => {
    const u = { PK: "USER#h7", SK: "PROFILE", userId: "h7", displayName: "Asha", updatedAt: "2026-11-03T00:00:00.000Z" };
    await processRecord(deps(), rec("INSERT", undefined, u));
    expect(await queue("hosts")).toHaveLength(0); // a guest, not a host

    const partial = { ...u, onboardingStep: "stakeholder", razorpayAccountStatus: "created" };
    await processRecord(deps(), rec("MODIFY", u, partial));
    expect((await queue("hosts"))[0]).toMatchObject({ userId: "h7", reason: "onboarding_incomplete" });

    const review = { ...partial, onboardingStep: "done", razorpayAccountStatus: "under_review" };
    await processRecord(deps(), rec("MODIFY", partial, review));
    expect(await queue("hosts")).toHaveLength(0);

    const clar = { ...review, razorpayAccountStatus: "needs_clarification" };
    await processRecord(deps(), rec("MODIFY", review, clar));
    expect((await queue("hosts"))[0]).toMatchObject({ reason: "needs_clarification" });

    await processRecord(deps(), rec("MODIFY", clar, { ...clar, razorpayAccountStatus: "activated" }));
    expect(await queue("hosts")).toHaveLength(0);
  });

  it("ignores items it doesn't index, including its own", async () => {
    for (const img of [{ PK: "LISTING#L1", SK: "NIGHT#2026-12-01", status: "BOOKED" }, { PK: "OPSQ#LISTING#L1", SK: "listings", status: "PUBLISHED" }, { PK: "METRIC#DAY", SK: "2026-12-01", bookings: 3 }]) {
      expect(await processRecord(deps(), rec("MODIFY", img, img))).toEqual({ mirrored: false, counted: false });
    }
  });
});

describe("daily metrics", () => {
  it("counts checkout, payment and cancellation on the IST day they happened", async () => {
    const created = booking("m1", "PENDING_PAYMENT", { createdAt: "2026-12-04T19:00:00.000Z" }); // 00:30 IST on the 5th
    await processRecord(deps(), rec("INSERT", undefined, created));
    const paid = { ...created, status: "CONFIRMED", confirmedAt: "2026-12-04T19:05:00.000Z" };
    await processRecord(deps(), rec("MODIFY", created, paid));
    expect(await day("2026-12-04")).toEqual({});
    expect(await day("2026-12-05")).toMatchObject({ checkouts: 1, bookings: 1, gmvPaise: 1_000_000, feePaise: 120_000, nights: 2 });

    const cancelled = { ...paid, status: "CANCELLED", cancelledAt: "2026-12-06T10:00:00.000Z", refundPaise: 500_000 };
    await processRecord(deps(), rec("MODIFY", paid, cancelled));
    expect(await day("2026-12-06")).toMatchObject({ cancellations: 1, refundPaise: 500_000 });
  });

  it("counts a redelivered stream record once", async () => {
    const created = booking("m2", "PENDING_PAYMENT", { createdAt: "2026-12-10T06:00:00.000Z" });
    const paid = { ...created, status: "CONFIRMED", confirmedAt: "2026-12-10T06:01:00.000Z" };
    const r = rec("MODIFY", created, paid);
    expect((await processRecord(deps(), r)).counted).toBe(true);
    expect((await processRecord(deps(), r)).counted).toBe(false);
    expect((await handleBatch(deps(), [r, r])).batchItemFailures).toEqual([]);
    expect(await day("2026-12-10")).toMatchObject({ bookings: 1, gmvPaise: 1_000_000 });
  });

  it("does not count edits that aren't transitions", async () => {
    const paid = booking("m3", "CONFIRMED", { confirmedAt: "2026-12-11T06:00:00.000Z" });
    await processRecord(deps(), rec("MODIFY", paid, { ...paid, updatedAt: "2026-12-11T07:00:00.000Z" }));
    expect(await day("2026-12-11")).toEqual({});
  });

  it("counts signups, host onboarding, activation and first publish", async () => {
    const u = { PK: "USER#u5", SK: "PROFILE", userId: "u5", createdAt: "2026-12-12T05:00:00.000Z", updatedAt: "2026-12-12T05:00:00.000Z" };
    await processRecord(deps(), rec("INSERT", undefined, u));
    const done = { ...u, onboardingStep: "done", razorpayAccountStatus: "under_review" };
    await processRecord(deps(), rec("MODIFY", u, done));
    await processRecord(deps(), rec("MODIFY", done, { ...done, razorpayAccountStatus: "activated" }));
    const l = { PK: "LISTING#L5", SK: "META", status: "DRAFT", updatedAt: "2026-12-12T06:00:00.000Z" };
    await processRecord(deps(), rec("MODIFY", l, { ...l, status: "PUBLISHED" }));
    expect(await day("2026-12-12")).toMatchObject({ signups: 1, hostsOnboarded: 1, hostsActivated: 1, listingsPublished: 1 });
  });
});

describe("batches", () => {
  it("reports the failing record and everything after it", async () => {
    const broken: Deps = { ...deps(), ddb: { ...db, table: "missing-table" } };
    const a = rec("INSERT", undefined, booking("x1", "PENDING_PAYMENT"));
    const b = rec("INSERT", undefined, booking("x2", "PENDING_PAYMENT"));
    const r = await handleBatch(broken, [a, b]);
    expect(r.batchItemFailures.map((f) => f.itemIdentifier)).toEqual([a.dynamodb!.SequenceNumber, b.dynamodb!.SequenceNumber]);
  });

  it("uses India time for days", () => {
    expect(istDay("2026-12-31T18:29:59.000Z")).toBe("2026-12-31");
    expect(istDay("2026-12-31T18:30:00.000Z")).toBe("2027-01-01");
  });
});
