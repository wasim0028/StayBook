import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookingKey, checkOutEpoch, listingKey, userKey } from "@mp/shared";
import { bearer, fakeVerifier, startTestDb } from "@mp/test-utils";
import { buildApp, REVIEW_WINDOW_SECONDS } from "../src/app.js";

let db: Awaited<ReturnType<typeof startTestDb>>;
let app: ReturnType<typeof buildApp>["app"];

const L = "11111111-1111-4111-8111-111111111111";
const CHECKOUT = "2026-06-10";
let clock = checkOutEpoch(CHECKOUT) + 3600; // an hour after check-out

const bk = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`;
const GUEST = (n: number) => `guest-${n}`;
const HOST = bearer("host-1", "host");

const put = (Item: Record<string, unknown>) => db.doc.send(new PutCommand({ TableName: db.table, Item }));
const booking = (n: number, over: Record<string, unknown> = {}) =>
  put({ ...bookingKey(bk(n)), bookingId: bk(n), listingId: L, hostId: "host-1", guestId: GUEST(n), status: "CONFIRMED", checkIn: "2026-06-07", checkOut: CHECKOUT, ...over });
const listing = async () => (await db.doc.send(new GetCommand({ TableName: db.table, Key: listingKey(L) }))).Item!;
const review = (n: number, rating: number, comment = "", who = GUEST(n)) =>
  app.inject({ method: "POST", url: "/v1/reviews", headers: bearer(who, "guest"), payload: { bookingId: bk(n), rating, ...(comment ? { comment } : {}) } });

beforeAll(async () => {
  db = await startTestDb();
  app = buildApp({ ddb: db, verifier: fakeVerifier, clock: () => clock, logger: false }).app;
  await put({ ...listingKey(L), id: L, hostId: "host-1", status: "PUBLISHED", title: "Villa", GSI3PK: "GEO#tdr1v", GSI3SK: `PRICE#0000400000#${L}` });
  await put({ ...userKey(GUEST(1)), displayName: "Asha" });
  for (let n = 1; n <= 12; n++) await booking(n);
  await booking(20, { status: "PENDING_PAYMENT", guestId: GUEST(20) });
  await booking(21, { status: "CANCELLED", guestId: GUEST(21) });
  await booking(22, { checkOut: "2026-06-30", guestId: GUEST(22) }); // stay not finished at `clock`
}, 30_000);
afterAll(async () => {
  await app.close();
  await db.stop();
});

describe("creating reviews", () => {
  it("requires auth and validates input", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/reviews", payload: {} })).statusCode).toBe(401);
    for (const rating of [0, 6, 3.5, "5"]) {
      expect((await review(1, rating as number)).statusCode).toBe(400);
    }
    const extra = await app.inject({ method: "POST", url: "/v1/reviews", headers: bearer(GUEST(1)), payload: { bookingId: bk(1), rating: 5, listingId: "x" } });
    expect(extra.statusCode).toBe(400);
  });

  it("reviews a finished stay, snapshots the guest's name and sets the rating aggregate", async () => {
    const r = await review(1, 5, "Lovely place");
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ guestName: "Asha", rating: 5, comment: "Lovely place", hostReply: null });
    expect(await listing()).toMatchObject({ ratingCount: 1, ratingSum: 5, ratingAvg: 5 });
  });

  it("falls back to 'Guest' when the profile has no name", async () => {
    expect((await review(2, 4)).json().guestName).toBe("Guest");
    expect(await listing()).toMatchObject({ ratingCount: 2, ratingSum: 9, ratingAvg: 4.5 });
  });

  it("allows only one review per booking", async () => {
    const again = await review(1, 1);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("ALREADY_REVIEWED");
    expect((await listing()).ratingCount).toBe(2); // aggregate untouched
  });

  it("only the booking's guest can review; others get the same 404 as a missing booking", async () => {
    expect((await review(3, 5, "", "someone-else")).statusCode).toBe(404);
    const missing = await app.inject({ method: "POST", url: "/v1/reviews", headers: bearer("x"), payload: { bookingId: "cccccccc-0000-4000-8000-000000000000", rating: 5 } });
    expect(missing.statusCode).toBe(404);
  });

  it("refuses unpaid and cancelled bookings, and stays that haven't finished", async () => {
    expect((await review(20, 5)).json().error.code).toBe("NOT_REVIEWABLE");
    expect((await review(21, 5)).json().error.code).toBe("NOT_REVIEWABLE");
    expect((await review(22, 5)).json().error.code).toBe("STAY_NOT_FINISHED");
  });

  it("closes 30 days after check-out", async () => {
    clock = checkOutEpoch(CHECKOUT) + REVIEW_WINDOW_SECONDS + 1;
    expect((await review(3, 5)).json().error.code).toBe("REVIEW_WINDOW_CLOSED");
    clock = checkOutEpoch(CHECKOUT) + REVIEW_WINDOW_SECONDS - 60;
    expect((await review(3, 3)).statusCode).toBe(201);
    clock = checkOutEpoch(CHECKOUT) + 7200;
  });

  it("keeps the aggregate exact when many guests review at once", async () => {
    const before = await listing();
    const ratings = [5, 4, 3, 5, 2, 1, 4, 5]; // bookings 4..11
    const results = await Promise.all(ratings.map((rt, i) => review(4 + i, rt)));
    expect(results.map((r) => r.statusCode)).toEqual(ratings.map(() => 201));
    const after = await listing();
    expect(after.ratingCount).toBe(Number(before.ratingCount) + ratings.length);
    expect(after.ratingSum).toBe(Number(before.ratingSum) + ratings.reduce((a, b) => a + b, 0));
    expect(after.ratingAvg).toBe(Math.round((Number(after.ratingSum) / Number(after.ratingCount)) * 100) / 100);
    expect(after.GSI3PK).toBe("GEO#tdr1v"); // the search index keys survive, so ratings show in search
  }, 30_000);
});

describe("reading and replying", () => {
  it("lists a listing's reviews publicly, newest first, with pagination", async () => {
    const first = await app.inject({ url: `/v1/reviews/listing/${L}?limit=3` });
    expect(first.statusCode).toBe(200);
    const body = first.json();
    expect(body.items).toHaveLength(3);
    const dates = body.items.map((i: { createdAt: string }) => i.createdAt);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(JSON.stringify(body)).not.toContain("guestId");

    const next = await app.inject({ url: `/v1/reviews/listing/${L}?limit=50&cursor=${body.nextCursor}` });
    expect(next.json().items.length).toBeGreaterThan(0);
    expect(next.json().items.map((i: { bookingId: string }) => i.bookingId)).not.toContain(body.items[0].bookingId);
  });

  it("shows the guest their own review for a booking, and 404s for strangers", async () => {
    expect((await app.inject({ url: `/v1/reviews/by-booking/${bk(1)}`, headers: bearer(GUEST(1)) })).json().rating).toBe(5);
    expect((await app.inject({ url: `/v1/reviews/by-booking/${bk(1)}`, headers: bearer("stranger") })).statusCode).toBe(404);
    expect((await app.inject({ url: `/v1/reviews/by-booking/${bk(21)}`, headers: bearer(GUEST(21)) })).statusCode).toBe(404);
  });

  it("lets the listing's host reply once; nobody else can", async () => {
    const url = `/v1/reviews/by-booking/${bk(1)}/reply`;
    expect((await app.inject({ method: "POST", url, headers: bearer("host-2", "host"), payload: { text: "Thanks" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url, headers: bearer(GUEST(1), "guest"), payload: { text: "Thanks" } })).statusCode).toBe(403);

    const ok = await app.inject({ method: "POST", url, headers: HOST, payload: { text: "Thank you, Asha!" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ hostReply: "Thank you, Asha!", hostRepliedAt: expect.any(String) });

    const twice = await app.inject({ method: "POST", url, headers: HOST, payload: { text: "Again" } });
    expect(twice.statusCode).toBe(409);
    expect((await app.inject({ url: `/v1/reviews/by-booking/${bk(1)}`, headers: bearer(GUEST(1)) })).json().hostReply).toBe("Thank you, Asha!");
  });

  it("rejects empty or oversized replies", async () => {
    const url = `/v1/reviews/by-booking/${bk(2)}/reply`;
    expect((await app.inject({ method: "POST", url, headers: HOST, payload: { text: "  " } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url, headers: HOST, payload: { text: "x".repeat(501) } })).statusCode).toBe(400);
  });
});

describe("hosts review guests", () => {
  const G = "guest-30";
  const gk = (n: number, guest = G) => ({ GSI1PK: `GUEST#${guest}`, GSI1SK: `BOOKING#2026-06-0${n}T00:00:00Z#${bk(n + 29)}` });
  const reviewGuest = (n: number, rating: number, headers = HOST) => app.inject({ method: "POST", url: "/v1/reviews/guests", headers, payload: { bookingId: bk(n), rating, comment: "Left the place spotless" } });

  it("lets the booking's host review the guest once after check-out, keeping an average", async () => {
    await put({ ...userKey("host-1"), displayName: "Priya Sharma" });
    await booking(30, { guestId: G, listingTitle: "Villa", ...gk(1) });
    await booking(31, { guestId: G, listingTitle: "Villa", ...gk(2) });
    const r = await reviewGuest(30, 5);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ hostName: "Priya", rating: 5, listingTitle: "Villa" });
    expect((await reviewGuest(30, 1)).json().error.code).toBe("ALREADY_REVIEWED");
    await reviewGuest(31, 4);
    const all = (await app.inject({ url: `/v1/reviews/guests/${G}`, headers: bearer(G, "guest") })).json();
    expect(all).toMatchObject({ ratingAvg: 4.5, ratingCount: 2 });
    expect(all.items).toHaveLength(2);
  });

  it("only the booking's host can review, and only after the stay", async () => {
    expect((await reviewGuest(1, 5, bearer("host-2", "host"))).statusCode).toBe(404);
    expect((await reviewGuest(22, 5)).json().error.code).toBe("STAY_NOT_FINISHED");
    expect((await reviewGuest(21, 5)).json().error.code).toBe("NOT_REVIEWABLE");
  });

  it("shows a guest's reviews to hosts they've booked, not to everyone", async () => {
    expect((await app.inject({ url: `/v1/reviews/guests/${G}`, headers: HOST })).statusCode).toBe(200);
    expect((await app.inject({ url: `/v1/reviews/guests/${G}`, headers: bearer("host-2", "host") })).statusCode).toBe(404);
    expect((await app.inject({ url: `/v1/reviews/guests/${G}`, headers: bearer("guest-99", "guest") })).statusCode).toBe(404);
    expect((await app.inject({ url: `/v1/reviews/guests/${G}`, headers: bearer("ops", "admin") })).statusCode).toBe(200);
    expect((await app.inject({ url: `/v1/reviews/guests/by-booking/${bk(30)}`, headers: bearer(G, "guest") })).json().rating).toBe(5);
  });
});
