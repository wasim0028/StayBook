import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listingKey, RazorpayError, userKey, type RazorpayAccounts } from "@mp/shared";
import { bearer, startTestDb } from "@mp/test-utils";
import { fakeVerifier } from "@mp/test-utils";
import { buildApp } from "../src/app.js";
import { rzpAccountKey } from "../src/repo.js";

const calls: string[] = [];
const fail: Record<string, RazorpayError | undefined> = {};
const added: { userId: string; group: string }[] = [];
let accStatus = "created";

const accounts: RazorpayAccounts = {
  async createAccount(i) {
    calls.push("createAccount");
    if (fail.createAccount) throw fail.createAccount;
    return { id: `acc_${i.referenceId.slice(0, 6)}`, status: "created" };
  },
  async addStakeholder() {
    calls.push("addStakeholder");
    if (fail.addStakeholder) throw fail.addStakeholder;
    return { id: "sth_1" };
  },
  async requestRouteProduct() {
    calls.push("requestRouteProduct");
    if (fail.requestRouteProduct) throw fail.requestRouteProduct;
    return { id: "acc_prd_1", activationStatus: "needs_clarification" };
  },
  async setSettlement() {
    calls.push("setSettlement");
    if (fail.setSettlement) throw fail.setSettlement;
    return { activationStatus: "under_review" };
  },
  async getAccount(id) {
    calls.push("getAccount");
    return { id, status: accStatus };
  },
};

let db: Awaited<ReturnType<typeof startTestDb>>;
let app: ReturnType<typeof buildApp>["app"];

const U1 = "aaaaaaaa-0000-4000-8000-000000000001";
const U2 = "aaaaaaaa-0000-4000-8000-000000000002";
const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";
const L3 = "33333333-3333-4333-8333-333333333333";

const onboarding = {
  legalBusinessName: "Sea View Stays",
  businessType: "proprietorship",
  contactName: "Asha Rao",
  email: "asha@example.in",
  phone: "9876543210",
  pan: "ABCDE1234F",
  address: { street1: "12 Beach Rd", city: "Goa", state: "Goa", postalCode: "403001" },
  bank: { accountNumber: "123456789012", ifsc: "HDFC0001234", beneficiaryName: "Asha Rao" },
};

beforeAll(async () => {
  db = await startTestDb();
  app = buildApp({
    ddb: db,
    verifier: fakeVerifier,
    accounts,
    groups: { addToGroup: async (userId, group) => void added.push({ userId, group }) },
    cdnBaseUrl: "https://cdn.test",
    logger: false,
  }).app;
});
afterAll(async () => {
  await app.close();
  await db.stop();
});
beforeEach(() => {
  calls.length = 0;
  added.length = 0;
  for (const k of Object.keys(fail)) delete fail[k];
  accStatus = "created";
});

const put = (Item: Record<string, unknown>) => db.doc.send(new PutCommand({ TableName: db.table, Item }));
const profile = async (id: string) =>
  (await db.doc.send(new GetCommand({ TableName: db.table, Key: userKey(id) }))).Item;

const as = (id: string, ...g: string[]) => bearer(id, ...g);

describe("profile", () => {
  it("requires auth", async () => {
    expect((await app.inject("/v1/me")).statusCode).toBe(401);
  });

  it("creates the profile on first read and updates it", async () => {
    const first = await app.inject({ url: "/v1/me", headers: as(U1, "guest") });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ userId: U1, isHost: false, host: null, displayName: null });

    const upd = await app.inject({
      method: "PUT",
      url: "/v1/me",
      headers: as(U1, "guest"),
      payload: { displayName: "Asha", bio: "Love the sea", phone: "9876543210" },
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json()).toMatchObject({ displayName: "Asha", bio: "Love the sea", phone: "9876543210" });
  });

  it("rejects bad input and unknown fields", async () => {
    const bad = await app.inject({ method: "PUT", url: "/v1/me", headers: as(U1), payload: { phone: "12345" } });
    expect(bad.statusCode).toBe(400);
    const extra = await app.inject({ method: "PUT", url: "/v1/me", headers: as(U1), payload: { isHost: true } });
    expect(extra.statusCode).toBe(400);
    const empty = await app.inject({ method: "PUT", url: "/v1/me", headers: as(U1), payload: {} });
    expect(empty.statusCode).toBe(400);
  });

  it("cannot grant itself host fields through the profile endpoint", async () => {
    await app.inject({
      method: "PUT",
      url: "/v1/me",
      headers: as(U2),
      payload: { razorpayAccountStatus: "activated" },
    });
    expect((await profile(U2))?.razorpayAccountStatus).toBeUndefined();
  });
});

describe("host onboarding", () => {
  it("runs all four Razorpay steps, joins the host group and never stores PAN or the full account number", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/host/onboarding", headers: as(U1, "guest"), payload: onboarding });
    expect(r.statusCode).toBe(201);
    expect(calls).toEqual(["createAccount", "addStakeholder", "requestRouteProduct", "setSettlement"]);
    expect(added).toEqual([{ userId: U1, group: "host" }]);

    const body = r.json();
    expect(body).toMatchObject({
      isHost: true,
      host: { onboardingStep: "done", payoutStatus: "under_review", canPublish: false, bankLast4: "9012" },
    });

    const p = await profile(U1);
    expect(p).toMatchObject({ razorpayAccountId: expect.stringMatching(/^acc_/), razorpayAccountStatus: "under_review" });
    const dump = JSON.stringify(p);
    expect(dump).not.toContain("ABCDE1234F");
    expect(dump).not.toContain("123456789012");

    const link = await db.doc.send(new GetCommand({ TableName: db.table, Key: rzpAccountKey(p!.razorpayAccountId as string) }));
    expect(link.Item?.userId).toBe(U1);
  });

  it("refuses a second onboarding", async () => {
    const again = await app.inject({ method: "POST", url: "/v1/host/onboarding", headers: as(U1, "host"), payload: onboarding });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("ALREADY_ONBOARDED");
    expect(calls).toEqual([]);
  });

  it("resumes after a failure without creating a second linked account", async () => {
    fail.requestRouteProduct = new RazorpayError(500, "SERVER_ERROR", "boom");
    const first = await app.inject({ method: "POST", url: "/v1/host/onboarding", headers: as(U2, "guest"), payload: onboarding });
    expect(first.statusCode).toBe(502);
    expect(calls).toEqual(["createAccount", "addStakeholder", "requestRouteProduct"]);
    expect((await profile(U2))?.onboardingStep).toBe("stakeholder");

    calls.length = 0;
    delete fail.requestRouteProduct;
    const retry = await app.inject({ method: "POST", url: "/v1/host/onboarding", headers: as(U2, "host"), payload: onboarding });
    expect(retry.statusCode).toBe(201);
    expect(calls).toEqual(["requestRouteProduct", "setSettlement"]); // no createAccount, no second stakeholder
    expect(retry.json().host.onboardingStep).toBe("done");
  });

  it("turns Razorpay validation errors into a fixable 422", async () => {
    const U3 = "aaaaaaaa-0000-4000-8000-000000000003";
    fail.createAccount = new RazorpayError(400, "BAD_REQUEST_ERROR", "PAN is invalid");
    const r = await app.inject({ method: "POST", url: "/v1/host/onboarding", headers: as(U3), payload: onboarding });
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toMatchObject({ code: "ONBOARDING_REJECTED", message: "PAN is invalid" });
    expect(added).toEqual([]); // not a host yet
  });

  it("validates PAN, IFSC, phone, PIN and account number before calling Razorpay", async () => {
    for (const patch of [
      { pan: "abcde1234f" },
      { phone: "1234567890" },
      { address: { ...onboarding.address, postalCode: "40300" } },
      { bank: { ...onboarding.bank, ifsc: "HDFC1234567" } },
      { bank: { ...onboarding.bank, accountNumber: "12AB" } },
    ]) {
      const r = await app.inject({
        method: "POST",
        url: "/v1/host/onboarding",
        headers: as("aaaaaaaa-0000-4000-8000-000000000009"),
        payload: { ...onboarding, ...patch },
      });
      expect(r.statusCode).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it("reports status, and refresh pulls the live status from Razorpay", async () => {
    const nobody = await app.inject({ url: "/v1/host/onboarding", headers: as("aaaaaaaa-0000-4000-8000-00000000000a") });
    expect(nobody.statusCode).toBe(404);

    const plain = await app.inject({ url: "/v1/host/onboarding", headers: as(U1, "host") });
    expect(plain.json().host.payoutStatus).toBe("under_review");
    expect(calls).toEqual([]);

    accStatus = "activated";
    const live = await app.inject({ url: "/v1/host/onboarding?refresh=true", headers: as(U1, "host") });
    expect(live.json().host).toMatchObject({ payoutStatus: "activated", canPublish: true });
    expect((await profile(U1))?.razorpayAccountStatus).toBe("activated");
  });
});

describe("wishlist", () => {
  const W = "bbbbbbbb-0000-4000-8000-000000000001";
  const listing = (id: string, status: string, extra: Record<string, unknown> = {}) =>
    put({ ...listingKey(id), id, status, title: `Stay ${id.slice(0, 1)}`, city: "Goa", propertyType: "villa", basePricePaise: 400000, coverPhotoId: "p1", ...extra });

  beforeAll(async () => {
    await listing(L1, "PUBLISHED", { ratingAvg: 4.8, ratingCount: 12 });
    await listing(L2, "PUBLISHED");
    await listing(L3, "DRAFT");
  });

  it("saves, lists with CDN photo URLs, and is idempotent", async () => {
    for (const id of [L1, L2, L1]) {
      const r = await app.inject({ method: "PUT", url: `/v1/wishlist/${id}`, headers: as(W) });
      expect(r.statusCode).toBe(204);
    }
    const list = await app.inject({ url: "/v1/wishlist", headers: as(W) });
    const items = list.json().items as { id: string; coverPhotoUrl: string; ratingAvg?: number }[];
    expect(items.map((i) => i.id).sort()).toEqual([L1, L2].sort());
    const one = items.find((i) => i.id === L1)!;
    expect(one.coverPhotoUrl).toBe(`https://cdn.test/listings/${L1}/p1/w720.webp`);
    expect(one.ratingAvg).toBe(4.8);
  });

  it("refuses unpublished or unknown listings", async () => {
    expect((await app.inject({ method: "PUT", url: `/v1/wishlist/${L3}`, headers: as(W) })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: "/v1/wishlist/44444444-4444-4444-8444-444444444444", headers: as(W) })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: "/v1/wishlist/not-a-uuid", headers: as(W) })).statusCode).toBe(400);
  });

  it("removes, hides listings that were later suspended, and isolates users", async () => {
    await app.inject({ method: "PUT", url: `/v1/wishlist/${L2}`, headers: as(U1) });
    expect((await app.inject({ method: "DELETE", url: `/v1/wishlist/${L2}`, headers: as(W) })).statusCode).toBe(204);
    expect((await app.inject({ url: "/v1/wishlist", headers: as(W) })).json().items.map((i: { id: string }) => i.id)).toEqual([L1]);

    await listing(L1, "SUSPENDED");
    expect((await app.inject({ url: "/v1/wishlist", headers: as(W) })).json().items).toEqual([]);
    expect((await app.inject({ url: "/v1/wishlist", headers: as(U1) })).json().items.map((i: { id: string }) => i.id)).toEqual([L2]);
  });
});
