import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookingKey, guestBookingGsiKeys, listingKey, pushTokenKey, threadIdOf, userKey } from "@mp/shared";
import { bearer, fakeVerifier, startTestDb } from "@mp/test-utils";
import { buildApp } from "../src/app.js";

const GUEST = "aaaaaaaa-0000-4000-8000-000000000001";
const GUEST2 = "aaaaaaaa-0000-4000-8000-000000000002";
const HOST = "aaaaaaaa-0000-4000-8000-0000000000aa";
const STRANGER = "aaaaaaaa-0000-4000-8000-0000000000ff";
const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";
const DRAFT = "33333333-3333-4333-8333-333333333333";

let db: Awaited<ReturnType<typeof startTestDb>>;
let app: ReturnType<typeof buildApp>["app"];
let t = Math.floor(Date.parse("2026-11-01T06:00:00Z") / 1000);
const H = (sub: string, ...g: string[]) => bearer(sub, ...g);
const put = (Item: object) => db.doc.send(new PutCommand({ TableName: db.table, Item }));

async function start(user: string, body: object) {
  return app.inject({ method: "POST", url: "/v1/threads", headers: H(user), payload: body });
}
async function send(user: string, threadId: string, body: string, clientId = randomUUID()) {
  t += 5;
  return app.inject({ method: "POST", url: `/v1/threads/${threadId}/messages`, headers: H(user), payload: { body, clientId } });
}
const summary = async (u: string) => (await app.inject({ url: "/v1/inbox/summary", headers: H(u) })).json();
const inbox = async (u: string) => (await app.inject({ url: "/v1/threads", headers: H(u) })).json().items;

beforeAll(async () => {
  db = await startTestDb();
  app = buildApp({ ddb: db, verifier: fakeVerifier, cdnBaseUrl: "https://cdn.test", clock: () => t, logger: false }).app;
  await put({ ...userKey(GUEST), userId: GUEST, displayName: "Ravi Kumar" });
  await put({ ...userKey(HOST), userId: HOST, displayName: "Asha Rao" });
  for (const [id, status] of [[L1, "PUBLISHED"], [L2, "PUBLISHED"], [DRAFT, "DRAFT"]] as const) {
    await put({ ...listingKey(id), id, hostId: HOST, title: `Place ${id.slice(0, 2)}`, status, photos: ["p1"] });
  }
}, 30_000);
afterAll(async () => db?.stop());

describe("starting conversations", () => {
  it("lets a guest ask about a published listing, reusing the same thread", async () => {
    const a = await start(GUEST, { listingId: L1 });
    expect(a.statusCode).toBe(201);
    expect(a.json().threadId).toBe(threadIdOf(L1, GUEST));
    expect((await start(GUEST, { listingId: L1 })).json().threadId).toBe(a.json().threadId);
    expect((await start(GUEST, { listingId: DRAFT })).statusCode).toBe(404);
    expect((await start(HOST, { listingId: L1 })).json().error.code).toBe("OWN_LISTING");
  });

  it("creates one thread when two first requests race", async () => {
    const [a, b] = await Promise.all([start(GUEST2, { listingId: L2 }), start(GUEST2, { listingId: L2 })]);
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(a.json().threadId).toBe(b.json().threadId);
  });

  it("lets a host open a thread from a booking, but not someone else's", async () => {
    const bId = randomUUID();
    await put({ ...bookingKey(bId), bookingId: bId, listingId: L2, guestId: GUEST, hostId: HOST, status: "CONFIRMED", checkIn: "2026-12-01", checkOut: "2026-12-03", guests: 2, ...guestBookingGsiKeys(GUEST, "2026-11-01T00:00:00Z", bId) });
    const r = await start(HOST, { bookingId: bId });
    expect(r.json().threadId).toBe(threadIdOf(L2, GUEST));
    expect((await start(STRANGER, { bookingId: bId })).statusCode).toBe(404);
  });
});

describe("messages", () => {
  const tid = threadIdOf(L1, GUEST);

  it("hides contact details before a booking and shows the reason", async () => {
    const r = await send(GUEST, tid, "Hi! Is parking available? Call me on 98765 43210 or ravi@gmail.com");
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ mine: true, masked: true, senderName: "Ravi" });
    expect(r.json().body).toBe("Hi! Is parking available? Call me on [hidden until booked] or [hidden until booked]");
    const th = (await app.inject({ url: `/v1/threads/${tid}`, headers: H(GUEST) })).json();
    expect(th).toMatchObject({ role: "guest", otherName: "Asha", contactSharing: false, listingTitle: "Place 11" });
  });

  it("counts unread for the recipient only, and clears on read", async () => {
    await send(GUEST, tid, "Also, is there wifi?");
    expect(await summary(HOST)).toMatchObject({ unread: 2 });
    expect((await summary(GUEST)).unread).toBe(0);
    const [row] = await inbox(HOST);
    expect(row).toMatchObject({ threadId: tid, role: "host", otherName: "Ravi", unread: 2, lastPreview: "Also, is there wifi?", lastFromMe: false, coverPhotoUrl: `https://cdn.test/listings/${L1}/p1/w360.webp` });

    const v = (await summary(HOST)).version;
    expect((await app.inject({ method: "POST", url: `/v1/threads/${tid}/read`, headers: H(HOST) })).statusCode).toBe(204);
    expect(await summary(HOST)).toEqual({ unread: 0, version: v + 1 });
    await app.inject({ method: "POST", url: `/v1/threads/${tid}/read`, headers: H(HOST) }); // no double subtraction
    expect((await summary(HOST)).unread).toBe(0);
  });

  it("orders the inbox by latest message", async () => {
    await send(GUEST2, threadIdOf(L2, GUEST2), "Is the villa pet friendly?");
    expect((await inbox(HOST)).map((r: { threadId: string }) => r.threadId)[0]).toBe(threadIdOf(L2, GUEST2));
    await send(HOST, tid, "Yes, wifi and parking both!");
    expect((await inbox(HOST)).map((r: { threadId: string }) => r.threadId)[0]).toBe(tid);
    expect((await inbox(GUEST))[0]).toMatchObject({ unread: 1, lastFromMe: false });
  });

  it("posts a retried message once", async () => {
    const id = randomUUID();
    const before = (await summary(HOST)).unread;
    const a = await send(GUEST, tid, "See you soon", id);
    const b = await send(GUEST, tid, "See you soon", id);
    expect([a.statusCode, b.statusCode]).toEqual([201, 200]);
    expect(b.json().messageId).toBe(a.json().messageId);
    expect((await summary(HOST)).unread).toBe(before + 1);
    expect((await send(HOST, tid, "hijack", id)).statusCode).toBe(409);
  });

  it("pages newest first, and polls for only newer messages", async () => {
    const all = (await app.inject({ url: `/v1/threads/${tid}/messages?limit=50`, headers: H(GUEST) })).json().items;
    expect(all.map((m: { body: string }) => m.body)).toEqual(["See you soon", "Yes, wifi and parking both!", "Also, is there wifi?", expect.stringContaining("parking")]);
    const p1 = (await app.inject({ url: `/v1/threads/${tid}/messages?limit=2`, headers: H(GUEST) })).json();
    const p2 = (await app.inject({ url: `/v1/threads/${tid}/messages?limit=2&cursor=${p1.nextCursor}`, headers: H(GUEST) })).json();
    expect([...p1.items, ...p2.items].map((m: { messageId: string }) => m.messageId)).toEqual(all.map((m: { messageId: string }) => m.messageId));

    const newest = all[0].cursor;
    await send(HOST, tid, "Check-in is from 2pm");
    await send(HOST, tid, "Gate code comes after booking");
    const fresh = (await app.inject({ url: `/v1/threads/${tid}/messages?after=${encodeURIComponent(newest)}`, headers: H(GUEST) })).json().items;
    expect(fresh.map((m: { body: string }) => m.body)).toEqual(["Check-in is from 2pm", "Gate code comes after booking"]);
  });

  it("stops masking once a booking is confirmed", async () => {
    const th = threadIdOf(L2, GUEST);
    const r = await send(HOST, th, "My number is 98765 43210 for arrival");
    expect(r.json()).toMatchObject({ masked: false, body: "My number is 98765 43210 for arrival" });
    const meta = (await db.doc.send(new GetCommand({ TableName: db.table, Key: { PK: `THREAD#${th}`, SK: "META" } }))).Item;
    expect(meta?.bookingConfirmed).toBe(true);
    const detail = (await app.inject({ url: `/v1/threads/${th}`, headers: H(GUEST) })).json();
    expect(detail.contactSharing).toBe(true);
    expect(detail.bookings[0]).toMatchObject({ status: "CONFIRMED", checkIn: "2026-12-01" });
  });
});

describe("access", () => {
  const tid = threadIdOf(L1, GUEST);
  it("hides threads from strangers; admins can read but not post", async () => {
    expect((await app.inject({ url: `/v1/threads/${tid}`, headers: H(STRANGER) })).statusCode).toBe(404);
    expect((await app.inject({ url: `/v1/threads/${tid}/messages`, headers: H(STRANGER) })).statusCode).toBe(404);
    expect((await send(STRANGER, tid, "hello")).statusCode).toBe(404);
    expect((await app.inject({ url: `/v1/threads/${tid}/messages`, headers: H(STRANGER, "admin") })).statusCode).toBe(200);
    expect((await send(STRANGER, tid, "admin note")).statusCode).toBe(404);
    expect((await app.inject({ url: "/v1/threads/not-a-thread", headers: H(GUEST) })).statusCode).toBe(400);
  });

  it("rejects empty and over-long messages", async () => {
    expect((await send(GUEST, tid, "   ")).statusCode).toBe(400);
    expect((await send(GUEST, tid, "x".repeat(2001))).statusCode).toBe(400);
  });
});

describe("push tokens", () => {
  it("stores and removes Expo tokens, rejecting anything else", async () => {
    const token = "ExponentPushToken[abc123DEF]";
    expect((await app.inject({ method: "PUT", url: "/v1/push-tokens", headers: H(GUEST), payload: { token, platform: "ios" } })).statusCode).toBe(204);
    expect((await db.doc.send(new GetCommand({ TableName: db.table, Key: pushTokenKey(GUEST, token) }))).Item?.platform).toBe("ios");
    expect((await app.inject({ method: "PUT", url: "/v1/push-tokens", headers: H(GUEST), payload: { token: "fcm:xyz", platform: "ios" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "DELETE", url: `/v1/push-tokens/${encodeURIComponent(token)}`, headers: H(GUEST) })).statusCode).toBe(204);
    expect((await db.doc.send(new GetCommand({ TableName: db.table, Key: pushTokenKey(GUEST, token) }))).Item).toBeUndefined();
  });
});

describe("response tracking", () => {
  it("records whether the host replied within a day, once per waiting stretch", async () => {
    const L3 = "44444444-4444-4444-8444-444444444444";
    await put({ ...listingKey(L3), id: L3, hostId: HOST, title: "Cabin", status: "PUBLISHED", photos: [] });
    const tid = (await start(GUEST, { listingId: L3 })).json().threadId;
    const stats = async () => (await db.doc.send(new GetCommand({ TableName: db.table, Key: { PK: `USER#${HOST}`, SK: "HOSTSTATS" } }))).Item ?? {};
    const before = await stats();
    await send(GUEST, tid, "Is it available in March?");
    await send(GUEST, tid, "Also, do you allow pets?"); // still the same wait
    t += 2 * 3600;
    await send(HOST, tid, "Yes and yes!");
    await send(HOST, tid, "Anything else?"); // nothing pending: not a response
    t += 3 * 86_400;
    await send(GUEST, tid, "Great, thanks");
    t += 2 * 86_400;
    await send(HOST, tid, "You're welcome"); // replied after 2 days: late
    const after = await stats();
    expect(Number(after.responses ?? 0) - Number(before.responses ?? 0)).toBe(2);
    expect(Number(after.responsesOnTime ?? 0) - Number(before.responsesOnTime ?? 0)).toBe(1);
  });
});
