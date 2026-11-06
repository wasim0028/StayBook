import { PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, istMonth, nightKey, todayUtc, userKey } from "@mp/shared";
import { bearer, fakeVerifier, startTestDb } from "@mp/test-utils";
import { buildApp } from "../src/app.js";
import type { PhotoStore } from "../src/photos.js";

let db: Awaited<ReturnType<typeof startTestDb>>;
let app: ReturnType<typeof buildApp>["app"];
const uploaded = new Set<string>();

const fakePhotos: PhotoStore = {
  async presignUpload(listingId) {
    const photoId = crypto.randomUUID();
    return { photoId, url: "https://example.invalid/upload", fields: { key: `uploads/listings/${listingId}/${photoId}` } };
  },
  async exists(listingId, photoId) {
    return uploaded.has(`${listingId}/${photoId}`);
  },
};

const HOST = bearer("host-1", "host");
const OTHER_HOST = bearer("host-2", "host");
const GUEST = bearer("guest-1", "guest");
const ADMIN = bearer("admin-1", "admin");

const goaVilla = {
  title: "Sea-view villa in Candolim",
  description: "Three-bedroom villa, five minutes from the beach, with a private pool and garden.",
  propertyType: "villa",
  city: "Goa",
  lat: 15.5167,
  lng: 73.7624,
  basePricePaise: 8_500_00,
  maxGuests: 6,
  bedrooms: 3,
  beds: 4,
  bathrooms: 3,
  amenities: ["wifi", "pool", "ac", "kitchen"],
};

beforeAll(async () => {
  db = await startTestDb();
  app = buildApp({
    ddb: db,
    verifier: fakeVerifier,
    photos: fakePhotos,
    cdnBaseUrl: "https://cdn.test",
    requirePayoutAccount: true,
    minPhotosToPublish: 1,
    logger: false,
  }).app;
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.stop();
});

async function createListing(headers = HOST) {
  const r = await app.inject({ method: "POST", url: "/v1/listings", headers, payload: goaVilla });
  expect(r.statusCode).toBe(201);
  return r.json();
}

async function addPhoto(id: string) {
  const up = await app.inject({
    method: "POST",
    url: `/v1/listings/${id}/photos/upload-url`,
    headers: HOST,
    payload: { contentType: "image/jpeg" },
  });
  const { photoId } = up.json();
  uploaded.add(`${id}/${photoId}`);
  const r = await app.inject({ method: "POST", url: `/v1/listings/${id}/photos`, headers: HOST, payload: { photoId } });
  expect(r.statusCode).toBe(201);
  return photoId as string;
}

async function auditFor(targetId: string) {
  const r = await db.doc.send(new QueryCommand({ TableName: db.table, KeyConditionExpression: "PK = :pk", FilterExpression: "targetId = :t", ExpressionAttributeValues: { ":pk": `AUDIT#${istMonth(new Date())}`, ":t": targetId } }));
  return r.Items ?? [];
}

describe("auth and validation", () => {
  it("requires the host role to create", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/listings", payload: goaVilla })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/listings", headers: GUEST, payload: goaVilla })).statusCode).toBe(403);
  });

  it("rejects unknown fields and bad values", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/listings",
      headers: HOST,
      payload: { ...goaVilla, basePricePaise: 50, hostId: "someone-else" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("health endpoints work", async () => {
    expect((await app.inject({ url: "/healthz/live" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/healthz/ready" })).statusCode).toBe(200);
  });
});

describe("listing lifecycle", () => {
  it("creates a private draft", async () => {
    const l = await createListing();
    expect(l.status).toBe("DRAFT");
    expect(l.hostId).toBe("host-1");
    expect(l.PK).toBeUndefined();
    // Drafts are invisible to guests and other hosts
    expect((await app.inject({ url: `/v1/listings/${l.id}`, headers: GUEST })).statusCode).toBe(404);
    expect((await app.inject({ url: `/v1/listings/${l.id}`, headers: OTHER_HOST })).statusCode).toBe(404);
    expect((await app.inject({ url: `/v1/listings/${l.id}`, headers: HOST })).statusCode).toBe(200);
  });

  it("enforces optimistic concurrency on update", async () => {
    const l = await createListing();
    const ok = await app.inject({
      method: "PATCH",
      url: `/v1/listings/${l.id}`,
      headers: HOST,
      payload: { version: 1, basePricePaise: 9_000_00 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().version).toBe(2);
    const stale = await app.inject({
      method: "PATCH",
      url: `/v1/listings/${l.id}`,
      headers: HOST,
      payload: { version: 1, title: "Stale write should fail" },
    });
    expect(stale.statusCode).toBe(409);
  });

  it("blocks another host from editing", async () => {
    const l = await createListing();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/listings/${l.id}`,
      headers: OTHER_HOST,
      payload: { version: 1, title: "Hijacked listing title" },
    });
    expect(r.statusCode).toBe(404);
  });

  it("gates publishing on photos and an activated Razorpay account", async () => {
    const l = await createListing();
    let r = await app.inject({ method: "POST", url: `/v1/listings/${l.id}/publish`, headers: HOST });
    expect(r.json().error.code).toBe("PHOTOS_REQUIRED");

    // Attaching a photo that was never uploaded is rejected
    r = await app.inject({
      method: "POST",
      url: `/v1/listings/${l.id}/photos`,
      headers: HOST,
      payload: { photoId: crypto.randomUUID() },
    });
    expect(r.json().error.code).toBe("UPLOAD_NOT_FOUND");

    const photoId = await addPhoto(l.id);
    r = await app.inject({ method: "POST", url: `/v1/listings/${l.id}/publish`, headers: HOST });
    expect(r.json().error.code).toBe("PAYOUT_ACCOUNT_REQUIRED");

    await db.doc.send(
      new PutCommand({
        TableName: db.table,
        Item: { ...userKey("host-1"), userId: "host-1", razorpayAccountId: "acc_test", razorpayAccountStatus: "activated" },
      }),
    );
    r = await app.inject({ method: "POST", url: `/v1/listings/${l.id}/publish`, headers: HOST });
    expect(r.statusCode).toBe(200);
    const pub = r.json();
    expect(pub.status).toBe("PUBLISHED");
    expect(pub.photoUrls[0]).toBe(`https://cdn.test/listings/${l.id}/${photoId}/w720.webp`);

    // Now public, with a cache header
    const pubGet = await app.inject({ url: `/v1/listings/${l.id}` });
    expect(pubGet.statusCode).toBe(200);
    expect(pubGet.headers["cache-control"]).toContain("public");
  });

  it("lets admins suspend, which hides the listing", async () => {
    const l = await createListing();
    await addPhoto(l.id);
    await app.inject({ method: "POST", url: `/v1/listings/${l.id}/publish`, headers: HOST });
    const r = await app.inject({ method: "POST", url: `/v1/admin/listings/${l.id}/suspend`, headers: ADMIN, payload: { reason: "fake photos reported" } });
    expect(r.json().status).toBe("SUSPENDED");
    const [a] = await auditFor(l.id);
    expect(a).toMatchObject({ action: "listing.suspend", targetType: "listing", detail: { reason: "fake photos reported", from: "PUBLISHED" } });
    expect((await app.inject({ url: `/v1/listings/${l.id}` })).statusCode).toBe(404);
    const edit = await app.inject({
      method: "PATCH",
      url: `/v1/listings/${l.id}`,
      headers: HOST,
      payload: { version: r.json().version, title: "Trying to edit while suspended" },
    });
    expect(edit.json().error.code).toBe("SUSPENDED");
  });

  it("lists a host's own listings only", async () => {
    await createListing(OTHER_HOST);
    const r = await app.inject({ url: "/v1/host/listings?limit=50", headers: OTHER_HOST });
    expect(r.statusCode).toBe(200);
    expect(r.json().items.every((l: { hostId: string }) => l.hostId === "host-2")).toBe(true);
  });
});

describe("calendar", () => {
  it("treats missing nights as free at base price, and hides reasons from guests", async () => {
    const l = await createListing();
    await addPhoto(l.id);
    await app.inject({ method: "POST", url: `/v1/listings/${l.id}/publish`, headers: HOST });
    const from = addDays(todayUtc(), 10);
    const to = addDays(from, 5);

    const block = await app.inject({
      method: "PUT",
      url: `/v1/listings/${l.id}/calendar`,
      headers: HOST,
      payload: { from: addDays(from, 1), to: addDays(from, 2), status: "BLOCKED" },
    });
    expect(block.json().updated).toEqual([addDays(from, 1)]);

    const price = await app.inject({
      method: "PUT",
      url: `/v1/listings/${l.id}/calendar`,
      headers: HOST,
      payload: { from: addDays(from, 3), to: addDays(from, 5), pricePaise: 12_000_00 },
    });
    expect(price.json().updated).toHaveLength(2);

    const guestView = await app.inject({ url: `/v1/listings/${l.id}/calendar?from=${from}&to=${to}` });
    const nights = guestView.json().nights;
    expect(nights).toHaveLength(5);
    expect(nights[0]).toEqual({ date: from, available: true, pricePaise: 8_500_00 });
    expect(nights[1].available).toBe(false);
    expect(nights[1].status).toBeUndefined();
    expect(nights[3].pricePaise).toBe(12_000_00);

    const hostView = await app.inject({ url: `/v1/listings/${l.id}/calendar?from=${from}&to=${to}`, headers: HOST });
    expect(hostView.json().nights[1].status).toBe("BLOCKED");
  });

  it("never overwrites nights held or booked by a guest", async () => {
    const l = await createListing();
    const d = addDays(todayUtc(), 20);
    await db.doc.send(
      new PutCommand({ TableName: db.table, Item: { ...nightKey(l.id, d), status: "BOOKED", bookingId: "b-1" } }),
    );
    const r = await app.inject({
      method: "PUT",
      url: `/v1/listings/${l.id}/calendar`,
      headers: HOST,
      payload: { from: d, to: addDays(d, 2), status: "BLOCKED" },
    });
    expect(r.json()).toEqual({ updated: [addDays(d, 1)], conflicts: [d] });

    // Clearing a price override with null removes the attribute
    await db.doc.send(
      new UpdateCommand({
        TableName: db.table,
        Key: nightKey(l.id, addDays(d, 1)),
        UpdateExpression: "SET pricePaise = :p",
        ExpressionAttributeValues: { ":p": 1 },
      }),
    );
    const clear = await app.inject({
      method: "PUT",
      url: `/v1/listings/${l.id}/calendar`,
      headers: HOST,
      payload: { from: addDays(d, 1), to: addDays(d, 2), pricePaise: null },
    });
    expect(clear.json().updated).toHaveLength(1);
    const cal = await app.inject({
      url: `/v1/listings/${l.id}/calendar?from=${addDays(d, 1)}&to=${addDays(d, 2)}`,
      headers: HOST,
    });
    expect(cal.json().nights[0].pricePaise).toBe(8_500_00);
  });

  it("caps calendar writes at 180 nights", async () => {
    const l = await createListing();
    const from = addDays(todayUtc(), 1);
    const r = await app.inject({
      method: "PUT",
      url: `/v1/listings/${l.id}/calendar`,
      headers: HOST,
      payload: { from, to: addDays(from, 200), status: "BLOCKED" },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe("photos", () => {
  it("reorders photos and moves the cover", async () => {
    const l = await createListing();
    const a = await addPhoto(l.id);
    const b = await addPhoto(l.id);
    const cur = (await app.inject({ url: `/v1/listings/${l.id}`, headers: HOST })).json();
    const r = await app.inject({
      method: "PUT",
      url: `/v1/listings/${l.id}/photos`,
      headers: HOST,
      payload: { photos: [b, a], version: cur.version },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().photos).toEqual([b, a]);
    expect(r.json().coverPhotoId).toBe(b);
  });
});

describe("pricing settings", () => {
  it("stores fees, discounts and stay rules, with sensible defaults", async () => {
    const plain = await createListing();
    expect(plain).toMatchObject({ cleaningFeePaise: 0, weeklyDiscountPct: 0, monthlyDiscountPct: 0, minNights: 1, maxNights: 90, extraGuestFeePaise: 0 });
    const r = await app.inject({ method: "POST", url: "/v1/listings", headers: HOST, payload: { ...goaVilla, cleaningFeePaise: 1_500_00, weeklyDiscountPct: 10, monthlyDiscountPct: 20, minNights: 2, guestsIncluded: 2, extraGuestFeePaise: 400_00 } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ cleaningFeePaise: 1_500_00, weeklyDiscountPct: 10, monthlyDiscountPct: 20, minNights: 2, guestsIncluded: 2 });
  });

  it("rejects contradictory settings on create and on edit", async () => {
    const bad = (extra: object) => app.inject({ method: "POST", url: "/v1/listings", headers: HOST, payload: { ...goaVilla, ...extra } });
    expect((await bad({ minNights: 10, maxNights: 5 })).statusCode).toBe(400);
    expect((await bad({ weeklyDiscountPct: 20, monthlyDiscountPct: 10 })).statusCode).toBe(400);
    expect((await bad({ weeklyDiscountPct: 95 })).statusCode).toBe(400);
    const l = await createListing();
    const patch = await app.inject({ method: "PATCH", url: `/v1/listings/${l.id}`, headers: HOST, payload: { version: l.version, guestsIncluded: 99 } });
    expect(patch.statusCode).toBe(400);
    const patch2 = await app.inject({ method: "PATCH", url: `/v1/listings/${l.id}`, headers: HOST, payload: { version: l.version, minNights: 120 } });
    expect(patch2.json().error.message).toMatch(/minimum nights/);
  });
});

describe("host summary", () => {
  it("shows guests the host's name, badges and response rate, never private fields", async () => {
    const l = await createListing();
    await addPhoto(l.id);
    await app.inject({ method: "POST", url: `/v1/listings/${l.id}/publish`, headers: HOST });
    await db.doc.send(new UpdateCommand({ TableName: db.table, Key: userKey(l.hostId), UpdateExpression: "SET displayName = :n, superhost = :s, hostStats = :st, hostSince = :hs", ExpressionAttributeValues: { ":n": "Asha Rao", ":s": true, ":st": { responseRate: 0.97, reviews: 12, ratingAvg: 4.91 }, ":hs": "2024-03-01T00:00:00Z" } }));
    const r = (await app.inject({ url: `/v1/listings/${l.id}` })).json();
    expect(r.host).toEqual({ name: "Asha", hostingSince: "2024-03-01T00:00:00Z", superhost: true, identityVerified: true, responseRatePct: 97, reviews: 12, ratingAvg: 4.91 });
    expect(JSON.stringify(r.host)).not.toMatch(/razorpay|acc_|bank|gstin/i);
  });
});
