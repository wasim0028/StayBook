import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, hostBookingGsiKeys, hostGsiKeys, hostStatsKey, listingKey, opsGsiKeys, userKey } from "@mp/shared";
import { startTestDb } from "@mp/test-utils";
import { evaluateAll, qualifies, type HostStats } from "../src/evaluator.js";

let db: Awaited<ReturnType<typeof startTestDb>>;
const NOW = new Date("2026-11-15T06:00:00Z");
const TODAY = "2026-11-15";
const put = (Item: object) => db.doc.send(new PutCommand({ TableName: db.table, Item }));
const get = async (Key: { PK: string; SK: string }) => (await db.doc.send(new GetCommand({ TableName: db.table, Key }))).Item;

async function host(id: string, o: { stays: number; nightsEach?: number; rating: number; reviews: number; hostCancels?: number; responses?: [number, number] }) {
  await put({ ...userKey(id), userId: id });
  const lid = `${id}-L`;
  await put({ ...listingKey(lid), ...hostGsiKeys(id, lid), id: lid, hostId: id, status: "PUBLISHED", ratingAvg: o.rating, ratingCount: o.reviews });
  await put({ PK: `OPSQ#LISTING#${lid}`, SK: "listings", ...opsGsiKeys("listings-published", "2026-01-01T00:00:00Z", lid), hostId: id, listingId: lid });
  for (let i = 0; i < o.stays + (o.hostCancels ?? 0); i++) {
    const checkIn = addDays(TODAY, -300 + i * 5);
    const n = o.nightsEach ?? 2;
    const cancelled = i >= o.stays;
    await put({ PK: `BOOKING#${id}-b${i}`, SK: "META", ...hostBookingGsiKeys(id, checkIn, `${id}-b${i}`), bookingId: `${id}-b${i}`, hostId: id, checkIn, checkOut: addDays(checkIn, n), nights: Array.from({ length: n }, (_, k) => addDays(checkIn, k)), status: cancelled ? "CANCELLED" : "COMPLETED", ...(cancelled ? { cancelledBy: "host" } : {}) });
  }
  if (o.responses) await put({ ...hostStatsKey(id), responses: o.responses[0], responsesOnTime: o.responses[1] });
}

beforeAll(async () => {
  db = await startTestDb();
  await host("star", { stays: 12, rating: 4.92, reviews: 11, responses: [20, 19] });
  await host("long-stays", { stays: 3, nightsEach: 35, rating: 4.9, reviews: 3 }); // 105 nights, nobody messaged
  await host("new", { stays: 4, rating: 5, reviews: 4 });
  await host("low-rating", { stays: 15, rating: 4.6, reviews: 14 });
  await host("cancels", { stays: 20, rating: 4.95, reviews: 18, hostCancels: 1 });
  await host("slow", { stays: 12, rating: 4.9, reviews: 10, responses: [10, 8] });
}, 30_000);
afterAll(async () => db?.stop());

describe("Superhost", () => {
  it("applies Airbnb's criteria", async () => {
    const r = await evaluateAll(db, NOW);
    expect(r).toMatchObject({ hosts: 6, superhosts: 2 });
    const sh = async (id: string) => (await get(userKey(id)))?.superhost;
    expect(await sh("star")).toBe(true);
    expect(await sh("long-stays")).toBe(true);
    for (const id of ["new", "low-rating", "cancels", "slow"]) expect(await sh(id), id).toBe(false);
    expect((await get(userKey("star")))?.hostStats).toMatchObject({ stays: 12, reviews: 11, responseRate: 0.95, cancellationRate: 0 });
  });

  it("puts the badge on the host's listings, and records when it was earned", async () => {
    expect((await get(listingKey("star-L")))?.hostSuperhost).toBe(true);
    expect((await get(listingKey("slow-L")))?.hostSuperhost).toBe(false);
    expect((await get(userKey("star")))?.superhostSince).toBe(NOW.toISOString());
    const again = await evaluateAll(db, new Date(NOW.getTime() + 86_400_000));
    expect(again.changes).toBe(0);
    expect((await get(userKey("star")))?.superhostSince).toBe(NOW.toISOString()); // unchanged on re-evaluation
  });

  it("treats one host cancellation in 20 stays as too many (Airbnb: under 1%)", () => {
    const base: HostStats = { stays: 20, nights: 40, hostCancellations: 0, cancellationRate: 0, ratingAvg: 4.9, reviews: 10, responseRate: 1, responses: 5 };
    expect(qualifies(base)).toBe(true);
    expect(qualifies({ ...base, hostCancellations: 1, cancellationRate: 1 / 21 })).toBe(false);
  });
});
