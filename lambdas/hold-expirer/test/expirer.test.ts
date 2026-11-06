import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookingKey, holdGsiKeys, nightKey, type BookingRecord } from "@mp/shared";
import { startTestDb } from "@mp/test-utils";
import { expireHolds } from "../src/expirer.js";

let db: Awaited<ReturnType<typeof startTestDb>>;
const NOW = 1_900_000_000;
const LISTING = "listing-x";

beforeAll(async () => {
  db = await startTestDb();
}, 30_000);
afterAll(async () => db?.stop());

const put = (item: Record<string, unknown>) => db.doc.send(new PutCommand({ TableName: db.table, Item: item }));
const get = async (key: { PK: string; SK: string }) => (await db.doc.send(new GetCommand({ TableName: db.table, Key: key }))).Item;

async function seedBooking(id: string, status: BookingRecord["status"], holdExpiresAt: number, nights: string[]) {
  await put({
    ...bookingKey(id),
    ...(status === "PENDING_PAYMENT" || status === "REQUESTED" ? holdGsiKeys(id, holdExpiresAt) : {}),
    bookingId: id,
    listingId: LISTING,
    status,
    holdExpiresAt,
    nights,
  });
  for (const d of nights) {
    await put({ ...nightKey(LISTING, d), status: status === "CONFIRMED" ? "BOOKED" : "HELD", bookingId: id, holdExpiresAt });
  }
}

const run = () => expireHolds({ ddb: db, clock: () => NOW, graceSeconds: 300, maxPerRun: 100, log: () => {} });

describe("expireHolds", () => {
  it("expires lapsed holds past the grace period and releases their nights", async () => {
    await seedBooking("old-1", "PENDING_PAYMENT", NOW - 600, ["2030-01-01", "2030-01-02"]);
    await seedBooking("old-2", "PENDING_PAYMENT", NOW - 3600, ["2030-02-01"]);
    await seedBooking("in-grace", "PENDING_PAYMENT", NOW - 60, ["2030-03-01"]);
    await seedBooking("live", "PENDING_PAYMENT", NOW + 600, ["2030-04-01"]);
    await seedBooking("paid", "CONFIRMED", NOW - 3600, ["2030-05-01"]);

    // Someone else re-held one of old-1's nights after it lapsed; it must survive.
    await put({ ...nightKey(LISTING, "2030-01-02"), status: "HELD", bookingId: "newer", holdExpiresAt: NOW + 900 });
    // A host price override on a held night is reset to FREE, not deleted.
    await put({ ...nightKey(LISTING, "2030-02-01"), status: "HELD", bookingId: "old-2", holdExpiresAt: NOW - 3600, pricePaise: 9_000_00 });

    const r = await run();
    expect(r).toEqual({ expired: 2, nightsReleased: 2, nightsSkipped: 1 });

    expect(await get(bookingKey("old-1"))).toMatchObject({ status: "EXPIRED", expiredReason: "HOLD_LAPSED" });
    expect((await get(bookingKey("old-1")))!.GSI4PK).toBeUndefined();
    expect(await get(nightKey(LISTING, "2030-01-01"))).toBeUndefined();
    expect(await get(nightKey(LISTING, "2030-01-02"))).toMatchObject({ bookingId: "newer" });
    expect(await get(nightKey(LISTING, "2030-02-01"))).toEqual(
      expect.objectContaining({ status: "FREE", pricePaise: 9_000_00 }),
    );
    expect((await get(nightKey(LISTING, "2030-02-01")))!.bookingId).toBeUndefined();

    expect((await get(bookingKey("in-grace")))!.status).toBe("PENDING_PAYMENT");
    expect((await get(bookingKey("live")))!.status).toBe("PENDING_PAYMENT");
    expect((await get(bookingKey("paid")))!.status).toBe("CONFIRMED");
    expect(await get(nightKey(LISTING, "2030-05-01"))).toMatchObject({ status: "BOOKED" });
  });

  it("is idempotent", async () => {
    expect(await run()).toEqual({ expired: 0, nightsReleased: 0, nightsSkipped: 0 });
  });

  it("closes booking requests the host never answered, freeing the dates", async () => {
    await seedBooking("req-old", "REQUESTED", NOW - 600, ["2031-01-01", "2031-01-02"]);
    await seedBooking("req-live", "REQUESTED", NOW + 3600, ["2031-02-01"]);
    expect((await run()).expired).toBe(1);
    expect(await get(bookingKey("req-old"))).toMatchObject({ status: "DECLINED", expiredReason: "REQUEST_NOT_ANSWERED" });
    expect(await get(nightKey(LISTING, "2031-01-01"))).toBeUndefined();
    expect((await get(bookingKey("req-live")))!.status).toBe("REQUESTED");
  });

  it("respects maxPerRun across shards", async () => {
    for (let i = 0; i < 12; i++) await seedBooking(`bulk-${i}`, "PENDING_PAYMENT", NOW - 1000, [`2031-01-${String(i + 1).padStart(2, "0")}`]);
    const first = await expireHolds({ ddb: db, clock: () => NOW, graceSeconds: 300, maxPerRun: 5, log: () => {} });
    expect(first.expired).toBe(5);
    const rest = await run();
    expect(rest.expired).toBe(7);
  });
});
