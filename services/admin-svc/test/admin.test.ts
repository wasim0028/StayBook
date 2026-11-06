import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { metricDayKey, opsEntryKey, opsGsiKeys, userKey, type OpsQueue } from "@mp/shared";
import { bearer, fakeVerifier, startTestDb } from "@mp/test-utils";
import { buildApp } from "../src/app.js";
import type { Directory, DirectoryUser } from "../src/directory.js";

const ADMIN = "aaaaaaaa-0000-4000-8000-00000000000a";
const GUEST = "aaaaaaaa-0000-4000-8000-00000000000b";
const HOST = "aaaaaaaa-0000-4000-8000-00000000000c";
const OTHER_ADMIN = "aaaaaaaa-0000-4000-8000-00000000000d";
const NOW = Math.floor(Date.parse("2026-11-20T06:30:00Z") / 1000); // 12:00 IST, 20 Nov

const users: Record<string, DirectoryUser> = {
  [GUEST]: { userId: GUEST, email: "ravi@example.in", name: "Ravi", enabled: true, status: "CONFIRMED", createdAt: "2026-01-01T00:00:00Z", groups: ["guest"] },
  [HOST]: { userId: HOST, email: "asha@example.in", name: "Asha", enabled: true, status: "CONFIRMED", createdAt: "2026-01-01T00:00:00Z", groups: ["guest", "host"] },
  [OTHER_ADMIN]: { userId: OTHER_ADMIN, email: "ops@example.in", name: "Ops", enabled: true, status: "CONFIRMED", createdAt: null, groups: ["admin"] },
};
const enabledCalls: [string, boolean][] = [];
const searches: string[] = [];
const directory: Directory = {
  async findByEmailPrefix(p) {
    searches.push(p);
    return Object.values(users).filter((u) => u.email?.startsWith(p));
  },
  async get(id) {
    return users[id] ?? null;
  },
  async setEnabled(id, on) {
    enabledCalls.push([id, on]);
  },
};

let db: Awaited<ReturnType<typeof startTestDb>>;
let app: ReturnType<typeof buildApp>["app"];
let tick = 0; // the clock advances a second per call, so audit entries have distinct times
const H = { admin: bearer(ADMIN, "admin"), analyst: bearer("an-1", "analyst"), guest: bearer(GUEST, "guest") };
const put = (Item: object) => db.doc.send(new PutCommand({ TableName: db.table, Item }));

function entry(queue: OpsQueue, id: string, since: string, extra: object = {}) {
  const family = queue.startsWith("listings") ? "listings" : queue;
  const entity = queue === "refunds" ? "BOOKING" : queue === "hosts" ? "USER" : "LISTING";
  return put({ ...opsEntryKey(entity, id, family as "refunds"), ...opsGsiKeys(queue, since, id), entity: "OPSQ", queue, id, since, ...extra });
}

beforeAll(async () => {
  db = await startTestDb();
  app = buildApp({ ddb: db, verifier: fakeVerifier, directory, clock: () => NOW + tick++, logger: false }).app;
  await put({ ...userKey(GUEST), userId: GUEST, displayName: "Ravi K" });
  await put({ ...userKey(HOST), userId: HOST, displayName: "Asha R", onboardingStep: "done", razorpayAccountStatus: "activated", GSI9: "x" });
  await put({ PK: "LISTING#L1", SK: "META", id: "L1", title: "Villa", hostId: HOST, status: "PUBLISHED", GSI2PK: `HOST#${HOST}`, GSI2SK: "LISTING#L1" });
  await put({ PK: "BOOKING#B1", SK: "META", bookingId: "B1", guestId: GUEST, hostId: HOST, status: "CONFIRMED", checkIn: "2026-12-01", GSI1PK: `GUEST#${GUEST}`, GSI1SK: "BOOKING#2026-11-01T00:00:00Z#B1", GSI2PK: `HOST#${HOST}`, GSI2SK: "BOOKING#2026-12-01#B1" });
  for (let i = 0; i < 3; i++) await entry("refunds", `R${i}`, `2026-11-1${i}T00:00:00.000Z`, { bookingId: `R${i}`, guestId: GUEST, hostId: HOST, refundStatus: "FAILED", refundPaise: 1000 * (i + 1) });
  await entry("hosts", HOST, "2026-11-15T00:00:00.000Z", { userId: HOST, reason: "needs_clarification" });
  await put({ ...metricDayKey("2026-11-18"), checkouts: 10, bookings: 4, gmvPaise: 4_000_000, feePaise: 480_000, cancellations: 1 });
  await put({ ...metricDayKey("2026-11-20"), checkouts: 5, bookings: 1, gmvPaise: 1_000_000, feePaise: 120_000 });
  await put({ ...metricDayKey("2026-10-01"), bookings: 99 });
}, 30_000);
afterAll(async () => db?.stop());
beforeEach(() => {
  enabledCalls.length = 0;
  searches.length = 0;
});

const get = (url: string, headers: Record<string, string> = H.admin) => app.inject({ url, headers });

describe("access", () => {
  it("lets analysts see metrics only, and keeps guests out entirely", async () => {
    expect((await app.inject({ url: "/v1/admin/metrics" })).statusCode).toBe(401);
    expect((await get("/v1/admin/metrics", H.guest)).statusCode).toBe(403);
    expect((await get("/v1/admin/metrics", H.analyst)).statusCode).toBe(200);
    const ov = await get("/v1/admin/overview", H.analyst);
    expect(ov.statusCode).toBe(200);
    expect(ov.json().queues).toBeNull(); // queue sizes are operational data
    for (const url of ["/v1/admin/queues/refunds", "/v1/admin/users?email=ravi", `/v1/admin/users/${GUEST}`, "/v1/admin/audit"]) {
      expect((await get(url, H.analyst)).statusCode, url).toBe(403);
    }
  });
});

describe("queues", () => {
  it("lists newest first with names, and paginates", async () => {
    const r1 = (await get("/v1/admin/queues/refunds?limit=2")).json();
    expect(r1.items.map((i: { bookingId: string }) => i.bookingId)).toEqual(["R2", "R1"]);
    expect(r1.items[0]).toMatchObject({ guestName: "Ravi K", hostName: "Asha R", refundStatus: "FAILED" });
    expect(r1.items[0].GSI5PK).toBeUndefined();
    expect(r1.items[0].PK).toBeUndefined();
    const r2 = (await get(`/v1/admin/queues/refunds?limit=2&cursor=${r1.nextCursor}`)).json();
    expect(r2.items.map((i: { bookingId: string }) => i.bookingId)).toEqual(["R0"]);
    expect(r2.nextCursor).toBeNull();
    expect((await get("/v1/admin/queues/everything")).statusCode).toBe(400);
  });

  it("summarises queue sizes and today's numbers", async () => {
    const r = (await get("/v1/admin/overview")).json();
    expect(r.queues).toEqual({ refunds: { count: 3, more: false }, hosts: { count: 1, more: false } });
    expect(r.today).toMatchObject({ day: "2026-11-20", bookings: 1, checkouts: 5 });
    expect(r.last7.totals.bookings).toBe(5);
  });
});

describe("metrics", () => {
  it("returns every day in range, zero-filled, with totals and rates", async () => {
    const r = (await get("/v1/admin/metrics?from=2026-11-17&to=2026-11-20")).json();
    expect(r.days.map((d: { day: string }) => d.day)).toEqual(["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
    expect(r.days[0].bookings).toBe(0);
    expect(r.totals).toMatchObject({ bookings: 5, checkouts: 15, gmvPaise: 5_000_000, feePaise: 600_000, cancellations: 1 });
    expect(r.rates).toEqual({ conversion: 0.333, cancellation: 0.2, avgBookingPaise: 1_000_000 });
  });

  it("defaults to the last 30 IST days and validates ranges", async () => {
    const r = (await get("/v1/admin/metrics")).json();
    expect(r.days).toHaveLength(30);
    expect(r.to).toBe("2026-11-20");
    expect(r.totals.bookings).toBe(5); // 1 Oct is outside the window
    expect((await get("/v1/admin/metrics?from=2026-11-21&to=2026-11-20")).statusCode).toBe(400);
    expect((await get("/v1/admin/metrics?from=2024-01-01&to=2026-11-20")).statusCode).toBe(400);
    expect((await get("/v1/admin/metrics?from=yesterday")).statusCode).toBe(400);
  });
});

describe("users", () => {
  it("searches by email prefix and rejects filter-breaking input", async () => {
    const r = (await get("/v1/admin/users?email=RAVI@")).json();
    expect(searches).toEqual(["ravi@"]);
    expect(r.items.map((u: DirectoryUser) => u.userId)).toEqual([GUEST]);
    expect((await get(`/v1/admin/users?email=${encodeURIComponent('a" or "1')}`)).statusCode).toBe(400);
  });

  it("shows account, profile, listings, hosted bookings and trips together", async () => {
    const host = (await get(`/v1/admin/users/${HOST}`)).json();
    expect(host.account.email).toBe("asha@example.in");
    expect(host.profile).toMatchObject({ displayName: "Asha R", razorpayAccountStatus: "activated" });
    expect(host.profile.PK).toBeUndefined();
    expect(host.listings.map((l: { id: string }) => l.id)).toEqual(["L1"]);
    expect(host.hostBookings.map((b: { bookingId: string }) => b.bookingId)).toEqual(["B1"]);
    const guest = (await get(`/v1/admin/users/${GUEST}`)).json();
    expect(guest.trips.map((b: { bookingId: string }) => b.bookingId)).toEqual(["B1"]);
    expect((await get("/v1/admin/users/aaaaaaaa-0000-4000-8000-0000000000ff")).statusCode).toBe(404);
  });

  it("disables with a reason, writes the audit log, and refuses self or admin targets", async () => {
    const post = (id: string, action: string, body?: object) => app.inject({ method: "POST", url: `/v1/admin/users/${id}/${action}`, headers: H.admin, payload: body });
    expect((await post(GUEST, "disable")).statusCode).toBe(400); // reason required
    expect((await post(ADMIN, "disable", { reason: "testing" })).json().error.code).toBe("SELF_ACTION");
    expect((await post(OTHER_ADMIN, "disable", { reason: "testing" })).json().error.code).toBe("PROTECTED_USER");
    expect(enabledCalls).toEqual([]);

    const r = await post(GUEST, "disable", { reason: "chargeback fraud" });
    expect(r.statusCode).toBe(200);
    expect(r.json().enabled).toBe(false);
    await post(GUEST, "enable", { reason: "cleared by bank" });
    expect(enabledCalls).toEqual([[GUEST, false], [GUEST, true]]);

    const audit = (await get("/v1/admin/audit?month=2026-11")).json();
    expect(audit.items.map((a: { action: string }) => a.action)).toEqual(["user.enable", "user.disable"]);
    expect(audit.items[1]).toMatchObject({ actor: ADMIN, targetType: "user", targetId: GUEST, detail: { reason: "chargeback fraud", email: "ravi@example.in" } });
    expect((await get("/v1/admin/audit")).json().items).toHaveLength(2); // defaults to this IST month
  });
});
